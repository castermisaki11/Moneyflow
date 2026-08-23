import { COOKIE_NAME, REFRESH_COOKIE_NAME, ONE_YEAR_MS, SEVEN_DAYS_MS, THIRTY_DAYS_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  addToGoal,
  createBudget,
  createGoal,
  createRecurring,
  createTransaction,
  createWish,
  deleteBudget,
  deleteGoal,
  deleteRecurring,
  deleteTransaction,
  deleteUser,
  deleteWish,
  getSettings,
  getUserById,
  listBudgets,
  listGoals,
  listRecurring,
  listReminderLogs,
  listTransactions,
  listUsersForAdmin,
  listWishlist,
  setRecurringNext,
  setUserRole,
  upsertSettings,
  updateTransaction,
  toggleWishBought,
} from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { botRouter } from "./_core/botRouter";
import { securityRouter } from "./_core/securityRouter";
import { systemRouter } from "./_core/systemRouter";
import { telegramRouter } from "./_core/telegramRouter";
import { mergeNotifJsonStrings } from "./_core/notifSettings";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

// Helper function to extract salt and hash from stored password
function extractSaltAndHash(storedPassword: string): { salt: Buffer; hash: Buffer } {
  const buf = Buffer.from(storedPassword, "base64");
  return {
    salt: buf.slice(0, 16),
    hash: buf.slice(16),
  };
}

const txTypeEnum = z.enum(["income", "expense", "saving"]);
const freqEnum = z.enum(["daily", "weekly", "monthly", "yearly"]);
const periodEnum = z.enum(["daily", "weekly", "monthly", "yearly"]);
const priorityEnum = z.enum(["high", "medium", "low"]);
const themeEnum = z.enum(["dark", "light", "auto"]);

