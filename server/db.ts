import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  appConfig,
  attachments,
  botBroadcastLog,
  budgets,
  categoryFeedback,
  goals,
  InsertBotBroadcastLog,
  InsertBudget,
  InsertCategoryFeedback,
  InsertGoal,
  InsertAttachment,
  InsertRecurring,
  InsertReminderLog,
  InsertSettings,
  InsertTransaction,
  InsertUser,
    recurring,
  reminderLog,
  settings,
  transactions,
  users,
} from "../drizzle/schema";
import { ENV, isAdminOpenId } from "./_core/env";
import { CACHE_TTL, cache, getOrSet, invalidateTelegramSummary, invalidateUser, telegramChatKey, userKey, userParamsKey, userSessionKey } from "./_core/cache";
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
        name: values.name,
        email: values.email,

        loginMethod: values.loginMethod,
        lastSignedIn: values.lastSignedIn,
        // Only touch role on an existing row if this login should force
        // admin via env var — otherwise leave whatever role is already
        // in the DB alone (preserves manual promote/demote via Users page).
        ...(isEnvAdmin ? { role: "admin" as const } : {}),
        updatedAt: now,
      },
    })
    .returning({ id: users.id });
  // name/role/etc. may have just changed — drop the cached session lookup so
  // the next request re-reads the fresh row instead of serving a stale one.
  if (res[0]) cache.delete(userSessionKey(res[0].id));
}

export async function listAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users);
}

/**
 * Safe user list for the admin "Users" page — deliberately excludes
 * passwordHash / resetToken / resetTokenExpires, which never need to leave
 * the server.
 */
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

/** Promote/demote a user. Drops their cached session so the new role applies on their very next request. */
export async function setUserRole(userId: number, role: "admin" | "user"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  cache.delete(userSessionKey(userId));
}

/**
 * Permanently delete a user and every row of their data (transactions,
 * attachments, budgets, goals, recurring rules, category-feedback
 * log, settings). None of these tables have a DB-level FK/cascade (see
 * drizzle/schema.ts), so this deletes each table explicitly, inside one
 * transaction, before deleting the user row itself — an all-or-nothing
 * operation, never a partially-deleted user.
 */
export async function deleteUser(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.userId, userId));
    await tx.delete(transactions).where(eq(transactions.userId, userId));
    await tx.delete(budgets).where(eq(budgets.userId, userId));
    await tx.delete(goals).where(eq(goals.userId, userId));
    await tx.delete(recurring).where(eq(recurring.userId, userId));
    await tx.delete(categoryFeedback).where(eq(categoryFeedback.userId, userId));
    await tx.delete(settings).where(eq(settings.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });

  // Clear every cache entry this user could appear in. There's no reverse
  // index of which telegramChat key(s) pointed at this user, so — same as
  // upsertSettings — drop the whole telegramChat namespace rather than risk
  // leaving one instance stale.
  for (const entity of ["transactions", "budgets", "goals", "recurring", "settings"]) {
    invalidateUser(entity, userId);
  }
  cache.delete(userSessionKey(userId));
  cache.deletePrefix("telegramChat:");
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Cached user-by-id lookup — this is what `createContext` calls on *every*
 * authenticated request (once per access-token check, again on refresh), so
 * it's the single hottest read in the app. Short TTL keeps role/name changes
 * showing up quickly even without the explicit invalidation in upsertUser.
 */
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
      if (rows.length === 0) return [];
      // Attach receipt-photo info (sent via Telegram) so the web UI can show a 📎.
      const atts = await db
        .select({ id: attachments.id, transactionId: attachments.transactionId })
        .from(attachments)
        .where(inArray(attachments.transactionId, rows.map((r) => r.id)));
      const byTx = new Map<number, number>();
      for (const a of atts) if (!byTx.has(a.transactionId)) byTx.set(a.transactionId, a.id);
      return rows.map((r) => ({ ...r, attachmentId: byTx.get(r.id) ?? null }));
    },
  );
}

export async function createTransaction(row: InsertTransaction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.insert(transactions).values(row).returning({ id: transactions.id });
  invalidateUser("transactions", row.userId as number);
  invalidateTelegramSummary(row.userId as number);
  return res[0].id;
}

