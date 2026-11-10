// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/_core/oauthProviders.ts
function requiredEnv(name, providerLabel) {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `\u0E15\u0E49\u0E2D\u0E07\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 environment variable ${name} \u0E01\u0E48\u0E2D\u0E19\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19 ${providerLabel} login`
    );
  }
  return val;
}
var OAUTH_PROVIDERS = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scope: "openid email profile",
    // select_account so people with multiple Google accounts logged into
    // the browser get the picker every time, instead of silently reusing
    // whichever one Google picks by default.
    extraAuthorizeParams: { prompt: "select_account" },
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    redirectUriEnv: "GOOGLE_REDIRECT_URI",
    parseUser: (raw) => ({
      id: raw.id,
      name: raw.name || raw.email || null,
      email: raw.email ?? null,
      picture: raw.picture ?? null
    })
  }
};
function getAuthorizeUrl(provider, state) {
  const params = new URLSearchParams({
    client_id: requiredEnv(provider.clientIdEnv, provider.label),
    redirect_uri: requiredEnv(provider.redirectUriEnv, provider.label),
    response_type: "code",
    scope: provider.scope,
    state,
    ...provider.extraAuthorizeParams ?? {}
  });
  return `${provider.authorizeUrl}?${params.toString()}`;
}
async function exchangeCodeForToken(provider, code) {
  const body = new URLSearchParams({
    client_id: requiredEnv(provider.clientIdEnv, provider.label),
    client_secret: requiredEnv(provider.clientSecretEnv, provider.label),
    grant_type: "authorization_code",
    code,
    redirect_uri: requiredEnv(provider.redirectUriEnv, provider.label)
  });
  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    const text2 = await res.text().catch(() => "");
    throw new Error(
      `\u0E41\u0E25\u0E01 authorization code \u0E40\u0E1B\u0E47\u0E19 token \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (${provider.label}, ${res.status}): ${text2}`
    );
  }
  return res.json();
}
async function fetchOAuthUser(provider, accessToken) {
  const res = await fetch(provider.userUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const text2 = await res.text().catch(() => "");
    throw new Error(
      `\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49 ${provider.label} \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (${res.status}): ${text2}`
    );
  }
  const raw = await res.json();
  return provider.parseUser(raw);
}

// server/db.ts
import { and, desc, eq, gte, lte, sql as sql2 } from "drizzle-orm";

// drizzle/schema.ts
import {
  bigint,
  boolean,
  decimal,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
var roleEnum = pgEnum("role", ["user", "admin"]);
var txTypeEnum = pgEnum("tx_type", ["income", "expense", "saving"]);
var periodEnum = pgEnum("period", ["daily", "weekly", "monthly", "yearly"]);
var freqEnum = pgEnum("freq", ["daily", "weekly", "monthly", "yearly"]);
var priorityEnum = pgEnum("priority", ["high", "medium", "low"]);
var themeEnum = pgEnum("theme", ["dark", "light", "auto"]);
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  pictureUrl: text("pictureUrl"),
  nameCustomized: boolean("nameCustomized").default(false).notNull(),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  resetToken: varchar("resetToken", { length: 255 }),
  resetTokenExpires: timestamp("resetTokenExpires")
});
var transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    type: txTypeEnum("type").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    category: varchar("category", { length: 120 }),
    note: varchar("note", { length: 500 }),
    occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull()
  },
  (t2) => ({
    userIdx: index("tx_user_idx").on(t2.userId),
    userOccurredIdx: index("tx_user_occurred_idx").on(t2.userId, t2.occurredAt)
  })
);
var budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    category: varchar("category", { length: 120 }).notNull(),
    limitAmount: decimal("limitAmount", { precision: 14, scale: 2 }).notNull(),
    period: periodEnum("period").default("monthly").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull()
  },
  (t2) => ({ userIdx: index("budget_user_idx").on(t2.userId) })
);
var goals = pgTable(
  "goals",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    emoji: varchar("emoji", { length: 16 }).default("\u{1F3AF}"),
    targetAmount: decimal("targetAmount", { precision: 14, scale: 2 }).notNull(),
    savedAmount: decimal("savedAmount", { precision: 14, scale: 2 }).default("0").notNull(),
    deadline: bigint("deadline", { mode: "number" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull()
  },
  (t2) => ({ userIdx: index("goals_user_idx").on(t2.userId) })
);
var recurring = pgTable(
  "recurring",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    type: txTypeEnum("type").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    category: varchar("category", { length: 120 }),
    note: varchar("note", { length: 500 }),
    freq: freqEnum("freq").default("monthly").notNull(),
    nextDate: bigint("nextDate", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull()
  },
  (t2) => ({ userIdx: index("recurring_user_idx").on(t2.userId) })
);
var settings = pgTable("settings", {
  userId: integer("userId").primaryKey(),
  currency: varchar("currency", { length: 8 }).default("THB").notNull(),
  theme: themeEnum("theme").default("dark").notNull(),
  myAccountNumber: varchar("myAccountNumber", { length: 40 }),
  customCategories: text("customCategories"),
  deletedDefaultCategories: text("deletedDefaultCategories"),
  pinHash: varchar("pinHash", { length: 255 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});
var syncEventLog = pgTable(
  "sync_event_log",
  {
    id: serial("id").primaryKey(),
    entity: varchar("entity", { length: 64 }).notNull(),
    emittedAt: timestamp("emittedAt").notNull()
  },
  (t2) => ({ emittedIdx: index("sync_event_log_emitted_idx").on(t2.emittedAt) })
);
var appConfig = pgTable("app_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});

// server/_core/env.ts
function adminIdsEnvVar(providerId) {
  return `ADMIN_${providerId.toUpperCase()}_IDS`;
}
function parseIdList(raw) {
  return (raw ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}
var ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "change-me-please",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  // Per-provider admin user IDs (the raw ID the provider shows for the
  // account, not the "<provider>-" prefixed openId) that should get role
  // "admin" on login/signup — e.g. ADMIN_GOOGLE_IDS="109..." . Checked in
  // addition to ownerOpenId above, so you can add more admins just by
  // editing the env var — no code change or redeploy of logic needed.
  adminGoogleIds: parseIdList(process.env.ADMIN_GOOGLE_IDS)
};
function isAdminOpenId(openId) {
  if (openId === ENV.ownerOpenId) return true;
  const sepIndex = openId.indexOf("-");
  if (sepIndex > 0) {
    const providerId = openId.slice(0, sepIndex);
    const providerUserId = openId.slice(sepIndex + 1);
    const ids = parseIdList(process.env[adminIdsEnvVar(providerId)]);
    return ids.includes(providerUserId);
  }
  return false;
}

// server/_core/cache/memoryStore.ts
var FENCE_TTL_MS = 6e4;
var MemoryCacheStore = class {
  store = /* @__PURE__ */ new Map();
  stats = { hits: 0, misses: 0, size: 0 };
  maxEntries;
  // key/prefix -> when it was last invalidated. Checked by `set()` to reject
  // stale writes from reads that started before the invalidation.
  fences = /* @__PURE__ */ new Map();
  constructor(maxEntries = 2e3) {
    this.maxEntries = maxEntries;
  }
  recordFence(prefixOrKey) {
    const now = Date.now();
    this.fences.set(prefixOrKey, now);
    for (const [k, t2] of this.fences) {
      if (now - t2 > FENCE_TTL_MS) this.fences.delete(k);
    }
  }
  /** True if `key` was invalidated (exactly, or via a prefix it starts with) at/after `since`. */
  isFenced(key, since) {
    for (const [prefixOrKey, invalidatedAt] of this.fences) {
      if (invalidatedAt < since) continue;
      if (key === prefixOrKey || key.startsWith(prefixOrKey)) return true;
    }
    return false;
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return void 0;
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.stats.misses++;
      return void 0;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }
  set(key, value, ttlMs, fetchStartedAt) {
    if (fetchStartedAt !== void 0 && this.isFenced(key, fetchStartedAt)) {
      return;
    }
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== void 0) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.stats.size = this.store.size;
  }
  delete(key) {
    this.store.delete(key);
    this.recordFence(key);
    this.stats.size = this.store.size;
  }
  deletePrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    this.recordFence(prefix);
    this.stats.size = this.store.size;
  }
  clear() {
    this.store.clear();
    this.stats.size = 0;
  }
  getStats() {
    return { ...this.stats, size: this.store.size };
  }
};

// server/_core/cache/keys.ts
function userPrefix(entity, userId) {
  return `${entity}:${userId}`;
}
function userKey(entity, userId) {
  return userPrefix(entity, userId);
}
function userParamsKey(entity, userId, params) {
  const stable = params ? stableStringify(params) : "";
  return `${userPrefix(entity, userId)}:${stable}`;
}
function userSessionKey(userId) {
  return `userSession:${userId}`;
}
function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  const sortedKeys = Object.keys(obj).sort();
  const sortedObj = {};
  for (const k of sortedKeys) sortedObj[k] = obj[k];
  return JSON.stringify(sortedObj);
}

// server/_core/events.ts
import { EventEmitter } from "events";

// server/_core/syncLog.ts
import { sql } from "drizzle-orm";

// server/_core/dbConnection.ts
import { drizzle } from "drizzle-orm/node-postgres";
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// server/_core/syncLog.ts
var RETENTION_DAYS = 30;
var RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1e3;
function logSyncEvent(entity, emittedAt) {
  void (async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.insert(syncEventLog).values({ entity, emittedAt: new Date(emittedAt) });
      if (Math.random() < 0.01) await pruneSyncLog();
    } catch (err) {
      console.warn("[syncLog] failed to record event, ignoring:", err);
    }
  })();
}
async function pruneSyncLog() {
  const db = await getDb();
  if (!db) return;
  const cutoff = new Date(Date.now() - RETENTION_MS);
  await db.execute(sql`DELETE FROM "sync_event_log" WHERE "emittedAt" < ${cutoff}`);
}
async function getSyncTrend(days = 14) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
  const rows = await db.execute(sql`
    SELECT to_char(date_trunc('day', "emittedAt"), 'YYYY-MM-DD') AS day,
           "entity" AS entity,
           count(*)::int AS count
    FROM "sync_event_log"
    WHERE "emittedAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `);
  return rows.rows.map((r) => ({ day: r.day, entity: r.entity, count: Number(r.count) }));
}

