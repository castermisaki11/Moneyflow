import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Clock,
  Loader2,
  LogOut,
  Mail,
  Pencil,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

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

/** Initials for the avatar circle — first grapheme of the name, or "?" */
function initial(name: string | null | undefined): string {
  const n = (name || "").trim();
  return n ? Array.from(n)[0].toUpperCase() : "?";
}

/** Avatar: provider photo when available, falling back to the initial
 *  circle if the CDN URL is missing or fails to load. */
function Avatar({
  pictureUrl,
  name,
  isAdmin,
}: {
  pictureUrl: string | null | undefined;
  name: string | null;
  isAdmin: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!pictureUrl && !imgFailed;

  return (
    <div
      className="w-16 h-16 shrink-0 rounded-full grid place-items-center text-xl font-bold text-white shadow-lg overflow-hidden"
      style={{
        background: isAdmin
          ? "linear-gradient(135deg,#6366f1,#a855f7)"
          : "linear-gradient(135deg,#3b82f6,#06b6d4)",
      }}
    >
      {showImg ? (
        <img
          src={pictureUrl!}
          alt=""
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initial(name)
      )}
    </div>
  );
}

export function AccountView() {
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      sessionStorage.removeItem("moneyflow.pinUnlockedAt");
      sessionStorage.removeItem("moneyflow.pinUnlockedUserId");
      queryClient.clear();
      setLocation("/login", { replace: true });
    },
  });

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const user = me.data;

  // Keep the draft in sync whenever the fresh name arrives / editing starts
  useEffect(() => {
    if (user) setNameDraft(user.name || "");
  }, [user?.id, editingName]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateName = trpc.auth.updateName.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      setEditingName(false);
      toast.success("อัปเดตชื่อที่แสดงแล้ว");
    },
    onError: (err) => toast.error(err.message || "แก้ไขชื่อไม่สำเร็จ"),
  });

  if (me.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> กำลังโหลด...
      </div>
    );
  }

  if (!user) return null;

  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-4">
      {/* Profile header card */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-5 mf-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl pointer-events-none"
          style={{ background: "#6366f1", opacity: 0.15 }}
        />
        <div className="flex items-center gap-4">
          <Avatar pictureUrl={user.pictureUrl} name={user.name} isAdmin={isAdmin} />
          <div className="min-w-0 flex-1">
            {/* Display name — inline editable */}
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={80}
                  autoFocus
                  className="h-8 max-w-[240px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && nameDraft.trim()) updateName.mutate({ name: nameDraft.trim() });
                    if (e.key === "Escape") setEditingName(false);
                  }}
                />
                <Button
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={updateName.isPending || !nameDraft.trim()}
                  onClick={() => updateName.mutate({ name: nameDraft.trim() })}
                  title="บันทึกชื่อ"
                >
                  {updateName.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group flex items-center gap-1.5 max-w-full text-left"
                title="แก้ไขชื่อที่แสดง"
              >
                <span className="text-lg font-bold truncate">{user.name || "(ไม่มีชื่อ)"}</span>
                <Pencil className="w-3.5 h-3.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            <div className="text-sm text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              {user.email || "—"}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                  isAdmin ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {isAdmin ? <ShieldCheck className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                {isAdmin ? "แอดมิน" : "ผู้ใช้ทั่วไป"}
              </span>
              {user.loginMethod && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
                  เข้าสู่ระบบด้วย {LOGIN_METHOD_LABEL[user.loginMethod] ?? user.loginMethod}
                </span>
              )}
            </div>
          </div>
        </div>

        {editingName && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            ชื่อที่แก้จะถูกเก็บไว้ — จะไม่ถูกเปลี่ยนกลับโดย Discord/Google เมื่อเข้าสู่ระบบครั้งถัดไป
            (Enter เพื่อบันทึก, Esc เพื่อยกเลิก)
          </p>
        )}

        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full sm:w-auto"
          disabled={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          {logoutMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          ) : (
            <LogOut className="w-3.5 h-3.5 mr-1.5" />
          )}
          ออกจากระบบ
        </Button>
      </div>

      {/* Account details */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card space-y-3">
        <div className="text-sm font-semibold">ข้อมูลบัญชี</div>
        <ul className="divide-y divide-border/50 text-sm">
          <li className="flex items-start justify-between gap-3 py-2">
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" /> สมัครเมื่อ
            </span>
            <span className="text-right whitespace-nowrap">{fmtDate(user.createdAt)}</span>
          </li>
          <li className="flex items-start justify-between gap-3 py-2">
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Clock className="w-3.5 h-3.5 shrink-0" /> เข้าสู่ระบบล่าสุด
            </span>
            <span className="text-right whitespace-nowrap">{fmtDate(user.lastSignedIn)}</span>
          </li>
          <li className="flex items-start justify-between gap-3 py-2">
            <span className="text-muted-foreground text-xs">รูปโปรไฟล์</span>
            <span>{user.pictureUrl ? `จาก ${LOGIN_METHOD_LABEL[user.loginMethod ?? ""] ?? user.loginMethod}` : "—"}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
