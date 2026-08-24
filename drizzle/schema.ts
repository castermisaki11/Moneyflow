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
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const txTypeEnum = pgEnum("tx_type", ["income", "expense", "saving"]);
export const periodEnum = pgEnum("period", ["daily", "weekly", "monthly", "yearly"]);
export const freqEnum = pgEnum("freq", ["daily", "weekly", "monthly", "yearly"]);
export const priorityEnum = pgEnum("priority", ["high", "medium", "low"]);
export const themeEnum = pgEnum("theme", ["dark", "light", "auto"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  // Profile photo URL from the OAuth provider (Discord/Google CDN) — null for password accounts
  pictureUrl: text("pictureUrl"),
  // True once the user edited their display name themselves — their custom
  // name then survives re-login, instead of being overwritten by the provider
  nameCustomized: boolean("nameCustomized").default(false).notNull(),
  email: varchar("email", { length: 320 }).unique(), // nullable for Discord OAuth users
  passwordHash: varchar("passwordHash", { length: 255 }), // nullable for Discord OAuth users
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  resetToken: varchar("resetToken", { length: 255 }),
  resetTokenExpires: timestamp("resetTokenExpires"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const transactions = pgTable(
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
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("tx_user_idx").on(t.userId),
    userOccurredIdx: index("tx_user_occurred_idx").on(t.userId, t.occurredAt),
  }),
);
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

export const budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    category: varchar("category", { length: 120 }).notNull(),
    limitAmount: decimal("limitAmount", { precision: 14, scale: 2 }).notNull(),
    period: periodEnum("period").default("monthly").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("budget_user_idx").on(t.userId) }),
);
export type Budget = typeof budgets.$inferSelect;
export type InsertBudget = typeof budgets.$inferInsert;

export const goals = pgTable(
  "goals",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    emoji: varchar("emoji", { length: 16 }).default("🎯"),
    targetAmount: decimal("targetAmount", { precision: 14, scale: 2 }).notNull(),
    savedAmount: decimal("savedAmount", { precision: 14, scale: 2 }).default("0").notNull(),
    deadline: bigint("deadline", { mode: "number" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("goals_user_idx").on(t.userId) }),
);
export type Goal = typeof goals.$inferSelect;
export type InsertGoal = typeof goals.$inferInsert;


export const recurring = pgTable(
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
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("recurring_user_idx").on(t.userId) }),
);
export type Recurring = typeof recurring.$inferSelect;
export type InsertRecurring = typeof recurring.$inferInsert;

export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    transactionId: integer("transactionId").notNull(),
    fileKey: varchar("fileKey", { length: 400 }).notNull(),
    fileUrl: varchar("fileUrl", { length: 500 }).notNull(),
    fileName: varchar("fileName", { length: 300 }).notNull(),
    mimeType: varchar("mimeType", { length: 120 }).notNull(),
    sizeBytes: integer("sizeBytes").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("att_user_idx").on(t.userId),
    txIdx: index("att_tx_idx").on(t.transactionId),
  }),
);
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;

// Logs whether the Telegram bot's auto-guessed category (guessCategory in
// server/_core/telegram.ts) was actually correct, via the ✅/❌ feedback
// buttons shown after a quick-add. Read-only log for now — a future pass
// can use this per-user to bias guesses toward categories the person
// actually confirms, instead of the fixed keyword tables.
export const categoryFeedback = pgTable(
  "category_feedback",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    guessedCategory: varchar("guessedCategory", { length: 120 }).notNull(),
    correct: boolean("correct").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("category_feedback_user_idx").on(t.userId) }),
);
export type CategoryFeedback = typeof categoryFeedback.$inferSelect;
export type InsertCategoryFeedback = typeof categoryFeedback.$inferInsert;