// server/_core/events.ts
var emitter = new EventEmitter();
emitter.setMaxListeners(0);
var activeConnections = 0;
var totalEventsEmitted = 0;
var emittedByEntity = {};
function registerConnection() {
  activeConnections++;
  return () => {
    activeConnections = Math.max(0, activeConnections - 1);
  };
}
function getEventStats() {
  return {
    activeConnections,
    totalEventsEmitted,
    emittedByEntity: { ...emittedByEntity }
  };
}
function channel(userId) {
  return `user:${userId}`;
}
function emitUserEvent(userId, entity) {
  const emittedAt = Date.now();
  totalEventsEmitted++;
  emittedByEntity[entity] = (emittedByEntity[entity] ?? 0) + 1;
  logSyncEvent(entity, emittedAt);
  try {
    emitter.emit(channel(userId), entity);
  } catch (err) {
    console.warn("[events] listener threw while broadcasting, ignoring:", err);
  }
}
function subscribeUser(userId, listener) {
  const ch = channel(userId);
  emitter.on(ch, listener);
  return () => emitter.off(ch, listener);
}

// server/_core/cache/index.ts
var cache = new MemoryCacheStore();
var CACHE_TTL = {
  settings: 5 * 6e4,
  // 5 min
  budgets: 6e4,
  // 1 min
  goals: 6e4,
  recurring: 2 * 6e4,
  transactions: 3e4,
  // 30s — changes most often
  userSession: 45e3
  // hit on every authenticated request; short so role/name edits show up fast
};
async function getOrSet(key, ttlMs, fetcher) {
  const cached = cache.get(key);
  if (cached !== void 0) return cached;
  const fetchStartedAt = Date.now();
  const value = await fetcher();
  cache.set(key, value, ttlMs, fetchStartedAt);
  return value;
}
function invalidateUser(entity, userId) {
  cache.deletePrefix(userPrefix(entity, userId));
  emitUserEvent(userId, entity);
}
function getCacheStats() {
  return cache.getStats?.() ?? null;
}

