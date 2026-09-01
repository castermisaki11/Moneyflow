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

export const settings = pgTable("settings", {
  userId: integer("userId").primaryKey(),
  currency: varchar("currency", { length: 8 }).default("THB").notNull(),
  theme: themeEnum("theme").default("dark").notNull(),
  myAccountNumber: varchar("myAccountNumber", { length: 40 }),
  customCategories: text("customCategories"),
  deletedDefaultCategories: text("deletedDefaultCategories"),
  pinHash: varchar("pinHash", { length: 255 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Settings = typeof settings.$inferSelect;
export type InsertSettings = typeof settings.$inferInsert;

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

export const appConfig = pgTable("app_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type AppConfig = typeof appConfig.$inferSelect;
