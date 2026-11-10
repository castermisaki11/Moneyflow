/**
 * Local-first data layer — replaces the old Postgres/Drizzle backend.
 * All app data lives in this browser's localStorage (one JSON document),
 * so the app runs fully offline and needs no database on the server.
 */
import type {
  Budget,
  Goal,
  PublicSettings,
  Recurring,
  Settings,
  ThemeMode,
  Transaction,
  TxType,
} from "./types";

const STORE_KEY = "moneyflow.localstore.v1";
const PIN_ATTEMPTS_KEY = "moneyflow.pinLockout";
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 60_000;

export const LOCAL_USER_ID = 1;

/** Ordered so persisted JSON stays compact and stable between writes */
export interface LocalStore {
  nextId: number;
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  recurring: Recurring[];
  settings: Settings;
}

function defaultStore(): LocalStore {
  return {
    nextId: 1,
    transactions: [],
    budgets: [],
    goals: [],
    recurring: [],
    settings: {
      currency: "THB",
      theme: "dark",
      myAccountNumber: null,
      customCategories: null,
      deletedDefaultCategories: null,
      pinHash: null,
    },
  };
}

let cache: LocalStore | null = null;

function read(): LocalStore {
  if (cache) return cache;
  if (typeof window === "undefined") return defaultStore();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    cache = raw ? { ...defaultStore(), ...JSON.parse(raw) } : defaultStore();
  } catch {
    cache = defaultStore();
  }
  return cache!;
}

function write(next: LocalStore) {
  cache = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // Storage full / disabled — keep working in memory for this session.
  }
}

