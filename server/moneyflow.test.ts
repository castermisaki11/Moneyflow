import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// Mock server/db so we don't need a real database in tests.
vi.mock("./db", () => {
  const state = {
    transactions: [] as any[],
    budgets: [] as any[],
    goals: [] as any[],
    wishlist: [] as any[],
    recurring: [] as any[],
    settings: new Map<number, any>(),
    nextId: 1,
  };

  const nextId = () => state.nextId++;

  return {
    __state: state,
    createTransaction: vi.fn(async (row: any) => {
      const id = nextId();
      state.transactions.push({ id, ...row });
      return id;
    }),
    listTransactions: vi.fn(async (userId: number, filter: any = {}) => {
      let list = state.transactions.filter((t) => t.userId === userId);
      if (filter.type) list = list.filter((t) => t.type === filter.type);
      if (filter.category) list = list.filter((t) => t.category === filter.category);
      if (filter.from) list = list.filter((t) => t.occurredAt >= filter.from);
      if (filter.to) list = list.filter((t) => t.occurredAt <= filter.to);
      return list.sort((a, b) => b.occurredAt - a.occurredAt);
    }),
    deleteTransaction: vi.fn(async (userId: number, id: number) => {
      const before = state.transactions.length;
      state.transactions = state.transactions.filter((t) => !(t.userId === userId && t.id === id));
      return { removed: before - state.transactions.length };
    }),
    createBudget: vi.fn(async (row: any) => {
      const id = nextId();
      state.budgets.push({ id, ...row });
      return id;
    }),
    listBudgets: vi.fn(async (userId: number) => state.budgets.filter((b) => b.userId === userId)),
    deleteBudget: vi.fn(async (userId: number, id: number) => {
      state.budgets = state.budgets.filter((b) => !(b.userId === userId && b.id === id));
      return { ok: true };
    }),
    createGoal: vi.fn(async (row: any) => {
      const id = nextId();
      state.goals.push({ id, savedAmount: "0", ...row });
      return id;
    }),
    listGoals: vi.fn(async (userId: number) => state.goals.filter((g) => g.userId === userId)),
    addToGoal: vi.fn(async (userId: number, id: number, amount: number) => {
      const g = state.goals.find((x) => x.userId === userId && x.id === id);
      if (g) g.savedAmount = String(Number(g.savedAmount) + amount);
      return { ok: true };
    }),
    deleteGoal: vi.fn(async (userId: number, id: number) => {
      state.goals = state.goals.filter((g) => !(g.userId === userId && g.id === id));
      return { ok: true };
    }),
    createWish: vi.fn(async (row: any) => {
      const id = nextId();
      state.wishlist.push({ id, ...row });
      return id;
    }),
    listWishlist: vi.fn(async (userId: number) => state.wishlist.filter((w) => w.userId === userId)),
    deleteWish: vi.fn(async (userId: number, id: number) => {
      state.wishlist = state.wishlist.filter((w) => !(w.userId === userId && w.id === id));
      return { ok: true };
    }),
    createRecurring: vi.fn(async (row: any) => {
      const id = nextId();
      state.recurring.push({ id, ...row });
      return id;
    }),
    listRecurring: vi.fn(async (userId: number) => state.recurring.filter((r) => r.userId === userId)),
    deleteRecurring: vi.fn(async (userId: number, id: number) => {
      state.recurring = state.recurring.filter((r) => !(r.userId === userId && r.id === id));
      return { ok: true };
    }),
    setRecurringNext: vi.fn(async (userId: number, id: number, next: number) => {
      const r = state.recurring.find((x) => x.userId === userId && x.id === id);
      if (r) r.nextDate = next;
      return { ok: true };
    }),
    upsertSettings: vi.fn(async (row: any) => {
      state.settings.set(row.userId, { ...(state.settings.get(row.userId) || {}), ...row });
      return { ok: true };
    }),
    getSettings: vi.fn(async (userId: number) => state.settings.get(userId) ?? null),
  };
});

function makeCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `u${userId}@example.com`,
      name: `User ${userId}`,
      loginMethod: "password",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

// Reset the internal state between tests
async function resetState() {
  const dbMod: any = await import("./db");
  const s = dbMod.__state;
  s.transactions.length = 0;
  s.budgets.length = 0;
  s.goals.length = 0;
  s.wishlist.length = 0;
  s.recurring.length = 0;
  s.settings.clear();
  s.nextId = 1;
}

describe("MoneyFlow routers", () => {
  let appRouter: any;

  beforeEach(async () => {
    await resetState();
    ({ appRouter } = await import("./routers"));
  });
  afterEach(() => vi.clearAllMocks());

  it("creates and lists a transaction", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const { id } = await caller.transactions.create({
      type: "expense",
      amount: 120.5,
      category: "อาหาร",
      note: "ข้าวเที่ยง",
      occurredAt: Date.now(),
    });
    expect(typeof id).toBe("number");

    const list = await caller.transactions.list();
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe(1);
    expect(list[0].type).toBe("expense");
    expect(list[0].category).toBe("อาหาร");
  });

  it("deletes a transaction", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const { id } = await caller.transactions.create({
      type: "income",
      amount: 5000,
      category: "salary",
      occurredAt: Date.now(),
    });
    await caller.transactions.remove({ id });
    const list = await caller.transactions.list();
    expect(list).toHaveLength(0);
  });

  it("rejects invalid amount", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.transactions.create({
        type: "expense",
        amount: -10,
        category: null,
        note: null,
        occurredAt: Date.now(),
      }),
    ).rejects.toBeTruthy();
  });

  it("isolates data between users", async () => {
    const a = appRouter.createCaller(makeCtx(1));
    const b = appRouter.createCaller(makeCtx(2));
    await a.transactions.create({
      type: "expense",
      amount: 10,
      category: null,
      note: null,
      occurredAt: Date.now(),
    });
    await b.transactions.create({
      type: "income",
      amount: 20,
      category: null,
      note: null,
      occurredAt: Date.now(),
    });
    expect(await a.transactions.list()).toHaveLength(1);
    expect((await a.transactions.list())[0].type).toBe("expense");
    expect(await b.transactions.list()).toHaveLength(1);
    expect((await b.transactions.list())[0].type).toBe("income");
  });

  it("creates a goal and adds savings", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const { id } = await caller.goals.create({
      name: "iPhone",
      emoji: "📱",
      targetAmount: 30000,
    });
    await caller.goals.addAmount({ id, amount: 500 });
    const list = await caller.goals.list();
    expect(list).toHaveLength(1);
    expect(Number(list[0].savedAmount)).toBe(500);
  });

  it("runs a recurring item now and advances its nextDate", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const oldNext = Date.UTC(2025, 0, 1);
    const { id } = await caller.recurring.create({
      type: "expense",
      amount: 1500,
      category: "ค่าเช่า",
      note: "rent",
      freq: "monthly",
      nextDate: oldNext,
    });
    const res = await caller.recurring.runNow({ id });
    expect(res.nextDate).toBeGreaterThan(oldNext);
    const txs = await caller.transactions.list();
    expect(txs).toHaveLength(1);
    expect(txs[0].category).toBe("ค่าเช่า");
  });

  it("saves and reads settings", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const initial = await caller.settings.get();
    expect(initial.currency).toBe("THB");
    await caller.settings.update({ currency: "USD", theme: "light" });
    const after = await caller.settings.get();
    expect(after.currency).toBe("USD");
    expect(after.theme).toBe("light");
  });
});
