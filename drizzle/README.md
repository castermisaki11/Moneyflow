# Migrations

**No manual step needed.** Every time the server starts (including on every
deploy/restart on Render or any host), `server/_core/index.ts` calls
`runMigrations()` from `server/_core/migrate.ts` *before* it starts listening.
That function runs idempotent `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF
NOT EXISTS` statements, so the database schema is always brought up to date
automatically — fresh database or existing one, no `pnpm db:push` required.

## When you add/change something in `drizzle/schema.ts`

The auto-migration in `migrate.ts` is hand-written SQL, not generated from
`schema.ts` automatically. So whenever you add a new table, column, or enum
value to `schema.ts`, you must also add the matching idempotent SQL
(`CREATE TABLE IF NOT EXISTS ...` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS
...` / `ALTER TYPE ... ADD VALUE IF NOT EXISTS ...`) to `SETUP_SQL` in
`server/_core/migrate.ts`. Once that's committed, the next deploy applies it
automatically — still no manual command to run.

`pnpm db:push` (drizzle-kit generate + migrate) still exists as an optional
local-dev convenience if you want drizzle-kit to manage migration files
instead, but it is not part of the deploy flow and nothing depends on it.
