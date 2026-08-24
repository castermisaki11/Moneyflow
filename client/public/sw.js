// ─── MoneyFlow Service Worker ───────────────────────────────────────────────
// v3 — Cache-first + Background Sync + IndexedDB offline queue
// ────────────────────────────────────────────────────────────────────────────

const CACHE = "moneyflow-v4"; // v4: new app icon
const SYNC_TAG = "moneyflow-tx-sync";
const DB_NAME = "moneyflow-offline";
const DB_VERSION = 1;
const STORE = "pending_transactions";

const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon-64.png",
];

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "queueId",
          autoIncrement: true,
        });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllPending(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deletePending(db, queueId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(queueId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Install ────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // purge old caches
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
          )
        ),
      // pre-create IndexedDB so it's ready immediately
      openDB(),
    ])
  );
  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── tRPC transaction create → intercept when offline ──────────────────────
  if (
    request.method === "POST" &&
    url.pathname.startsWith("/api/trpc") &&
    url.pathname.includes("transactions.create")
  ) {
    event.respondWith(handleTxCreate(request.clone()));
    return;
  }

  // ── skip non-GET / internal paths ─────────────────────────────────────────
  if (request.method !== "GET") return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/manus-storage/") ||
    url.pathname.startsWith("/__manus__/")
  ) {
    return;
  }

  // ── SPA navigation → network-first, fallback to cached "/" ───────────────
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  // ── assets → cache-first ──────────────────────────────────────────────────
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(request, copy))
              .catch(() => {});
            return res;
          })
          .catch(() => cached)
    )
  );
});

// ─── Offline transaction create handler ─────────────────────────────────────

async function handleTxCreate(request) {
  try {
    // Try network first
    const res = await fetch(request);
    return res;
  } catch (_networkErr) {
    // Network failed → queue to IndexedDB
    try {
      const body = await request.text();
      const db = await openDB();

      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const req = tx.objectStore(STORE).add({
          url: request.url,
          method: request.method,
          body,
          headers: [...request.headers.entries()].reduce((acc, [k, v]) => {
            acc[k] = v;
            return acc;
          }, {}),
          createdAt: Date.now(),
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = resolve;
      });

      // Register background sync if available
      if (self.registration.sync) {
        await self.registration.sync.register(SYNC_TAG).catch(() => {});
      }

      // Notify all open clients so they can show optimistic UI / badge
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) =>
        c.postMessage({ type: "TX_QUEUED", body })
      );

      // Return synthetic "queued" response so tRPC doesn't throw
      return new Response(
        JSON.stringify([{ result: { data: { id: -Date.now() } } }]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (queueErr) {
      // Couldn't queue either — surface the original network error
      return new Response(
        JSON.stringify([{ error: { message: "offline and could not queue" } }]),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}

// ─── Background Sync ────────────────────────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueue());
  }
});

async function flushQueue() {
  const db = await openDB();
  const pending = await getAllPending(db);

  for (const item of pending) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
        credentials: "include",
      });

      if (res.ok) {
        await deletePending(db, item.queueId);

        // Tell the app to refetch
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((c) =>
          c.postMessage({ type: "TX_SYNCED", queueId: item.queueId })
        );
      }
      // If server returned non-ok (e.g. 4xx validation), remove from queue
      // to avoid retrying permanently-invalid items
      if (res.status >= 400 && res.status < 500) {
        await deletePending(db, item.queueId);
      }
    } catch (_err) {
      // Still offline — leave in queue, sync will retry automatically
    }
  }
}

// ─── Message channel (from app → SW) ────────────────────────────────────────

self.addEventListener("message", (event) => {
  // App can explicitly request a manual sync flush (e.g. on reconnect)
  if (event.data?.type === "SYNC_NOW") {
    event.waitUntil(flushQueue());
  }

  // App can query how many pending items are in the queue
  if (event.data?.type === "GET_QUEUE_COUNT") {
    openDB()
      .then((db) => getAllPending(db))
      .then((items) => {
        if (event.source) {
          event.source.postMessage({
            type: "QUEUE_COUNT",
            count: items.length,
          });
        }
      })
      .catch(() => {});
  }
});
