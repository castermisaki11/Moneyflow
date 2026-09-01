import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  appConfig,
  budgets,
  goals,
  InsertBudget,
  InsertGoal,
  InsertRecurring,
  InsertSettings,
  InsertTransaction,
  InsertUser,
    recurring,
  settings,
  transactions,
  users,
} from "../drizzle/schema";
import { ENV, isAdminOpenId } from "./_core/env";
import { CACHE_TTL, cache, getOrSet, invalidateUser, userKey, userParamsKey, userSessionKey } from "./_core/cache";
import { getDb } from "./_core/dbConnection";

export { getDb };

// ---------- Users ----------

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  // Env-listed admins (OWNER_OPEN_ID / ADMIN_<PROVIDER>_IDS) are force-admin
  // on every login. Everyone else's role is NOT recomputed on update — a
  // role set manually via the Users admin page must persist across logins,
  // not get silently reset back to "user" here.
  const isEnvAdmin = isAdminOpenId(user.openId);
  const values: InsertUser = {
    openId: user.openId,
    name: user.name ?? null,
    email: user.email ?? null,
    pictureUrl: user.pictureUrl ?? null,
    passwordHash: user.passwordHash ?? "", // Default empty for OAuth users
    loginMethod: user.loginMethod ?? null,
    lastSignedIn: user.lastSignedIn ?? now,
    role: isEnvAdmin ? "admin" : (user.role ?? "user"),
  };

  const res = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.openId,
      set: {
        name: sql`CASE WHEN ${users.nameCustomized} IS TRUE THEN ${users.name} ELSE ${values.name} END`,
        email: values.email,
        pictureUrl: values.pictureUrl,

        loginMethod: values.loginMethod,
        lastSignedIn: values.lastSignedIn,
        ...(isEnvAdmin ? { role: "admin" as const } : {}),
        updatedAt: now,
      },
    })
    .returning({ id: users.id });
  if (res[0]) cache.delete(userSessionKey(res[0].id));
}

export async function updateUserProfile(
  userId: number,
  patch: { name?: string }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({
      ...(patch.name !== undefined ? { name: patch.name, nameCustomized: true } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  cache.delete(userSessionKey(userId));
}

export async function listAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users);
}

export async function listUsersForAdmin() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      loginMethod: users.loginMethod,
      role: users.role,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .orderBy(desc(users.lastSignedIn));
}

export async function setUserRole(userId: number, role: "admin" | "user"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  cache.delete(userSessionKey(userId));
}

export async function deleteUser(userId: number): Promise<void> {
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

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  return getOrSet(userSessionKey(id), CACHE_TTL.userSession, async () => {
    const db = await getDb();
    if (!db) return undefined;
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  });
}



// ---------- Transactions ----------

export async function listTransactions(userId: number, params?: {
  from?: number;
  to?: number;
  type?: "income" | "expense" | "saving";
  category?: string;
  limit?: number;
}) {
  return getOrSet(
    userParamsKey("transactions", userId, params),
    CACHE_TTL.transactions,
    async () => {
      const db = await getDb();
      if (!db) return [];
      const where = [eq(transactions.userId, userId)];
      if (params?.from !== undefined) where.push(gte(transactions.occurredAt, params.from));
      if (params?.to !== undefined) where.push(lte(transactions.occurredAt, params.to));
      if (params?.type) where.push(eq(transactions.type, params.type));
      if (params?.category) where.push(eq(transactions.category, params.category));
      const q = db
        .select()
        .from(transactions)
        .where(and(...where))
        .orderBy(desc(transactions.occurredAt));
      const rows = params?.limit ? await q.limit(params.limit) : await q;
      return rows;
    },
  );
}

export async function createTransaction(row: InsertTransaction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(transactions).values(row).returning({ id: transactions.id });
  invalidateUser("transactions", row.userId as number);
  return res[0].id;
}

export async function deleteTransaction(userId: number, id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  invalidateUser("transactions", userId);
}

