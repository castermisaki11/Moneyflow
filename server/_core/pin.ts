import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * PIN hashing (scrypt, salted). Stored as "<saltHex>:<hashHex>" in
 * settings.pinHash. This is a *UI privacy lock* on top of an already
 * authenticated session (cookie), not a replacement for login — so a
 * simple, dependency-free scheme is enough here.
 */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPinHash(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(pin, salt, 32);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── Brute-force throttle (in-memory, per user) ─────────────────────────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 1000;

type AttemptState = { fails: number; lockedUntil: number };
const attempts = new Map<number, AttemptState>();

export function isPinLockedOut(userId: number): number {
  const s = attempts.get(userId);
  if (!s) return 0;
  const remaining = s.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function recordPinAttempt(userId: number, success: boolean): void {
  if (success) {
    attempts.delete(userId);
    return;
  }
  const s = attempts.get(userId) ?? { fails: 0, lockedUntil: 0 };
  s.fails += 1;
  if (s.fails >= MAX_ATTEMPTS) {
    s.lockedUntil = Date.now() + LOCKOUT_MS;
    s.fails = 0;
  }
  attempts.set(userId, s);
}
