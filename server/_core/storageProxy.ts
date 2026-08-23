import type { Express } from "express";

// R2 files are served via public URL directly — no proxy needed.
export function registerStorageProxy(_app: Express) {}