export async function updateTransaction(userId: number, id: number, patch: {
  type?: "income" | "expense" | "saving";
  amount?: string;
  category?: string | null;
  note?: string | null;
  occurredAt?: number;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(transactions)
    .set({ ...patch, updatedAt: new Date() } as any)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  invalidateUser("transactions", userId);
}

// ---------- Budgets ----------

export async function listBudgets(userId: number) {
  return getOrSet(userKey("budgets", userId), CACHE_TTL.budgets, async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(budgets).where(eq(budgets.userId, userId)).orderBy(desc(budgets.createdAt));
  });
}
export async function createBudget(row: InsertBudget): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(budgets).values(row).returning({ id: budgets.id });
  invalidateUser("budgets", row.userId as number);
  return res[0].id;
}
export async function deleteBudget(userId: number, id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.id, id)));
  invalidateUser("budgets", userId);
}

// ---------- Goals ----------

export async function listGoals(userId: number) {
  return getOrSet(userKey("goals", userId), CACHE_TTL.goals, async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.createdAt));
  });
}
export async function createGoal(row: InsertGoal): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(goals).values(row).returning({ id: goals.id });
  invalidateUser("goals", row.userId as number);
  return res[0].id;
}
export async function addToGoal(userId: number, id: number, amount: number) {
  const db = await getDb();
  if (!db) return;
  const cur = await db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.id, id))).limit(1);
  if (!cur[0]) return;
  const next = Number(cur[0].savedAmount) + amount;
  await db.update(goals).set({ savedAmount: String(next) as any, updatedAt: new Date() }).where(and(eq(goals.userId, userId), eq(goals.id, id)));
  invalidateUser("goals", userId);
}
export async function deleteGoal(userId: number, id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(goals).where(and(eq(goals.userId, userId), eq(goals.id, id)));
  invalidateUser("goals", userId);
}



export async function listRecurring(userId: number) {
  return getOrSet(userKey("recurring", userId), CACHE_TTL.recurring, async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(recurring).where(eq(recurring.userId, userId)).orderBy(desc(recurring.createdAt));
  });
}
export async function createRecurring(row: InsertRecurring): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(recurring).values(row).returning({ id: recurring.id });
  invalidateUser("recurring", row.userId as number);
  return res[0].id;
}
export async function deleteRecurring(userId: number, id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(recurring).where(and(eq(recurring.userId, userId), eq(recurring.id, id)));
  invalidateUser("recurring", userId);
}
export async function setRecurringNext(userId: number, id: number, nextDate: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(recurring).set({ nextDate, updatedAt: new Date() }).where(and(eq(recurring.userId, userId), eq(recurring.id, id)));
  invalidateUser("recurring", userId);
}

// ---------- Settings ----------

export async function getSettings(userId: number) {
  return getOrSet(userKey("settings", userId), CACHE_TTL.settings, async () => {
    const db = await getDb();
    if (!db) return undefined;
    const res = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
    return res[0];
  });
}
export async function upsertSettings(row: InsertSettings) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(settings)
    .values(row)
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        currency: row.currency,
        theme: row.theme,
        myAccountNumber: (row as any).myAccountNumber,
        customCategories: row.customCategories,
        deletedDefaultCategories: (row as any).deletedDefaultCategories,
        pinHash: (row as any).pinHash,
        updatedAt: new Date(),
      },
    });
  invalidateUser("settings", row.userId as number);
}

/** Set (or clear, with `null`) the user's PIN-lock hash without touching other settings fields. */
export async function setPinHash(userId: number, pinHash: string | null): Promise<void> {
  const current = await getSettings(userId);
  await upsertSettings({
    userId,
    currency: current?.currency ?? "THB",
    theme: (current?.theme as any) ?? "dark",
    myAccountNumber: (current as any)?.myAccountNumber ?? null,
    customCategories: current?.customCategories ?? null,
    deletedDefaultCategories: (current as any)?.deletedDefaultCategories ?? null,
    pinHash,
  } as any);
}

// ---------- App config (runtime key/value) ----------

export async function getAppConfigValue(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setAppConfigValue(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(appConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
}
