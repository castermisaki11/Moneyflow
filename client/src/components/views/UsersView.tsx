import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ClipboardList, Loader2, ShieldCheck, Trash2, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

const LOGIN_METHOD_LABEL: Record<string, string> = {
  discord: "Discord",
  google: "Google",
  password: "รหัสผ่าน",
};

export function UsersView() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const users = trpc.admin.listUsers.useQuery();

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string | null; email: string | null } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [logsTarget, setLogsTarget] = useState<{ id: number; name: string | null } | null>(null);

  const reminderLogs = trpc.admin.listReminderLogs.useQuery(
    { userId: logsTarget?.id ?? 0 },
    { enabled: !!logsTarget },
  );

  const setRole = trpc.admin.setUserRole.useMutation({
    onSuccess: () => {
      utils.admin.listUsers.invalidate();
      toast.success("อัปเดตสิทธิ์แล้ว");
    },
    onError: (err) => toast.error(err.message || "อัปเดตสิทธิ์ไม่สำเร็จ"),
  });

  const removeUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      utils.admin.listUsers.invalidate();
      toast.success("ลบผู้ใช้แล้ว");
      setDeleteTarget(null);
      setConfirmText("");
    },
    onError: (err) => toast.error(err.message || "ลบผู้ใช้ไม่สำเร็จ"),
  });

  // What the admin must type to unlock the delete button — email if the
  // account has one (most accounts), otherwise the display name.
  const expectedConfirmText = deleteTarget?.email || deleteTarget?.name || "";

  if (users.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> กำลังโหลด...
      </div>
    );
  }

  if (users.isError) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card text-sm text-red-400">
        โหลดรายชื่อผู้ใช้ไม่สำเร็จ — ต้องเป็นผู้ดูแลระบบเท่านั้น
      </div>
    );
  }

  const list = users.data ?? [];

  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">ผู้ใช้ทั้งหมด</div>
          <div className="text-xs text-muted-foreground">{list.length} บัญชี</div>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-border/50">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="p-2 text-left">ผู้ใช้</th>
              <th className="p-2 text-left">ช่องทาง</th>
              <th className="p-2 text-left">สิทธิ์</th>
              <th className="p-2 text-left">เข้าสู่ระบบล่าสุด</th>
              <th className="p-2 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {list.map((u) => {
              const isMe = u.id === me.data?.id;
              const isAdmin = u.role === "admin";
              return (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="p-2">
                    <div className="font-medium">{u.name || "(ไม่มีชื่อ)"}</div>
                    <div className="text-muted-foreground">{u.email || "—"}</div>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {LOGIN_METHOD_LABEL[u.loginMethod ?? ""] ?? u.loginMethod ?? "—"}
                  </td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        isAdmin ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isAdmin ? <ShieldCheck className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                      {isAdmin ? "แอดมิน" : "ผู้ใช้ทั่วไป"}
                    </span>
                  </td>
                  <td className="p-2 text-muted-foreground whitespace-nowrap">{fmtDate(u.lastSignedIn)}</td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setRole.isPending || (isMe && isAdmin)}
                        title={isMe && isAdmin ? "ลดสิทธิ์ตัวเองไม่ได้" : undefined}
                        onClick={() =>
                          setRole.mutate({ userId: u.id, role: isAdmin ? "user" : "admin" })
                        }
                      >
                        {isAdmin ? "ลดสิทธิ์เป็นผู้ใช้ทั่วไป" : "ตั้งเป็นแอดมิน"}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 shrink-0"
                        title="ดู log เตือนความจำ"
                        onClick={() => setLogsTarget({ id: u.id, name: u.name })}
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 text-red-400 hover:text-red-400 shrink-0"
                        disabled={isMe || isAdmin}
                        title={
                          isMe
                            ? "ลบบัญชีตัวเองไม่ได้"
                            : isAdmin
                              ? "ลดสิทธิ์เป็นผู้ใช้ทั่วไปก่อนถึงจะลบได้"
                              : "ลบผู้ใช้"
                        }
                        onClick={() => {
                          setConfirmText("");
                          setDeleteTarget({ id: u.id, name: u.name, email: u.email });
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  ยังไม่มีผู้ใช้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        การเพิ่มแอดมินผ่าน ID ของแต่ละ provider ทำได้ผ่าน environment variable{" "}
        <code className="bg-muted px-1 rounded">ADMIN_DISCORD_IDS</code>,{" "}
        <code className="bg-muted px-1 rounded">ADMIN_GOOGLE_IDS</code> ฯลฯ เช่นกัน — ปุ่มด้านบนนี้เปลี่ยนสิทธิ์ทันทีโดยไม่ต้อง deploy ใหม่
      </p>

      {/* Delete user — irreversible, so this requires typing the account's
          email/name back before the button unlocks (not just an "are you
          sure?" click-through). */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) {
            setDeleteTarget(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" />
              ลบผู้ใช้ถาวร
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              กำลังจะลบ{" "}
              <span className="font-semibold text-foreground">
                {deleteTarget?.name || "(ไม่มีชื่อ)"}
              </span>{" "}
              {deleteTarget?.email && (
                <span className="text-muted-foreground">({deleteTarget.email})</span>
              )}
            </p>
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-red-300 text-xs leading-relaxed">
              การลบนี้ย้อนกลับไม่ได้ — ข้อมูลทั้งหมดของผู้ใช้คนนี้ (รายการ, งบประมาณ,
              เป้าหมาย, สิ่งที่อยากได้, รายการประจำ, การตั้งค่า) จะถูกลบถาวรทันที
            </p>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                พิมพ์{" "}
                <span className="font-mono font-semibold text-foreground">
                  {expectedConfirmText}
                </span>{" "}
                เพื่อยืนยัน
              </label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setConfirmText("");
              }}
            >
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              disabled={
                removeUser.isPending ||
                !expectedConfirmText ||
                confirmText !== expectedConfirmText
              }
              onClick={() => {
                if (!deleteTarget) return;
                removeUser.mutate({ userId: deleteTarget.id });
              }}
            >
              {removeUser.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "ลบผู้ใช้ถาวร"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reminder-completion log — history of "✅ เสร็จแล้ว" taps on this
          user's fired custom reminders, most recent first. */}
      <Dialog open={!!logsTarget} onOpenChange={(v) => !v && setLogsTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              Log เตือนความจำ — {logsTarget?.name || "(ไม่มีชื่อ)"}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-auto space-y-2">
            {reminderLogs.isLoading && (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> กำลังโหลด...
              </div>
            )}
            {reminderLogs.isError && (
              <p className="text-sm text-red-400 py-4">โหลด log ไม่สำเร็จ</p>
            )}
            {reminderLogs.data?.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                ผู้ใช้คนนี้ยังไม่เคยกด "✅ เสร็จแล้ว" เลย
              </p>
            )}
            {reminderLogs.data?.map((log) => (
              <div key={log.id} className="rounded-lg border border-border/50 p-2.5 text-xs space-y-1">
                <div className="font-medium">{log.reminderText}</div>
                <div className="text-muted-foreground">เตือนเมื่อ: {fmtDate(new Date(log.firedAt))}</div>
                <div className="text-muted-foreground">กดเสร็จเมื่อ: {fmtDate(log.completedAt)}</div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLogsTarget(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
