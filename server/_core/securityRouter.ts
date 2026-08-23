import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSettings, setPinHash } from "../db";
import { hashPin, isPinLockedOut, recordPinAttempt, verifyPinHash } from "./pin";
import { protectedProcedure, router } from "./trpc";

const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "รหัส PIN ต้องเป็นตัวเลข 4-6 หลัก");

export const securityRouter = router({
  /** Whether this user currently has a PIN set (shown in Settings + used by the lock screen). */
  status: protectedProcedure.query(async ({ ctx }) => {
    const s = await getSettings(ctx.user.id);
    return { pinEnabled: Boolean((s as any)?.pinHash) };
  }),

  /** Sets a new PIN, or changes it (must supply the current PIN if one is already set). */
  setPin: protectedProcedure
    .input(z.object({ pin: pinSchema, currentPin: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const s = await getSettings(ctx.user.id);
      const existingHash = (s as any)?.pinHash as string | null | undefined;
      if (existingHash) {
        if (!input.currentPin || !verifyPinHash(input.currentPin, existingHash)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "รหัส PIN เดิมไม่ถูกต้อง" });
        }
      }
      await setPinHash(ctx.user.id, hashPin(input.pin));
      return { success: true };
    }),

  /** Turns the lock off entirely (requires the current PIN). */
  disablePin: protectedProcedure
    .input(z.object({ currentPin: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const s = await getSettings(ctx.user.id);
      const existingHash = (s as any)?.pinHash as string | null | undefined;
      if (!existingHash || !verifyPinHash(input.currentPin, existingHash)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "รหัส PIN ไม่ถูกต้อง" });
      }
      await setPinHash(ctx.user.id, null);
      return { success: true };
    }),

  /** Called by the lock screen to check a typed PIN. Throttled after repeated failures. */
  verifyPin: protectedProcedure
    .input(z.object({ pin: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const lockedForMs = isPinLockedOut(ctx.user.id);
      if (lockedForMs > 0) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `ลองผิดหลายครั้งเกินไป กรุณารออีก ${Math.ceil(lockedForMs / 1000)} วินาที`,
        });
      }
      const s = await getSettings(ctx.user.id);
      const existingHash = (s as any)?.pinHash as string | null | undefined;
      if (!existingHash) return { valid: true }; // ไม่ได้ตั้ง PIN ไว้ ถือว่าปลดล็อกได้เสมอ
      const valid = verifyPinHash(input.pin, existingHash);
      recordPinAttempt(ctx.user.id, valid);
      return { valid };
    }),
});
