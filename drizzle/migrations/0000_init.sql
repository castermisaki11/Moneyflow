-- ============================================================
--  MoneyFlow — Supabase Migration
--  วิ่งใน Supabase SQL Editor ได้เลย (idempotent)
-- ============================================================

-- ── Enum Types ───────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "role"     AS ENUM ('user','admin');              EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "tx_type"  AS ENUM ('income','expense','saving'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "period"   AS ENUM ('daily','weekly','monthly','yearly'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "freq"     AS ENUM ('daily','weekly','monthly','yearly'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "priority" AS ENUM ('high','medium','low');       EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "theme"    AS ENUM ('dark','light','auto');       EXCEPTION WHEN duplicate_object THEN null; END $$;

-- เพิ่ม daily ถ้า enum มีอยู่แล้วแต่ยังไม่มี daily
DO $$ BEGIN ALTER TYPE "freq"   ADD VALUE IF NOT EXISTS 'daily'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE "period" ADD VALUE IF NOT EXISTS 'daily'; EXCEPTION WHEN others THEN null; END $$;

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "users" (
  "id"           serial        PRIMARY KEY,
  "openId"       varchar(64)   NOT NULL UNIQUE,
  "name"         text,
  "email"        varchar(320)  NOT NULL UNIQUE,
  "passwordHash" varchar(255)  NOT NULL,
  "loginMethod"  varchar(64),
  "role"         "role"        NOT NULL DEFAULT 'user',
  "createdAt"    timestamp     NOT NULL DEFAULT now(),
  "updatedAt"    timestamp     NOT NULL DEFAULT now(),
  "lastSignedIn" timestamp     NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "transactions" (
  "id"         serial        PRIMARY KEY,
  "userId"     integer       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type"       "tx_type"     NOT NULL,
  "amount"     decimal(14,2) NOT NULL,
  "category"   varchar(120),
  "note"       varchar(500),
  "occurredAt" bigint        NOT NULL,
  "createdAt"  timestamp     NOT NULL DEFAULT now(),
  "updatedAt"  timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tx_user_idx"          ON "transactions" ("userId");
CREATE INDEX IF NOT EXISTS "tx_user_occurred_idx" ON "transactions" ("userId","occurredAt");

CREATE TABLE IF NOT EXISTS "budgets" (
  "id"          serial        PRIMARY KEY,
  "userId"      integer       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category"    varchar(120)  NOT NULL,
  "limitAmount" decimal(14,2) NOT NULL,
  "period"      "period"      NOT NULL DEFAULT 'monthly',
  "createdAt"   timestamp     NOT NULL DEFAULT now(),
  "updatedAt"   timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "budget_user_idx" ON "budgets" ("userId");

CREATE TABLE IF NOT EXISTS "goals" (
  "id"           serial        PRIMARY KEY,
  "userId"       integer       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"         varchar(200)  NOT NULL,
  "emoji"        varchar(16)   DEFAULT '🎯',
  "targetAmount" decimal(14,2) NOT NULL,
  "savedAmount"  decimal(14,2) NOT NULL DEFAULT 0,
  "deadline"     bigint,
  "createdAt"    timestamp     NOT NULL DEFAULT now(),
  "updatedAt"    timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "goals_user_idx" ON "goals" ("userId");

CREATE TABLE IF NOT EXISTS "wishlist" (
  "id"        serial        PRIMARY KEY,
  "userId"    integer       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"      varchar(200)  NOT NULL,
  "price"     decimal(14,2) NOT NULL,
  "priority"  "priority"    NOT NULL DEFAULT 'medium',
  "createdAt" timestamp     NOT NULL DEFAULT now(),
  "updatedAt" timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "wishlist_user_idx" ON "wishlist" ("userId");

CREATE TABLE IF NOT EXISTS "recurring" (
  "id"        serial        PRIMARY KEY,
  "userId"    integer       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS "attachments" (
  "id"            serial        PRIMARY KEY,
  "userId"        integer       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "transactionId" integer       NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
  "fileKey"       varchar(400)  NOT NULL,
  "fileUrl"       varchar(500)  NOT NULL,
  "fileName"      varchar(300)  NOT NULL,
  "mimeType"      varchar(120)  NOT NULL,
  "sizeBytes"     integer       NOT NULL,
  "createdAt"     timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "att_user_idx" ON "attachments" ("userId");
CREATE INDEX IF NOT EXISTS "att_tx_idx"   ON "attachments" ("transactionId");

CREATE TABLE IF NOT EXISTS "settings" (
  "userId"    integer    PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "currency"  varchar(8) NOT NULL DEFAULT 'THB',
  "theme"     "theme"    NOT NULL DEFAULT 'dark',
  "updatedAt" timestamp  NOT NULL DEFAULT now()
);

-- ── Row Level Security (RLS) ─────────────────────────────────
-- เปิด RLS ทุก table เพื่อให้ user เห็นแค่ข้อมูลตัวเอง

ALTER TABLE "users"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goals"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wishlist"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings"      ENABLE ROW LEVEL SECURITY;

-- users: เห็นแค่ row ของตัวเอง
DROP POLICY IF EXISTS "users_self" ON "users";
CREATE POLICY "users_self" ON "users"
  USING ("id" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));

-- transactions
DROP POLICY IF EXISTS "transactions_owner" ON "transactions";
CREATE POLICY "transactions_owner" ON "transactions"
  USING ("userId" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));

-- budgets
DROP POLICY IF EXISTS "budgets_owner" ON "budgets";
CREATE POLICY "budgets_owner" ON "budgets"
  USING ("userId" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));

-- goals
DROP POLICY IF EXISTS "goals_owner" ON "goals";
CREATE POLICY "goals_owner" ON "goals"
  USING ("userId" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));

-- wishlist
DROP POLICY IF EXISTS "wishlist_owner" ON "wishlist";
CREATE POLICY "wishlist_owner" ON "wishlist"
  USING ("userId" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));

-- recurring
DROP POLICY IF EXISTS "recurring_owner" ON "recurring";
CREATE POLICY "recurring_owner" ON "recurring"
  USING ("userId" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));

-- attachments
DROP POLICY IF EXISTS "attachments_owner" ON "attachments";
CREATE POLICY "attachments_owner" ON "attachments"
  USING ("userId" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));

-- settings
DROP POLICY IF EXISTS "settings_owner" ON "settings";
CREATE POLICY "settings_owner" ON "settings"
  USING ("userId" = (SELECT "id" FROM "users" WHERE "openId" = auth.uid()::text));
