/**
 * Disk storage for receipt photos sent through the Telegram bot.
 * Files live under data/attachments/<userId>/ (gitignored) and are served
 * through the authenticated GET /api/attachments/:id route.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = path.resolve(process.cwd(), "data", "attachments");

function safeExt(mimeType: string): string {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  return ".jpg";
}

export async function saveAttachmentFile(
  userId: number,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, String(userId));
  await mkdir(dir, { recursive: true });
  const fileKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt(mimeType)}`;
  await writeFile(path.join(dir, fileKey), buffer);
  return `${userId}/${fileKey}`;
}

export async function readAttachmentFile(fileKey: string): Promise<Buffer | null> {
  const abs = path.join(STORAGE_ROOT, fileKey);
  // Prevent path traversal — the key must stay inside STORAGE_ROOT.
  if (!abs.startsWith(STORAGE_ROOT + path.sep)) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}