// server/db.ts
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const now = /* @__PURE__ */ new Date();
  const isEnvAdmin = isAdminOpenId(user.openId);
  const values = {
    openId: user.openId,
    name: user.name ?? null,
    email: user.email ?? null,
    pictureUrl: user.pictureUrl ?? null,
    passwordHash: user.passwordHash ?? "",
    // Default empty for OAuth users
    loginMethod: user.loginMethod ?? null,
    lastSignedIn: user.lastSignedIn ?? now,
    role: isEnvAdmin ? "admin" : user.role ?? "user"
  };
  const res = await db.insert(users).values(values).onConflictDoUpdate({
    target: users.openId,
    set: {
      name: sql2`CASE WHEN ${users.nameCustomized} IS TRUE THEN ${users.name} ELSE ${values.name} END`,
      email: values.email,
      pictureUrl: values.pictureUrl,
      loginMethod: values.loginMethod,
      lastSignedIn: values.lastSignedIn,
      ...isEnvAdmin ? { role: "admin" } : {},
      updatedAt: now
    }
  }).returning({ id: users.id });
  if (res[0]) cache.delete(userSessionKey(res[0].id));
}
async function updateUserProfile(userId, patch) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({
    ...patch.name !== void 0 ? { name: patch.name, nameCustomized: true } : {},
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq(users.id, userId));
  cache.delete(userSessionKey(userId));
}
async function listUsersForAdmin() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    email: users.email,
    loginMethod: users.loginMethod,
    role: users.role,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn
  }).from(users).orderBy(desc(users.lastSignedIn));
}
async function setUserRole(userId, role) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role, updatedAt: /* @__PURE__ */ new Date() }).where(eq(users.id, userId));
  cache.delete(userSessionKey(userId));
}
async function deleteUser(userId) {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    await tx.delete(transactions).where(eq(transactions.userId, userId));
    await tx.delete(budgets).where(eq(budgets.userId, userId));
    await tx.delete(goals).where(eq(goals.userId, userId));
    await tx.delete(recurring).where(eq(recurring.userId, userId));
    await tx.delete(settings).where(eq(settings.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
  for (const entity of ["transactions", "budgets", "goals", "recurring", "settings"]) {
    invalidateUser(entity, userId);
  }
  cache.delete(userSessionKey(userId));
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getUserById(id) {
  return getOrSet(userSessionKey(id), CACHE_TTL.userSession, async () => {
    const db = await getDb();
    if (!db) return void 0;
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result.length > 0 ? result[0] : void 0;
  });
}
// Login removed: every request runs as one fixed local owner account.
// Reuses the first existing admin (else first user) so existing data stays visible;
// creates an admin "local-owner" on a fresh database.
var localUserId = null;
async function getLocalUser() {
  if (localUserId) {
    const cached = await getUserById(localUserId);
    if (cached) return cached;
    localUserId = null;
  }
  const db = await getDb();
  if (!db) return null;
  let rows = await db.select().from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  if (!rows.length) rows = await db.select().from(users).orderBy(users.id).limit(1);
  if (!rows.length) {
    await upsertUser({ openId: "local-owner", name: "Owner", role: "admin", loginMethod: "local" });
    rows = await db.select().from(users).where(eq(users.openId, "local-owner")).limit(1);
  }
  localUserId = rows[0]?.id ?? null;
  return rows[0] ?? null;
}
async function listTransactions(userId, params) {
  return getOrSet(
    userParamsKey("transactions", userId, params),
    CACHE_TTL.transactions,
    async () => {
      const db = await getDb();
      if (!db) return [];
      const where = [eq(transactions.userId, userId)];
      if (params?.from !== void 0) where.push(gte(transactions.occurredAt, params.from));
      if (params?.to !== void 0) where.push(lte(transactions.occurredAt, params.to));
      if (params?.type) where.push(eq(transactions.type, params.type));
      if (params?.category) where.push(eq(transactions.category, params.category));
      const q = db.select().from(transactions).where(and(...where)).orderBy(desc(transactions.occurredAt));
      const rows = params?.limit ? await q.limit(params.limit) : await q;
      return rows;
    }
  );
}
async function createTransaction(row) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(transactions).values(row).returning({ id: transactions.id });
  invalidateUser("transactions", row.userId);
  return res[0].id;
}
async function deleteTransaction(userId, id) {
  const db = await getDb();
  if (!db) return;
  await db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  invalidateUser("transactions", userId);
}
async function updateTransaction(userId, id, patch) {
  const db = await getDb();
  if (!db) return;
  await db.update(transactions).set({ ...patch, updatedAt: /* @__PURE__ */ new Date() }).where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  invalidateUser("transactions", userId);
}
async function listBudgets(userId) {
  return getOrSet(userKey("budgets", userId), CACHE_TTL.budgets, async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(budgets).where(eq(budgets.userId, userId)).orderBy(desc(budgets.createdAt));
  });
}
async function createBudget(row) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(budgets).values(row).returning({ id: budgets.id });
  invalidateUser("budgets", row.userId);
  return res[0].id;
}
async function deleteBudget(userId, id) {
  const db = await getDb();
  if (!db) return;
  await db.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.id, id)));
  invalidateUser("budgets", userId);
}
async function listGoals(userId) {
  return getOrSet(userKey("goals", userId), CACHE_TTL.goals, async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.createdAt));
  });
}
async function createGoal(row) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(goals).values(row).returning({ id: goals.id });
  invalidateUser("goals", row.userId);
  return res[0].id;
}
async function addToGoal(userId, id, amount) {
  const db = await getDb();
  if (!db) return;
  const cur = await db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.id, id))).limit(1);
  if (!cur[0]) return;
  const next = Number(cur[0].savedAmount) + amount;
  await db.update(goals).set({ savedAmount: String(next), updatedAt: /* @__PURE__ */ new Date() }).where(and(eq(goals.userId, userId), eq(goals.id, id)));
  invalidateUser("goals", userId);
}
async function deleteGoal(userId, id) {
  const db = await getDb();
  if (!db) return;
  await db.delete(goals).where(and(eq(goals.userId, userId), eq(goals.id, id)));
  invalidateUser("goals", userId);
}
async function listRecurring(userId) {
  return getOrSet(userKey("recurring", userId), CACHE_TTL.recurring, async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(recurring).where(eq(recurring.userId, userId)).orderBy(desc(recurring.createdAt));
  });
}
async function createRecurring(row) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(recurring).values(row).returning({ id: recurring.id });
  invalidateUser("recurring", row.userId);
  return res[0].id;
}
async function deleteRecurring(userId, id) {
  const db = await getDb();
  if (!db) return;
  await db.delete(recurring).where(and(eq(recurring.userId, userId), eq(recurring.id, id)));
  invalidateUser("recurring", userId);
}
async function setRecurringNext(userId, id, nextDate) {
  const db = await getDb();
  if (!db) return;
  await db.update(recurring).set({ nextDate, updatedAt: /* @__PURE__ */ new Date() }).where(and(eq(recurring.userId, userId), eq(recurring.id, id)));
  invalidateUser("recurring", userId);
}
async function getSettings(userId) {
  return getOrSet(userKey("settings", userId), CACHE_TTL.settings, async () => {
    const db = await getDb();
    if (!db) return void 0;
    const res = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
    return res[0];
  });
}
async function upsertSettings(row) {
  const db = await getDb();
  if (!db) return;
  await db.insert(settings).values(row).onConflictDoUpdate({
    target: settings.userId,
    set: {
      currency: row.currency,
      theme: row.theme,
      myAccountNumber: row.myAccountNumber,
      customCategories: row.customCategories,
      deletedDefaultCategories: row.deletedDefaultCategories,
      pinHash: row.pinHash,
      updatedAt: /* @__PURE__ */ new Date()
    }
  });
  invalidateUser("settings", row.userId);
}
async function setPinHash(userId, pinHash) {
  const current = await getSettings(userId);
  await upsertSettings({
    userId,
    currency: current?.currency ?? "THB",
    theme: current?.theme ?? "dark",
    myAccountNumber: current?.myAccountNumber ?? null,
    customCategories: current?.customCategories ?? null,
    deletedDefaultCategories: current?.deletedDefaultCategories ?? null,
    pinHash
  });
}