function advanceDate(nextDate: number, freq: "daily" | "weekly" | "monthly" | "yearly"): number {
  const d = new Date(nextDate);
  if (freq === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (freq === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (freq === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
}

export const appRouter = router({
  system: systemRouter,
  telegram: telegramRouter,
  security: securityRouter,
  bot: botRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, cookieOptions);
      ctx.res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
      return { success: true } as const;
    }),

  }),

  admin: router({
    listUsers: adminProcedure.query(() => listUsersForAdmin()),

    listReminderLogs: adminProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .query(({ input }) => listReminderLogs(input.userId)),

    // Prevent an admin from locking themselves (or the last admin) out by
    // accident — the server enforces this, not just the UI.
    setUserRole: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          role: z.enum(["admin", "user"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id && input.role === "user") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "ลดสิทธิ์ตัวเองไม่ได้ครับ" });
        }
        await setUserRole(input.userId, input.role);
        return { success: true } as const;
      }),

    // Irreversible — wipes the user's account and every row of their data.
    // Server-side guardrails mirror setUserRole: can't be used to delete
    // yourself (avoids an admin accidentally locking everyone out mid-session)
    // or an admin account (must be demoted to "user" first, so removal is
    // always a deliberate two-step action).
    deleteUser: adminProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "ลบบัญชีตัวเองไม่ได้ครับ" });
        }
        const target = await getUserById(input.userId);
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "ไม่พบผู้ใช้นี้" });
        }
        if (target.role === "admin") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "ลดสิทธิ์เป็นผู้ใช้ทั่วไปก่อนถึงจะลบได้ครับ",
          });
        }
        await deleteUser(input.userId);
        return { success: true } as const;
      }),
  }),

  transactions: router({
    list: protectedProcedure
      .input(
        z
          .object({
            from: z.number().optional(),
            to: z.number().optional(),
            type: txTypeEnum.optional(),
            category: z.string().optional(),
            limit: z.number().int().positive().max(1000).optional(),
          })
          .optional(),
      )
      .query(({ ctx, input }) => listTransactions(ctx.user.id, input ?? {})),

    create: protectedProcedure
      .input(
        z.object({
          type: txTypeEnum,
          amount: z.number().positive(),
          category: z.string().max(120).optional().nullable(),
          note: z.string().max(500).optional().nullable(),
          occurredAt: z.number(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = await createTransaction({
          userId: ctx.user.id,
          type: input.type,
          amount: String(input.amount) as any,
          category: input.category ?? null,
          note: input.note ?? null,
          occurredAt: input.occurredAt,
        });
        return { id };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => deleteTransaction(ctx.user.id, input.id)),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          type: txTypeEnum.optional(),
          amount: z.number().positive().optional(),
          category: z.string().max(120).optional().nullable(),
          note: z.string().max(500).optional().nullable(),
          occurredAt: z.number().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, amount, ...rest } = input;
        await updateTransaction(ctx.user.id, id, {
          ...rest,
          ...(amount !== undefined ? { amount: String(amount) } : {}),
        });
      }),
  }),

  budgets: router({
    list: protectedProcedure.query(({ ctx }) => listBudgets(ctx.user.id)),
    create: protectedProcedure
      .input(
        z.object({
          category: z.string().min(1).max(120),
          limitAmount: z.number().positive(),
          period: periodEnum.default("monthly"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = await createBudget({
          userId: ctx.user.id,
          category: input.category,
          limitAmount: String(input.limitAmount) as any,
          period: input.period,
        });
        return { id };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => deleteBudget(ctx.user.id, input.id)),
  }),

  goals: router({
    list: protectedProcedure.query(({ ctx }) => listGoals(ctx.user.id)),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(200),
          emoji: z.string().max(8).optional(),
          targetAmount: z.number().positive(),
          deadline: z.number().optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = await createGoal({
          userId: ctx.user.id,
          name: input.name,
          emoji: input.emoji || "🎯",
          targetAmount: String(input.targetAmount) as any,
          deadline: input.deadline ?? null,
        });
        return { id };
      }),
    addAmount: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), amount: z.number().positive() }))
      .mutation(({ ctx, input }) => addToGoal(ctx.user.id, input.id, input.amount)),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => deleteGoal(ctx.user.id, input.id)),
  }),

  wishlist: router({
    list: protectedProcedure.query(({ ctx }) => listWishlist(ctx.user.id)),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(200),
          price: z.number().positive(),
          priority: priorityEnum.default("medium"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = await createWish({
          userId: ctx.user.id,
          name: input.name,
          price: String(input.price) as any,
          priority: input.priority,
        });
        return { id };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => deleteWish(ctx.user.id, input.id)),
    toggleBought: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => toggleWishBought(ctx.user.id, input.id)),
  }),

  recurring: router({
    list: protectedProcedure.query(({ ctx }) => listRecurring(ctx.user.id)),
    create: protectedProcedure
      .input(
        z.object({
          type: txTypeEnum,
          amount: z.number().positive(),
          category: z.string().max(120).optional().nullable(),
          note: z.string().max(500).optional().nullable(),
          freq: freqEnum.default("monthly"),
          nextDate: z.number(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = await createRecurring({
          userId: ctx.user.id,
          type: input.type,
          amount: String(input.amount) as any,
          category: input.category ?? null,
          note: input.note ?? null,
          freq: input.freq,
          nextDate: input.nextDate,
        });
        return { id };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => deleteRecurring(ctx.user.id, input.id)),
    runNow: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const items = await listRecurring(ctx.user.id);
        const item = items.find((r) => r.id === input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Recurring not found" });
        await createTransaction({
          userId: ctx.user.id,
          type: item.type,
          amount: item.amount,
          category: item.category ?? null,
          note: item.note ?? null,
          occurredAt: Date.now(),
        });
        const next = advanceDate(item.nextDate, item.freq);
        await setRecurringNext(ctx.user.id, item.id, next);
        return { nextDate: next };
      }),
  }),

  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const s = await getSettings(ctx.user.id);
      // ไม่ส่ง pinHash ออกไปที่ client เด็ดขาด (ใช้ security.status แทนสำหรับเช็คว่าตั้ง PIN ไว้หรือยัง)
      const { pinHash: _pinHash, ...rest } = (s ?? {}) as any;
      return Object.keys(rest).length
        ? rest
        : {
            userId: ctx.user.id,
            currency: "THB",
            theme: "dark" as const,
            myAccountNumber: null,
            customCategories: null,
            deletedDefaultCategories: null,
            notificationSettings: null,
          };
    }),
    update: protectedProcedure
      .input(
        z.object({
          currency: z.string().min(1).max(8).optional(),
          theme: themeEnum.optional(),
          myAccountNumber: z.string().max(40).optional().nullable(),
          customCategories: z.string().optional().nullable(),
          deletedDefaultCategories: z.string().optional().nullable(),
          notificationSettings: z.string().optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const current = await getSettings(ctx.user.id);
        await upsertSettings({
          userId: ctx.user.id,
          currency: input.currency ?? current?.currency ?? "THB",
          theme: input.theme ?? current?.theme ?? "dark",
          myAccountNumber: input.myAccountNumber !== undefined ? input.myAccountNumber : ((current as any)?.myAccountNumber ?? null),
          customCategories: input.customCategories !== undefined ? input.customCategories : (current?.customCategories ?? null),
          deletedDefaultCategories: input.deletedDefaultCategories !== undefined ? input.deletedDefaultCategories : ((current as any)?.deletedDefaultCategories ?? null),
          // Merge (not overwrite) so server-managed fields — Telegram link state,
          // daily-reminder settings, dedupe bookkeeping — survive edits made from
          // the client's narrower notification-preferences form.
          notificationSettings: input.notificationSettings !== undefined
            ? mergeNotifJsonStrings((current as any)?.notificationSettings, input.notificationSettings)
            : ((current as any)?.notificationSettings ?? null),
          // การตั้งค่า PIN แก้ผ่าน security.setPin/disablePin เท่านั้น — เก็บค่าเดิมไว้เสมอ
          pinHash: (current as any)?.pinHash ?? null,
        } as any);
        const updated = await getSettings(ctx.user.id);
        const { pinHash: _pinHash, ...rest } = (updated ?? {}) as any;
        return rest;
      }),
  }),
});

export type AppRouter = typeof appRouter;
