/**
 * Receipt photos sent through the Telegram bot.
 * A photo message (or an image document) is downloaded from Telegram and
 * attached to the user's most recent transaction, so the web UI can show a
 * 📎 and open the slip later.
 */
import {
  createAttachment,
  findUserIdByTelegramChatId,
  listTransactions,
} from "../db";
import { saveAttachmentFile } from "./attachmentStore";
import { ENV } from "./env";

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

interface TgDocument {
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

const API_BASE = "https://api.telegram.org";

/** Local sender (avoids an import cycle with telegram.ts). Never throws. */
async function reply(chatId: string, text: string): Promise<void> {
  try {
    if (!ENV.telegramBotToken) return;
    await fetch(`${API_BASE}/bot${ENV.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error("[telegram] reply failed:", err);
  }
}

/** Download a Telegram file by id. Returns null on any failure. */
export async function getTelegramFileBuffer(fileId: string): Promise<Buffer | null> {
  try {
    const metaRes = await fetch(`${API_BASE}/bot${ENV.telegramBotToken}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const meta = (await metaRes.json()) as { ok: boolean; result?: { file_path?: string } };
    if (!meta.ok || !meta.result?.file_path) return null;

    const fileRes = await fetch(`${API_BASE}/file/bot${ENV.telegramBotToken}/${meta.result.file_path}`);
    if (!fileRes.ok) return null;
    return Buffer.from(await fileRes.arrayBuffer());
  } catch (err) {
    console.error("[telegram] getFile failed:", err);
    return null;
  }
}

function guessMime(doc: TgDocument | undefined, fallback = "image/jpeg"): string {
  const m = doc?.mime_type;
  return m && m.startsWith("image/") ? m : fallback;
}

/**
 * Entry point from handleUpdate for photo / image-document messages.
 * Attaches to the most recent transaction; replies with guidance otherwise.
 */
export async function handleReceiptPhoto(
  chatId: string,
  photoSizes: TgPhotoSize[] | null,
  doc: TgDocument | undefined,
): Promise<void> {
  const userId = await findUserIdByTelegramChatId(chatId);
  if (!userId) {
    await reply(
      chatId,
      "ยังไม่ได้เชื่อมต่อบัญชี MoneyFlow กับแชทนี้ครับ 🙏\nเปิดแอป แล้วไปที่ ตั้งค่า → แจ้งเตือน Telegram เพื่อเชื่อมต่อก่อน",
    );
    return;
  }

  const latest = (await listTransactions(userId, { limit: 1 }))[0];
  if (!latest) {
    await reply(
      chatId,
      "📷 ยังไม่มีรายการให้แนบสลิป — บันทึกรายการก่อน เช่น พิมพ์ \"กาแฟ 60\" แล้วส่งรูปสลิปมาครับ",
    );
    return;
  }

  // For compressed photos pick the largest size (best quality available).
  let fileId: string | undefined;
  if (photoSizes && photoSizes.length > 0) {
    fileId = photoSizes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)).file_id;
  } else if (doc) {
    fileId = doc.file_id;
  }
  if (!fileId) {
    await reply(chatId, "❌ อ่านรูปไม่สำเร็จ ลองส่งใหม่อีกครั้งครับ");
    return;
  }

  const buffer = await getTelegramFileBuffer(fileId);
  if (!buffer || buffer.length === 0) {
    await reply(chatId, "❌ ดาวน์โหลดรูปจาก Telegram ไม่สำเร็จ ลองใหม่อีกครั้งครับ");
    return;
  }
  if (buffer.length > 10 * 1024 * 1024) {
    await reply(chatId, "❌ ไฟล์ใหญ่เกิน 10MB ครับ");
    return;
  }

  const mimeType = guessMime(doc);
  const label =
    latest.category ||
    (latest.type === "income" ? "รายรับ" : latest.type === "saving" ? "เงินออม" : "รายจ่าย");

  try {
    const fileKey = await saveAttachmentFile(userId, buffer, mimeType);
    await createAttachment({
      userId,
      transactionId: latest.id,
      fileKey,
      fileName: doc?.file_name ?? `slip-${Date.now()}`,
      mimeType,
      sizeBytes: buffer.length,
    });
    await reply(
      chatId,
      `📎 แนบสลิปกับรายการล่าสุดแล้ว!\n${label} ${Number(latest.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท\nดูรูปได้ที่เว็บ → รายการ (ไอคอน 📎)`,
    );
  } catch (err) {
    console.error("[telegram] save receipt failed:", err);
    await reply(chatId, "❌ บันทึกสลิปไม่สำเร็จ ลองใหม่อีกครั้งครับ");
  }
}