export function onExternalWrite(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORE_KEY) {
      cache = null; // force a reload from the other tab's snapshot
      cb();
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function moneyString(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export async function exportStoreJson(): Promise<string> {
  return JSON.stringify(read(), null, 2);
}

export async function importStoreJson(json: string): Promise<void> {
  const parsed = JSON.parse(json) as Partial<LocalStore>;
  const next = defaultStore();
  const rec = next as unknown as Record<string, unknown>;
  for (const key of ["nextId", "transactions", "budgets", "goals", "recurring", "settings"] as const) {
    if (parsed[key] !== undefined) rec[key] = parsed[key];
  }
  write(next);
}

// ─── PIN ────────────────────────────────────────────────────────────────────

async function hashPin(pin: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`moneyflow:${pin}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return "v1:" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // No Web Crypto (insecure context) — degrade to a non-cryptographic hash
    let h = 5381;
    for (const ch of `moneyflow:${pin}`) h = (Math.imul(h, 33) + ch.charCodeAt(0)) >>> 0;
    return "v1-fallback:" + h.toString(16);
  }
}

async function verifyPinRaw(pin: string): Promise<boolean> {
  const { pinHash } = read().settings;
  if (!pinHash) return true;
  return (await hashPin(pin)) === pinHash;
}

function getLockout(): { tryAfter: boolean } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PIN_ATTEMPTS_KEY) ?? "{}") as {
      fails?: number;
      until?: number;
    };
    return { tryAfter: Boolean(raw.until && Date.now() < raw.until) };
  } catch {
    // Corrupt lockout record — treat as unlocked
    return { tryAfter: false };
  }
}

function recordFail() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PIN_ATTEMPTS_KEY) ?? "{}") as {
      fails?: number;
      until?: number;
    };
    const fails = (raw.until && Date.now() < raw.until ? raw.fails ?? 0 : 0) + 1;
    const until = fails >= PIN_MAX_ATTEMPTS ? Date.now() + PIN_LOCKOUT_MS : undefined;
    window.localStorage.setItem(PIN_ATTEMPTS_KEY, JSON.stringify({ fails, until }));
  } catch {
    // Ignore — lockout is best-effort convenience
  }
}

function clearFails() {
  window.localStorage.removeItem(PIN_ATTEMPTS_KEY);
}

// ─── Recurring engine ───────────────────────────────────────────────────────

function advanceDate(nextDate: number, freq: "daily" | "weekly" | "monthly" | "yearly"): number {
  const d = new Date(nextDate);
  const day = d.getDate();
  if (freq === "daily") d.setDate(day + 1);
  else if (freq === "weekly") d.setDate(day + 7);
  else if (freq === "monthly") {
    d.setMonth(d.getMonth() + 1);
    // Keep the day-of-month stable (e.g. Jan 31 → Feb 28, never Mar 3)
    if (d.getDate() !== day) d.setDate(0);
  } else d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}

function pushRecurringTx(st: LocalStore, r: Recurring, occurredAt: number) {
  const tx: Transaction = {
    id: st.nextId++,
    type: r.type,
    amount: r.amount,
    category: r.category,
    note: r.note,
    occurredAt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  st.transactions.push(tx);
}

/** Creates transactions for every due cycle the rule has crossed, then bumps nextDate */
function applyDueRecurring(st: LocalStore, now = Date.now()) {
  for (const r of st.recurring) {
    let cycles = 0;
    while (r.nextDate <= now && cycles < 40) {
      pushRecurringTx(st, r, r.nextDate);
      r.nextDate = advanceDate(r.nextDate, r.freq);
      cycles++;
    }
  }
}

/** Run once at app boot: materialise any past-due recurring rows + save the store */
export function bootLocalStore() {
  const st = read();
  const before = st.transactions.length;
  applyDueRecurring(st);
  if (st.transactions.length !== before) write(st);
}

// ─── Procedures (mirrors the old tRPC API surface) ──────────────────────────

type ListTxInput = {
  from?: number;
  to?: number;
  type?: TxType;
  category?: string;
  limit?: number;
};

export const db = {
  auth: {
    async me() {
      return { id: LOCAL_USER_ID, name: "คุณ", pictureUrl: null, role: "user" as const };
    },
    async logout() {
      // Nothing to invalidate server-side; PIN unlock state is per-session
      return { success: true };
    },
  },

  settings: {
    async get(): Promise<PublicSettings> {
      const { pinHash: _pinHash, ...rest } = read().settings;
      void _pinHash;
      return { ...rest };
    },
    async update(input: {
      currency?: string;
      theme?: ThemeMode;
      myAccountNumber?: string | null;
      customCategories?: string | null;
      deletedDefaultCategories?: string | null;
    }) {
      const st = read();
      st.settings = { ...st.settings, ...input };
      write(st);
      return { ...st.settings };
    },
  },

  security: {
    async status() {
      const st = read();
      return {
        pinEnabled: st.settings.pinHash != null,
        lockedNow: getLockout().tryAfter,
      };
    },
    async setPin(input: { pin: string; currentPin?: string }) {
      if (input.pin.length < 4 || input.pin.length > 6) {
        throw new Error("รหัส PIN ต้องเป็นตัวเลข 4-6 หลัก");
      }
      const st = read();
      if (st.settings.pinHash && !(await verifyPinRaw(input.currentPin ?? ""))) {
        throw new Error("รหัส PIN ปัจจุบันไม่ถูกต้อง");
      }
      st.settings.pinHash = await hashPin(input.pin);
      write(st);
      return { ok: true };
    },
    async disablePin(input: { currentPin: string }) {
      if (!(await verifyPinRaw(input.currentPin))) {
        throw new Error("รหัส PIN ไม่ถูกต้อง");
      }
      const st = read();
      st.settings.pinHash = null;
      write(st);
      clearFails();
      return { ok: true };
    },
    async verifyPin(input: { pin: string }) {
      if (getLockout().tryAfter) {
        throw new Error("ลองผิดหลายครั้งเกินไป กรุณารอสักครู่");
      }
      const valid = await verifyPinRaw(input.pin);
      if (!valid) {
        recordFail();
        return { valid: false };
      }
      clearFails();
      return { valid: true };
    },
  },

  transactions: {
    async list(input: ListTxInput = {}): Promise<Transaction[]> {
      let rows = read().transactions.slice();
      if (input.from !== undefined) rows = rows.filter((t) => t.occurredAt >= input.from!);
      if (input.to !== undefined) rows = rows.filter((t) => t.occurredAt <= input.to!);
      if (input.type) rows = rows.filter((t) => t.type === input.type);
      if (input.category) rows = rows.filter((t) => t.category === input.category);
      rows.sort((a, b) => b.occurredAt - a.occurredAt);
      return input.limit ? rows.slice(0, input.limit) : rows;
    },
    async create(input: {
      type: TxType;
      amount: number;
      category?: string | null;
      note?: string | null;
      occurredAt?: number;
    }): Promise<Transaction> {
      const st = read();
      const row: Transaction = {
        id: st.nextId++,
        type: input.type,
        amount: moneyString(input.amount),
        category: input.category ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ?? Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      st.transactions.push(row);
      write(st);
      return row;
    },
    async update(input: {
      id: number;
      type?: TxType;
      amount?: number;
      category?: string | null;
      note?: string | null;
      occurredAt?: number;
    }): Promise<Transaction> {
      const st = read();
      const row = st.transactions.find((t) => t.id === input.id);
      if (!row) throw new Error("ไม่พบรายการ");
      if (input.type !== undefined) row.type = input.type;
      if (input.amount !== undefined) row.amount = moneyString(input.amount);
      if (input.category !== undefined) row.category = input.category;
      if (input.note !== undefined) row.note = input.note;
      if (input.occurredAt !== undefined) row.occurredAt = input.occurredAt;
      row.updatedAt = Date.now();
      write(st);
      return row;
    },
    async remove(input: { id: number }) {
      const st = read();
      const before = st.transactions.length;
      st.transactions = st.transactions.filter((t) => t.id !== input.id);
      if (st.transactions.length === before) throw new Error("ไม่พบรายการ");
      write(st);
      return { success: true };
    },
  },

  budgets: {
    async list(): Promise<Budget[]> {
      return read().budgets.slice().sort((a, b) => b.createdAt - a.createdAt);
    },
    async create(input: { category: string; limitAmount: number; period?: Budget["period"] }) {
      const st = read();
      const row: Budget = {
        id: st.nextId++,
        category: input.category,
        limitAmount: moneyString(input.limitAmount),
        period: input.period ?? "monthly",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      st.budgets.push(row);
      write(st);
      return row;
    },
    async remove(input: { id: number }) {
      const st = read();
      st.budgets = st.budgets.filter((b) => b.id !== input.id);
      write(st);
      return { success: true };
    },
  },

  goals: {
    async list(): Promise<Goal[]> {
      return read().goals.slice().sort((a, b) => b.createdAt - a.createdAt);
    },
    async create(input: {
      name: string;
      emoji?: string | null;
      targetAmount: number;
      deadline?: number | null;
    }) {
      const st = read();
      const row: Goal = {
        id: st.nextId++,
        name: input.name,
        emoji: input.emoji ?? "🎯",
        targetAmount: moneyString(input.targetAmount),
        savedAmount: "0",
        deadline: input.deadline ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      st.goals.push(row);
      write(st);
      return row;
    },
    async addAmount(input: { id: number; amount: number }) {
      const st = read();
      const row = st.goals.find((g) => g.id === input.id);
      if (!row) throw new Error("ไม่พบเป้าหมาย");
      row.savedAmount = moneyString(Math.max(0, Number(row.savedAmount) + input.amount));
      row.updatedAt = Date.now();
      write(st);
      return row;
    },
    async remove(input: { id: number }) {
      const st = read();
      st.goals = st.goals.filter((g) => g.id !== input.id);
      write(st);
      return { success: true };
    },
  },

  recurring: {
    async list(): Promise<Recurring[]> {
      return read().recurring.slice().sort((a, b) => b.createdAt - a.createdAt);
    },
    async create(input: {
      type: TxType;
      amount: number;
      category?: string | null;
      note?: string | null;
      freq: Recurring["freq"];
      nextDate: number;
    }) {
      const st = read();
      const row: Recurring = {
        id: st.nextId++,
        type: input.type,
        amount: moneyString(input.amount),
        category: input.category ?? null,
        note: input.note ?? null,
        freq: input.freq,
        nextDate: input.nextDate,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      st.recurring.push(row);
      write(st);
      return row;
    },
    async runNow(input: { id: number }) {
      const st = read();
      const row = st.recurring.find((r) => r.id === input.id);
      if (!row) throw new Error("ไม่พบรายการประจำ");
      pushRecurringTx(st, row, Date.now());
      // Starting in the past: skip the already-crossed cycle so a due rule
      // doesn't bill twice (bootLocalStore would otherwise add it again)
      if (row.nextDate <= Date.now()) row.nextDate = advanceDate(row.nextDate, row.freq);
      row.updatedAt = Date.now();
      write(st);
      return { success: true };
    },
    async remove(input: { id: number }) {
      const st = read();
      st.recurring = st.recurring.filter((r) => r.id !== input.id);
      write(st);
      return { success: true };
    },
  },
};
