import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

/**
 * Robust Migration Strategy:
 * 1. SETUP: Ensure all tables and types exist (idempotent).
 * 2. RENAME: Safely migrate legacy snake_case/lowercase columns to camelCase.
 * 
 * This ensures compatibility with both fresh databases and existing ones.
 */

const SETUP_SQL = /* sql */ `
-- ── App config (runtime key/value) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE app_config DROP COLUMN IF EXISTS updated_at;

-- Wishlist feature removed — retire the table
DROP TABLE IF EXISTS "wishlist";

-- Drop Telegram bot-related tables (removed in v11.0.0)
DROP TABLE IF EXISTS "attachments" CASCADE;
DROP TABLE IF EXISTS "category_feedback" CASCADE;
DROP TABLE IF EXISTS "reminder_log" CASCADE;
DROP TABLE IF EXISTS "bot_broadcast_log" CASCADE;

-- ── Types ────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "role"     AS ENUM ('user','admin');              EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "tx_type"  AS ENUM ('income','expense','saving'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "period"   AS ENUM ('daily','weekly','monthly','yearly'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "freq"     AS ENUM ('daily','weekly','monthly','yearly'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "freq"   ADD VALUE IF NOT EXISTS 'daily';  EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE "period" ADD VALUE IF NOT EXISTS 'daily';  EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE "period" ADD VALUE IF NOT EXISTS 'weekly'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN CREATE TYPE "priority" AS ENUM ('high','medium','low');       EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "theme"    AS ENUM ('dark','light','auto');       EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Tables ───────────────────────────────────────────────────────────────
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
  "emoji"        varchar(16)   DEFAULT '🎯',
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
`;

const RENAME_SQL = /* sql */ `
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
`;

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("[Migrations] DATABASE_URL not set — skipping.");
    return;
  }

  console.log("[Migrations] Running auto migrations…");
  try {
    const db = drizzle(databaseUrl);

    // Step 1: Create tables first (safe on both fresh and existing DBs)
    await db.execute(sql.raw(SETUP_SQL));
    console.log("[Migrations] ✓ Tables ensured.");

    // Step 2: Rename legacy columns (safe — only renames if old name exists AND new name doesn't)
    await db.execute(sql.raw(RENAME_SQL));
    console.log("[Migrations] ✓ Schema is up to date.");
  } catch (err) {
    console.error("[Migrations] ✗ Failed:", err);
    throw err;
  }
}