// server/_core/jwt.ts
import { SignJWT, jwtVerify } from "jose";
import { TextEncoder } from "util";
var JWT_SECRET = process.env.JWT_SECRET || "login-disabled";
var secret = new TextEncoder().encode(JWT_SECRET);
async function signJwt(userId) {
  return new SignJWT({ userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
}
async function signRefreshJwt(userId) {
  return new SignJWT({ userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(secret);
}
async function signOAuthState() {
  return new SignJWT({ purpose: "oauth_state" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret);
}
async function verifyOAuthState(state) {
  try {
    const { payload } = await jwtVerify(state, secret);
    return payload.purpose === "oauth_state";
  } catch (error) {
    return false;
  }
}
async function verifyJwt(token) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (error) {
    return null;
  }
}

// server/_core/cookies.ts
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedProto) {
    const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
    if (protoList.some((proto) => proto.trim().toLowerCase() === "https")) {
      return true;
    }
  }
  const hostname = req.hostname || "";
  if (LOCAL_HOSTS.has(hostname)) {
    return true;
  }
  return false;
}
function getSessionCookieOptions(req) {
  const isSecure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure
  };
}

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var REFRESH_COOKIE_NAME = "app_refresh_token";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var SEVEN_DAYS_MS = 1e3 * 60 * 60 * 24 * 7;
var THIRTY_DAYS_MS = 1e3 * 60 * 60 * 24 * 30;
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var POST_LOGIN_ROUTE = "/?tab=account";

// server/_core/oauth.ts
function registerOAuthRoutes(app) {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    app.get(`/api/auth/${provider.id}`, async (req, res) => {
      try {
        const state = await signOAuthState();
        const authorizeUrl = getAuthorizeUrl(provider, state);
        res.redirect(authorizeUrl);
      } catch (error) {
        console.error(`[OAuth] Error initiating ${provider.label} login:`, error);
        res.redirect("/login?error=oauth_init");
      }
    });
    app.get(`/api/auth/${provider.id}/callback`, async (req, res) => {
      try {
        const { code, state, error } = req.query;
        if (error) {
          return res.set("Cache-Control", "no-store, no-cache, must-revalidate").redirect(303, "/login?error=denied");
        }
        if (!code || !state || typeof code !== "string" || typeof state !== "string") {
          return res.set("Cache-Control", "no-store, no-cache, must-revalidate").redirect(303, "/login?error=invalid_params");
        }
        const stateValid = await verifyOAuthState(state);
        if (!stateValid) {
          return res.set("Cache-Control", "no-store, no-cache, must-revalidate").redirect(303, "/login?error=invalid_state");
        }
        const tokenResponse = await exchangeCodeForToken(provider, code);
        const oauthUser = await fetchOAuthUser(provider, tokenResponse.access_token);
        const openId = `${provider.id}-${oauthUser.id}`;
        await upsertUser({
          openId,
          name: oauthUser.name,
          email: oauthUser.email,
          pictureUrl: oauthUser.picture,
          passwordHash: "",
          loginMethod: provider.id
        });
        const user = await getUserByOpenId(openId);
        if (!user) {
          throw new Error("Failed to retrieve user after upsert");
        }
        const token = await signJwt(user.id);
        const refreshToken = await signRefreshJwt(user.id);
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SEVEN_DAYS_MS });
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
          ...cookieOptions,
          maxAge: THIRTY_DAYS_MS
        });
        res.set("Cache-Control", "no-store, no-cache, must-revalidate").redirect(303, POST_LOGIN_ROUTE);
      } catch (error) {
        console.error(`[OAuth] ${provider.label} callback error:`, error);
        res.set("Cache-Control", "no-store, no-cache, must-revalidate").redirect(303, "/login?error=oauth_callback");
      }
    });
  }
}

// server/_core/rateLimit.ts
import rateLimit from "express-rate-limit";
var apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  limit: 300,
  standardHeaders: true,
  // RateLimit-* response headers
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests, please try again later." }
});
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many login attempts, please try again later." }
});

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z3 } from "zod";

// server/_core/securityRouter.ts
import { TRPCError as TRPCError2 } from "@trpc/server";
import { z } from "zod";