// Persisted history of real-time sync (SSE) events, so the Metrics page can
// show a trend over time ("today vs last week") instead of only in-memory
// counters that reset on every server restart/deploy. One row per emitted
// event (entity + when) — no userId, this is a system-wide aggregate, not
// a per-user audit log. Pruned automatically (see server/_core/syncLog.ts)
// so it never grows unbounded.
export const syncEventLog = pgTable(
  "sync_event_log",
  {
    id: serial("id").primaryKey(),
    entity: varchar("entity", { length: 64 }).notNull(),
    emittedAt: timestamp("emittedAt").notNull(),
  },
  (t) => ({ emittedIdx: index("sync_event_log_emitted_idx").on(t.emittedAt) }),
);
export type SyncEventLogRow = typeof syncEventLog.$inferSelect;
export type InsertSyncEventLog = typeof syncEventLog.$inferInsert;

// Logs each time the user taps "✅ เสร็จแล้ว" on a fired custom reminder
// (see scheduler.ts and handleReminderDone in server/_core/telegram.ts).
// We only log on tap, not on send — if the user never taps, there's simply
// no row here (see scheduler.ts comment for the "sent but not tapped" case).
export const reminderLog = pgTable(
  "reminder_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    reminderText: varchar("reminderText", { length: 500 }).notNull(),
    firedAt: bigint("firedAt", { mode: "number" }).notNull(),
    completedAt: timestamp("completedAt").defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("reminder_log_user_idx").on(t.userId) }),
);
export type ReminderLog = typeof reminderLog.$inferSelect;
export type InsertReminderLog = typeof reminderLog.$inferInsert;

// History of admin "send to everyone linked" messages (see the `broadcast`
// mutation in server/_core/botRouter.ts and the admin Bot page). One row per
// broadcast attempt — sentCount/failedCount are totals, not per-recipient rows.
export const botBroadcastLog = pgTable(
  "bot_broadcast_log",
  {
    id: serial("id").primaryKey(),
    adminUserId: integer("adminUserId").notNull(),
    text: varchar("text", { length: 4000 }).notNull(),
    targetCount: integer("targetCount").notNull(),
    sentCount: integer("sentCount").notNull(),
    failedCount: integer("failedCount").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ createdIdx: index("bot_broadcast_log_created_idx").on(t.createdAt) }),
);
export type BotBroadcastLog = typeof botBroadcastLog.$inferSelect;
export type InsertBotBroadcastLog = typeof botBroadcastLog.$inferInsert;

export const settings = pgTable("settings", {
  userId: integer("userId").primaryKey(),
  currency: varchar("currency", { length: 8 }).default("THB").notNull(),
  theme: themeEnum("theme").default("dark").notNull(),
  // เลขบัญชีของผู้ใช้เอง (ตัวเลขล้วน ไม่มี - หรือเว้นวรรค) ใช้เทียบกับ receiverAccount ตอนสแกนสลิป
  // เพื่อ detect ว่าเป็นรายรับ (มีคนโอนเข้าบัญชีนี้) หรือรายจ่าย (โอนออกจากบัญชีนี้)
  myAccountNumber: varchar("myAccountNumber", { length: 40 }),
  // JSON string: { income: string[], expense: string[], saving: string[] }
  customCategories: text("customCategories"),
  // JSON string: { income: string[], expense: string[], saving: string[] } — default cats hidden by user
  deletedDefaultCategories: text("deletedDefaultCategories"),
  // JSON string: NotifSettings
  notificationSettings: text("notificationSettings"),
  // salt:hash (scrypt, hex) ของรหัส PIN ล็อกหน้าเว็บ — null = ยังไม่ได้ตั้ง/ปิดอยู่
  pinHash: varchar("pinHash", { length: 255 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Settings = typeof settings.$inferSelect;
export type InsertSettings = typeof settings.$inferInsert;

/** Runtime app-wide key/value config (e.g. admin-tunable scheduler settings). */
export const appConfig = pgTable("app_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type AppConfig = typeof appConfig.$inferSelect;