export async function deleteTransaction(userId: number, id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  await db.delete(attachments).where(and(eq(attachments.userId, userId), eq(attachments.transactionId, id)));
  invalidateUser("transactions", userId);
  invalidateTelegramSummary(userId);
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
  invalidateTelegramSummary(userId);
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
        notificationSettings: (row as any).notificationSettings,
        pinHash: (row as any).pinHash,
        updatedAt: new Date(),
      },
    });
  invalidateUser("settings", row.userId as number);
  // notificationSettings (which carries telegramChatId) may have just
  // changed — we don't track a reverse chatId->userId index, so the
  // simplest correct move is to drop every cached telegram-chat mapping
  // rather than risk one instance staying pointed at a stale/unlinked user.
  cache.deletePrefix("telegramChat:");
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
    notificationSettings: (current as any)?.notificationSettings ?? null,
    pinHash,
  } as any);
}

/**
 * Reverse-lookup: which user (if any) has this Telegram chat id linked.
 * Used by the bot to attribute a plain-text "กาแฟ 60" message to a user.
 * Table is expected to be small (personal/hobby scale) so a full scan is
 * fine, but the bot calls this on nearly every incoming message, and a
 * chat-to-user link almost never changes once set — so it's cached with a
 * long TTL and explicitly dropped whenever any user's settings are saved
 * (see upsertSettings), since that's the only place a link can change.
 */
export async function findUserIdByTelegramChatId(chatId: string): Promise<number | null> {
  if (!chatId) return null;
  return getOrSet(telegramChatKey(chatId), CACHE_TTL.telegramChat, async () => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select({ userId: settings.userId, notificationSettings: settings.notificationSettings })
      .from(settings)
      .where(sql`${settings.notificationSettings} LIKE ${"%\"telegramChatId\":\"" + chatId + "\"%"}`);
    return rows[0]?.userId ?? null;
  });
}

// ---------- Category feedback (Telegram bot ✅/❌ on guessed category) ----------

export async function logCategoryFeedback(row: InsertCategoryFeedback): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(categoryFeedback).values(row);
}

// ---------- Reminder log (Telegram bot "✅ เสร็จแล้ว" on a fired custom reminder) ----------

export async function logReminderDone(row: InsertReminderLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(reminderLog).values(row);
}

/** Reminder-completion history for one user, most recent tap first. Used by the admin Users page. */
export async function listReminderLogs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(reminderLog)
    .where(eq(reminderLog.userId, userId))
    .orderBy(desc(reminderLog.completedAt));
}

// ---------- Admin: Bot overview (server/_core/botStats.ts aggregates these) ----------

/** Every settings row, narrowed to just what bot-wide aggregation needs (admin Bot page). */
export async function listAllSettingsForBot() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ userId: settings.userId, notificationSettings: settings.notificationSettings })
    .from(settings);
}

/** All reminder-completion logs, every user, most recent first (admin Bot page). */
export async function listAllReminderLogs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminderLog).orderBy(desc(reminderLog.completedAt));
}

/** Records one admin broadcast attempt (admin Bot page — broadcast history). */
export async function insertBotBroadcastLog(row: InsertBotBroadcastLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(botBroadcastLog).values(row);
}

/** Most recent admin broadcasts, newest first (admin Bot page). */
export async function listBotBroadcastLogs(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(botBroadcastLog).orderBy(desc(botBroadcastLog.createdAt)).limit(limit);
}

// ---------- Attachments (receipt photos sent via Telegram) ----------

export async function createAttachment(
  row: Omit<InsertAttachment, "fileUrl">,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [inserted] = await db
    .insert(attachments)
    .values({ ...row, fileUrl: "" })
    .returning({ id: attachments.id });
  if (!inserted) return null;
  const fileUrl = `/api/attachments/${inserted.id}`;
  await db.update(attachments).set({ fileUrl }).where(eq(attachments.id, inserted.id));
  invalidateUser("transactions", row.userId);
  return inserted.id;
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

export async function getAttachmentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return rows[0] ?? null;
}