// server/_core/pin.ts
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}
function verifyPinHash(pin, stored) {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(pin, salt, 32);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
var MAX_ATTEMPTS = 5;
var LOCKOUT_MS = 30 * 1e3;
var attempts = /* @__PURE__ */ new Map();
function isPinLockedOut(userId) {
  const s = attempts.get(userId);
  if (!s) return 0;
  const remaining = s.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}
function recordPinAttempt(userId, success) {
  if (success) {
    attempts.delete(userId);
    return;
  }
  const s = attempts.get(userId) ?? { fails: 0, lockedUntil: 0 };
  s.fails += 1;
  if (s.fails >= MAX_ATTEMPTS) {
    s.lockedUntil = Date.now() + LOCKOUT_MS;
    s.fails = 0;
  }
  attempts.set(userId, s);
}

// server/_core/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please login to access this resource." });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/securityRouter.ts
var pinSchema = z.string().regex(/^\d{4,6}$/, "\u0E23\u0E2B\u0E31\u0E2A PIN \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E15\u0E31\u0E27\u0E40\u0E25\u0E02 4-6 \u0E2B\u0E25\u0E31\u0E01");
var securityRouter = router({
  /** Whether this user currently has a PIN set (shown in Settings + used by the lock screen). */
  status: protectedProcedure.query(async ({ ctx }) => {
    const s = await getSettings(ctx.user.id);
    return { pinEnabled: Boolean(s?.pinHash) };
  }),
  /** Sets a new PIN, or changes it (must supply the current PIN if one is already set). */
  setPin: protectedProcedure.input(z.object({ pin: pinSchema, currentPin: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const s = await getSettings(ctx.user.id);
    const existingHash = s?.pinHash;
    if (existingHash) {
      if (!input.currentPin || !verifyPinHash(input.currentPin, existingHash)) {
        throw new TRPCError2({ code: "FORBIDDEN", message: "\u0E23\u0E2B\u0E31\u0E2A PIN \u0E40\u0E14\u0E34\u0E21\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
      }
    }
    await setPinHash(ctx.user.id, hashPin(input.pin));
    return { success: true };
  }),
  /** Turns the lock off entirely (requires the current PIN). */
  disablePin: protectedProcedure.input(z.object({ currentPin: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const s = await getSettings(ctx.user.id);
    const existingHash = s?.pinHash;
    if (!existingHash || !verifyPinHash(input.currentPin, existingHash)) {
      throw new TRPCError2({ code: "FORBIDDEN", message: "\u0E23\u0E2B\u0E31\u0E2A PIN \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
    }
    await setPinHash(ctx.user.id, null);
    return { success: true };
  }),
  /** Called by the lock screen to check a typed PIN. Throttled after repeated failures. */
  verifyPin: protectedProcedure.input(z.object({ pin: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const lockedForMs = isPinLockedOut(ctx.user.id);
    if (lockedForMs > 0) {
      throw new TRPCError2({
        code: "TOO_MANY_REQUESTS",
        message: `\u0E25\u0E2D\u0E07\u0E1C\u0E34\u0E14\u0E2B\u0E25\u0E32\u0E22\u0E04\u0E23\u0E31\u0E49\u0E07\u0E40\u0E01\u0E34\u0E19\u0E44\u0E1B \u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E2D\u0E2D\u0E35\u0E01 ${Math.ceil(lockedForMs / 1e3)} \u0E27\u0E34\u0E19\u0E32\u0E17\u0E35`
      });
    }
    const s = await getSettings(ctx.user.id);
    const existingHash = s?.pinHash;
    if (!existingHash) return { valid: true };
    const valid = verifyPinHash(input.pin, existingHash);
    recordPinAttempt(ctx.user.id, valid);
    return { valid };
  })
});

// server/_core/systemRouter.ts
import { z as z2 } from "zod";
var systemRouter = router({
  health: publicProcedure.input(
    z2.object({
      timestamp: z2.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  // Admin-only: hit/miss/size for the server-side cache layer
  cacheStats: adminProcedure.query(() => {
    const stats = getCacheStats();
    return {
      available: stats !== null,
      hits: stats?.hits ?? 0,
      misses: stats?.misses ?? 0,
      size: stats?.size ?? 0,
      hitRate: stats && stats.hits + stats.misses > 0 ? Math.round(stats.hits / (stats.hits + stats.misses) * 1e3) / 10 : 0
    };
  }),
  // Admin-only: real-time sync (SSE) metrics
  syncStats: adminProcedure.query(() => {
    return getEventStats();
  }),
  // Admin-only: daily sync-event counts persisted in the DB
  syncTrend: adminProcedure.input(z2.object({ days: z2.number().int().min(1).max(30).default(14) }).optional()).query(({ input }) => getSyncTrend(input?.days ?? 14))
});

// server/routers.ts
var txTypeEnum2 = z3.enum(["income", "expense", "saving"]);
var freqEnum2 = z3.enum(["daily", "weekly", "monthly", "yearly"]);
var periodEnum2 = z3.enum(["daily", "weekly", "monthly", "yearly"]);
var priorityEnum2 = z3.enum(["high", "medium", "low"]);
var themeEnum2 = z3.enum(["dark", "light", "auto"]);
function advanceDate(nextDate, freq) {
  const d = new Date(nextDate);
  if (freq === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (freq === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (freq === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
}
var appRouter = router({
  system: systemRouter,
  security: securityRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(() => ({ success: true })),
    // Editable display name — once set, the OAuth provider's name no longer
    // overwrites it on future logins (see updateUserProfile in db.ts).
    updateName: protectedProcedure.input(
      z3.object({
        name: z3.string().trim().min(1, "\u0E0A\u0E37\u0E48\u0E2D\u0E15\u0E49\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E27\u0E48\u0E32\u0E07").max(80)
      })
    ).mutation(async ({ ctx, input }) => {
      await updateUserProfile(ctx.user.id, { name: input.name });
      return { success: true };
    })
  }),
  admin: router({
    listUsers: adminProcedure.query(() => listUsersForAdmin()),
    // Prevent an admin from locking themselves (or the last admin) out by
    // accident — the server enforces this, not just the UI.
    setUserRole: adminProcedure.input(
      z3.object({
        userId: z3.number().int().positive(),
        role: z3.enum(["admin", "user"])
      })
    ).mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id && input.role === "user") {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u0E25\u0E14\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E15\u0E31\u0E27\u0E40\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E04\u0E23\u0E31\u0E1A" });
      }
      await setUserRole(input.userId, input.role);
      return { success: true };
    }),
    // Irreversible — wipes the user's account and every row of their data.
    deleteUser: adminProcedure.input(z3.object({ userId: z3.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u0E25\u0E1A\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E15\u0E31\u0E27\u0E40\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E04\u0E23\u0E31\u0E1A" });
      }
      const target = await getUserById(input.userId);
      if (!target) {
        throw new TRPCError3({ code: "NOT_FOUND", message: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E19\u0E35\u0E49" });
      }
      if (target.role === "admin") {
        throw new TRPCError3({
          code: "BAD_REQUEST",
          message: "\u0E25\u0E14\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B\u0E01\u0E48\u0E2D\u0E19\u0E16\u0E36\u0E07\u0E08\u0E30\u0E25\u0E1A\u0E44\u0E14\u0E49\u0E04\u0E23\u0E31\u0E1A"
        });
      }
      await deleteUser(input.userId);
      return { success: true };
    })
  }),
  transactions: router({
    list: protectedProcedure.input(
      z3.object({
        from: z3.number().optional(),
        to: z3.number().optional(),
        type: txTypeEnum2.optional(),
        category: z3.string().optional(),
        limit: z3.number().int().positive().max(1e3).optional()
      }).optional()
    ).query(({ ctx, input }) => listTransactions(ctx.user.id, input ?? {})),
    create: protectedProcedure.input(
      z3.object({
        type: txTypeEnum2,
        amount: z3.number().positive(),
        category: z3.string().max(120).optional().nullable(),
        note: z3.string().max(500).optional().nullable(),
        occurredAt: z3.number()
      })
    ).mutation(async ({ ctx, input }) => {
      const id = await createTransaction({
        userId: ctx.user.id,
        type: input.type,
        amount: String(input.amount),
        category: input.category ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt
      });
      return { id };
    }),
    remove: protectedProcedure.input(z3.object({ id: z3.number().int().positive() })).mutation(({ ctx, input }) => deleteTransaction(ctx.user.id, input.id)),
    update: protectedProcedure.input(
      z3.object({
        id: z3.number().int().positive(),
        type: txTypeEnum2.optional(),
        amount: z3.number().positive().optional(),
        category: z3.string().max(120).optional().nullable(),
        note: z3.string().max(500).optional().nullable(),
        occurredAt: z3.number().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const { id, amount, ...rest } = input;
      await updateTransaction(ctx.user.id, id, {
        ...rest,
        ...amount !== void 0 ? { amount: String(amount) } : {}
      });
    })
  }),
  budgets: router({
    list: protectedProcedure.query(({ ctx }) => listBudgets(ctx.user.id)),
    create: protectedProcedure.input(
      z3.object({
        category: z3.string().min(1).max(120),
        limitAmount: z3.number().positive(),
        period: periodEnum2.default("monthly")
      })
    ).mutation(async ({ ctx, input }) => {
      const id = await createBudget({
        userId: ctx.user.id,
        category: input.category,
        limitAmount: String(input.limitAmount),
        period: input.period
      });
      return { id };
    }),
    remove: protectedProcedure.input(z3.object({ id: z3.number().int().positive() })).mutation(({ ctx, input }) => deleteBudget(ctx.user.id, input.id))
  }),
  goals: router({
    list: protectedProcedure.query(({ ctx }) => listGoals(ctx.user.id)),
    create: protectedProcedure.input(
      z3.object({
        name: z3.string().min(1).max(200),
        emoji: z3.string().max(8).optional(),
        targetAmount: z3.number().positive(),
        deadline: z3.number().optional().nullable()
      })
    ).mutation(async ({ ctx, input }) => {
      const id = await createGoal({
        userId: ctx.user.id,
        name: input.name,
        emoji: input.emoji || "\u{1F3AF}",
        targetAmount: String(input.targetAmount),
        deadline: input.deadline ?? null
      });
      return { id };
    }),
    addAmount: protectedProcedure.input(z3.object({ id: z3.number().int().positive(), amount: z3.number().positive() })).mutation(({ ctx, input }) => addToGoal(ctx.user.id, input.id, input.amount)),
    remove: protectedProcedure.input(z3.object({ id: z3.number().int().positive() })).mutation(({ ctx, input }) => deleteGoal(ctx.user.id, input.id))
  }),
  recurring: router({
    list: protectedProcedure.query(({ ctx }) => listRecurring(ctx.user.id)),
    create: protectedProcedure.input(
      z3.object({
        type: txTypeEnum2,
        amount: z3.number().positive(),
        category: z3.string().max(120).optional().nullable(),
        note: z3.string().max(500).optional().nullable(),
        freq: freqEnum2.default("monthly"),
        nextDate: z3.number()
      })
    ).mutation(async ({ ctx, input }) => {
      const id = await createRecurring({
        userId: ctx.user.id,
        type: input.type,
        amount: String(input.amount),
        category: input.category ?? null,
        note: input.note ?? null,
        freq: input.freq,
        nextDate: input.nextDate
      });
      return { id };
    }),
    remove: protectedProcedure.input(z3.object({ id: z3.number().int().positive() })).mutation(({ ctx, input }) => deleteRecurring(ctx.user.id, input.id)),
    runNow: protectedProcedure.input(z3.object({ id: z3.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const items = await listRecurring(ctx.user.id);
      const item = items.find((r) => r.id === input.id);
      if (!item) throw new TRPCError3({ code: "NOT_FOUND", message: "Recurring not found" });
      await createTransaction({
        userId: ctx.user.id,
        type: item.type,
        amount: item.amount,
        category: item.category ?? null,
        note: item.note ?? null,
        occurredAt: Date.now()
      });
      const next = advanceDate(item.nextDate, item.freq);
      await setRecurringNext(ctx.user.id, item.id, next);
      return { nextDate: next };
    })
  }),
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const s = await getSettings(ctx.user.id);
      const { pinHash: _pinHash, ...rest } = s ?? {};
      return Object.keys(rest).length ? rest : {
        userId: ctx.user.id,
        currency: "THB",
        theme: "dark",
        myAccountNumber: null,
        customCategories: null,
        deletedDefaultCategories: null
      };
    }),
    update: protectedProcedure.input(
      z3.object({
        currency: z3.string().min(1).max(8).optional(),
        theme: themeEnum2.optional(),
        myAccountNumber: z3.string().max(40).optional().nullable(),
        customCategories: z3.string().optional().nullable(),
        deletedDefaultCategories: z3.string().optional().nullable()
      })
    ).mutation(async ({ ctx, input }) => {
      const current = await getSettings(ctx.user.id);
      await upsertSettings({
        userId: ctx.user.id,
        currency: input.currency ?? current?.currency ?? "THB",
        theme: input.theme ?? current?.theme ?? "dark",
        myAccountNumber: input.myAccountNumber !== void 0 ? input.myAccountNumber : current?.myAccountNumber ?? null,
        customCategories: input.customCategories !== void 0 ? input.customCategories : current?.customCategories ?? null,
        deletedDefaultCategories: input.deletedDefaultCategories !== void 0 ? input.deletedDefaultCategories : current?.deletedDefaultCategories ?? null,
        pinHash: current?.pinHash ?? null
      });
      const updated = await getSettings(ctx.user.id);
      const { pinHash: _pinHash, ...rest } = updated ?? {};
      return rest;
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  const { req, res } = opts;
  let user = null;
  try {
    user = await getLocalUser() ?? null;
  } catch (err) {
    console.error("[Context] failed to resolve local user:", err);
  }
  return { req, res, user };
}

// server/_core/vite.ts
import express from "express";
import fs from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Suppress chunk size warning — bundle is intentionally large for this SPA
    chunkSizeWarningLimit: 600
  },
  server: {
    host: true,
    fs: { strict: true, deny: ["**/.*"] }
  },
  // Define optional analytics env vars as empty strings so Vite doesn't warn
  define: {
    "import.meta.env.VITE_ANALYTICS_ENDPOINT": JSON.stringify(
      process.env.VITE_ANALYTICS_ENDPOINT ?? ""
    ),
    "import.meta.env.VITE_ANALYTICS_WEBSITE_ID": JSON.stringify(
      process.env.VITE_ANALYTICS_WEBSITE_ID ?? ""
    )
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(
    "/assets",
    express.static(path2.join(distPath, "assets"), {
      immutable: true,
      maxAge: "365d"
    })
  );
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders(res) {
        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      }
    })
  );
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/migrate.ts
import { drizzle as drizzle2 } from "drizzle-orm/node-postgres";
import { sql as sql3 } from "drizzle-orm";
var SETUP_SQL = (
  /* sql */
  `
-- \u2500\u2500 App config (runtime key/value) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE app_config DROP COLUMN IF EXISTS updated_at;

-- Wishlist feature removed \u2014 retire the table
DROP TABLE IF EXISTS "wishlist";

-- Drop Telegram bot-related tables (removed in v11.0.0)
DROP TABLE IF EXISTS "attachments" CASCADE;
DROP TABLE IF EXISTS "category_feedback" CASCADE;
DROP TABLE IF EXISTS "reminder_log" CASCADE;
DROP TABLE IF EXISTS "bot_broadcast_log" CASCADE;

-- \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
DO $$ BEGIN CREATE TYPE "role"     AS ENUM ('user','admin');              EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "tx_type"  AS ENUM ('income','expense','saving'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "period"   AS ENUM ('daily','weekly','monthly','yearly'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "freq"     AS ENUM ('daily','weekly','monthly','yearly'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "freq"   ADD VALUE IF NOT EXISTS 'daily';  EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE "period" ADD VALUE IF NOT EXISTS 'daily';  EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE "period" ADD VALUE IF NOT EXISTS 'weekly'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN CREATE TYPE "priority" AS ENUM ('high','medium','low');       EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "theme"    AS ENUM ('dark','light','auto');       EXCEPTION WHEN duplicate_object THEN null; END $$;

-- \u2500\u2500 Tables \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CREATE TABLE IF NOT EXISTS "users" (
  "id"           serial        PRIMARY KEY,
  "openId"       varchar(64)   NOT NULL UNIQUE,
  "name"         text,
  "email"        varchar(320)  UNIQUE,
  "passwordHash" varchar(255),
  "loginMethod"  varchar(64),
  "role"         "role"        NOT NULL DEFAULT 'user',
  "createdAt"    timestamp     NOT NULL DEFAULT now(),
  "updatedAt"    timestamp     NOT NULL DEFAULT now(),
  "lastSignedIn" timestamp     NOT NULL DEFAULT now()
);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email"             varchar(320) UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash"      varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetToken"        varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetTokenExpires" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pictureUrl"       text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "nameCustomized"   boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "transactions" (
  "id"          serial        PRIMARY KEY,
  "userId"      integer       NOT NULL,
  "type"        "tx_type"     NOT NULL,
  "amount"      decimal(14,2) NOT NULL,
  "category"    varchar(120),
  "note"        varchar(500),
  "occurredAt"  bigint        NOT NULL,
  "createdAt"   timestamp     NOT NULL DEFAULT now(),
  "updatedAt"   timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tx_user_idx"          ON "transactions" ("userId");
CREATE INDEX IF NOT EXISTS "tx_user_occurred_idx" ON "transactions" ("userId","occurredAt");

CREATE TABLE IF NOT EXISTS "budgets" (
  "id"          serial        PRIMARY KEY,
  "userId"      integer       NOT NULL,
  "category"    varchar(120)  NOT NULL,
  "limitAmount" decimal(14,2) NOT NULL,
  "period"      "period"      NOT NULL DEFAULT 'monthly',
  "createdAt"   timestamp     NOT NULL DEFAULT now(),
  "updatedAt"   timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "budget_user_idx" ON "budgets" ("userId");

CREATE TABLE IF NOT EXISTS "goals" (
  "id"           serial        PRIMARY KEY,
  "userId"       integer       NOT NULL,
  "name"         varchar(200)  NOT NULL,
  "emoji"        varchar(16)   DEFAULT '\u{1F3AF}',
  "targetAmount" decimal(14,2) NOT NULL,
  "savedAmount"  decimal(14,2) NOT NULL DEFAULT 0,
  "deadline"     bigint,
  "createdAt"    timestamp     NOT NULL DEFAULT now(),
  "updatedAt"    timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "goals_user_idx" ON "goals" ("userId");

CREATE TABLE IF NOT EXISTS "recurring" (
  "id"        serial        PRIMARY KEY,
  "userId"    integer       NOT NULL,
  "type"      "tx_type"     NOT NULL,
  "amount"    decimal(14,2) NOT NULL,
  "category"  varchar(120),
  "note"      varchar(500),
  "freq"      "freq"        NOT NULL DEFAULT 'monthly',
  "nextDate"  bigint        NOT NULL,
  "createdAt" timestamp     NOT NULL DEFAULT now(),
  "updatedAt" timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "recurring_user_idx" ON "recurring" ("userId");

CREATE TABLE IF NOT EXISTS "settings" (
  "userId"    integer    PRIMARY KEY,
  "currency"  varchar(8) NOT NULL DEFAULT 'THB',
  "theme"     "theme"    NOT NULL DEFAULT 'dark',
  "updatedAt" timestamp  NOT NULL DEFAULT now()
);
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "myAccountNumber" varchar(40);
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "customCategories" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "deletedDefaultCategories" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pinHash" varchar(255);
-- Drop notificationSettings column if it exists (Telegram bot removed)
ALTER TABLE "settings" DROP COLUMN IF EXISTS "notificationSettings";

CREATE TABLE IF NOT EXISTS "sync_event_log" (
  "id"        serial      PRIMARY KEY,
  "entity"    varchar(64) NOT NULL,
  "emittedAt" timestamp   NOT NULL
);
CREATE INDEX IF NOT EXISTS "sync_event_log_emitted_idx" ON "sync_event_log" ("emittedAt");
`
);
var RENAME_SQL = (
  /* sql */
  `
DO $$
BEGIN
  -- users
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='open_id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='openId') THEN ALTER TABLE "users" RENAME COLUMN "open_id" TO "openId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='openid') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='openId') THEN ALTER TABLE "users" RENAME COLUMN "openid" TO "openId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='login_method') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='loginMethod') THEN ALTER TABLE "users" RENAME COLUMN "login_method" TO "loginMethod"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='loginmethod') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='loginMethod') THEN ALTER TABLE "users" RENAME COLUMN "loginmethod" TO "loginMethod"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='created_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='createdAt') THEN ALTER TABLE "users" RENAME COLUMN "created_at" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='createdat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='createdAt') THEN ALTER TABLE "users" RENAME COLUMN "createdat" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updated_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updatedAt') THEN ALTER TABLE "users" RENAME COLUMN "updated_at" TO "updatedAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updatedat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updatedAt') THEN ALTER TABLE "users" RENAME COLUMN "updatedat" TO "updatedAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_signed_in') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='lastSignedIn') THEN ALTER TABLE "users" RENAME COLUMN "last_signed_in" TO "lastSignedIn"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='lastsignedin') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='lastSignedIn') THEN ALTER TABLE "users" RENAME COLUMN "lastsignedin" TO "lastSignedIn"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='passwordHash') THEN ALTER TABLE "users" RENAME COLUMN "password_hash" TO "passwordHash"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='passwordhash') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='passwordHash') THEN ALTER TABLE "users" RENAME COLUMN "passwordhash" TO "passwordHash"; END IF;

  -- transactions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='user_id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='userId') THEN ALTER TABLE "transactions" RENAME COLUMN "user_id" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='userid') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='userId') THEN ALTER TABLE "transactions" RENAME COLUMN "userid" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='occurred_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='occurredAt') THEN ALTER TABLE "transactions" RENAME COLUMN "occurred_at" TO "occurredAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='occurredat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='occurredAt') THEN ALTER TABLE "transactions" RENAME COLUMN "occurredat" TO "occurredAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='created_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='createdAt') THEN ALTER TABLE "transactions" RENAME COLUMN "created_at" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='createdat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='createdAt') THEN ALTER TABLE "transactions" RENAME COLUMN "createdat" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='updated_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='updatedAt') THEN ALTER TABLE "transactions" RENAME COLUMN "updated_at" TO "updatedAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='updatedat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='updatedAt') THEN ALTER TABLE "transactions" RENAME COLUMN "updatedat" TO "updatedAt"; END IF;

  -- budgets
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='user_id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='userId') THEN ALTER TABLE "budgets" RENAME COLUMN "user_id" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='userid') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='userId') THEN ALTER TABLE "budgets" RENAME COLUMN "userid" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='limit_amount') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='limitAmount') THEN ALTER TABLE "budgets" RENAME COLUMN "limit_amount" TO "limitAmount"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='limitamount') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='limitAmount') THEN ALTER TABLE "budgets" RENAME COLUMN "limitamount" TO "limitAmount"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='created_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='createdAt') THEN ALTER TABLE "budgets" RENAME COLUMN "created_at" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='createdat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='createdAt') THEN ALTER TABLE "budgets" RENAME COLUMN "createdat" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='updated_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='updatedAt') THEN ALTER TABLE "budgets" RENAME COLUMN "updated_at" TO "updatedAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='updatedat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budgets' AND column_name='updatedAt') THEN ALTER TABLE "budgets" RENAME COLUMN "updatedat" TO "updatedAt"; END IF;

  -- goals
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='user_id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='userId') THEN ALTER TABLE "goals" RENAME COLUMN "user_id" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='userid') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='userId') THEN ALTER TABLE "goals" RENAME COLUMN "userid" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='target_amount') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='targetAmount') THEN ALTER TABLE "goals" RENAME COLUMN "target_amount" TO "targetAmount"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='targetamount') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='targetAmount') THEN ALTER TABLE "goals" RENAME COLUMN "targetamount" TO "targetAmount"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='saved_amount') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='savedAmount') THEN ALTER TABLE "goals" RENAME COLUMN "saved_amount" TO "savedAmount"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='savedamount') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='savedAmount') THEN ALTER TABLE "goals" RENAME COLUMN "savedamount" TO "savedAmount"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='created_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='createdAt') THEN ALTER TABLE "goals" RENAME COLUMN "created_at" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='createdat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='createdAt') THEN ALTER TABLE "goals" RENAME COLUMN "createdat" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='updated_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='updatedAt') THEN ALTER TABLE "goals" RENAME COLUMN "updated_at" TO "updatedAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='updatedat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='goals' AND column_name='updatedAt') THEN ALTER TABLE "goals" RENAME COLUMN "updatedat" TO "updatedAt"; END IF;

  -- recurring
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='user_id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='userId') THEN ALTER TABLE "recurring" RENAME COLUMN "user_id" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='userid') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='userId') THEN ALTER TABLE "recurring" RENAME COLUMN "userid" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='next_date') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='nextDate') THEN ALTER TABLE "recurring" RENAME COLUMN "next_date" TO "nextDate"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='nextdate') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='nextDate') THEN ALTER TABLE "recurring" RENAME COLUMN "nextdate" TO "nextDate"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='created_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='createdAt') THEN ALTER TABLE "recurring" RENAME COLUMN "created_at" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='createdat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='createdAt') THEN ALTER TABLE "recurring" RENAME COLUMN "createdat" TO "createdAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='updated_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='updatedAt') THEN ALTER TABLE "recurring" RENAME COLUMN "updated_at" TO "updatedAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='updatedat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recurring' AND column_name='updatedAt') THEN ALTER TABLE "recurring" RENAME COLUMN "updatedat" TO "updatedAt"; END IF;

  -- settings
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='user_id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='userId') THEN ALTER TABLE "settings" RENAME COLUMN "user_id" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='userid') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='userId') THEN ALTER TABLE "settings" RENAME COLUMN "userid" TO "userId"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='updated_at') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='updatedAt') THEN ALTER TABLE "settings" RENAME COLUMN "updated_at" TO "updatedAt"; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='updatedat') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='updatedAt') THEN ALTER TABLE "settings" RENAME COLUMN "updatedat" TO "updatedAt"; END IF;
END $$;
`
);
async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("[Migrations] DATABASE_URL not set \u2014 skipping.");
    return;
  }
  console.log("[Migrations] Running auto migrations\u2026");
  try {
    const db = drizzle2(databaseUrl);
    await db.execute(sql3.raw(SETUP_SQL));
    console.log("[Migrations] \u2713 Tables ensured.");
    await db.execute(sql3.raw(RENAME_SQL));
    console.log("[Migrations] \u2713 Schema is up to date.");
  } catch (err) {
    console.error("[Migrations] \u2717 Failed:", err);
    throw err;
  }
}

// server/_core/index.ts
async function startServer() {
  await runMigrations();
  const app = express2();
  const server = createServer(app);
  if (process.env.NODE_ENV !== "development") app.set("trust proxy", 1);
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      let ok = allowedOrigins.has(origin);
      if (!ok) {
        try {
          const url = new URL(origin);
          ok = url.host === req.headers.host || url.protocol === "capacitor:" || url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "10.0.2.2";
        } catch {
          ok = false;
        }
      }
      if (ok) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, X-TRPC-Source"
      );
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());
  app.get("/api/events", async (req, res) => {
    let userId;
    try {
      userId = (await getLocalUser())?.id;
    } catch {
    }
    if (!userId) {
      res.status(401).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n\n");
    const releaseConnection = registerConnection();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(ping);
      unsubscribe();
      releaseConnection();
    };
    const unsubscribe = subscribeUser(userId, (entity) => {
      try {
        res.write(`event: sync
data: ${JSON.stringify({ entity, emittedAt: Date.now() })}

`);
      } catch (err) {
        console.warn("[events] SSE write failed, closing dead connection:", err);
        cleanup();
      }
    });
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch (err) {
        console.warn("[events] SSE ping failed, closing dead connection:", err);
        cleanup();
      }
    }, 2e4);
    req.on("close", cleanup);
  });
  app.use("/api/trpc", apiLimiter);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}
startServer().catch(console.error);
