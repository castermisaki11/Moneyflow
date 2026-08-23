import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, CheckCircle2, Repeat } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export type MfNotification = {
  id: string;
  kind: "budget_over" | "recurring_due";
  title: string;
  detail: string;
};

const READ_KEY = "mf-notif-read-v1";

function getRead(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) || "{}");
  } catch {
    return {};
  }
}
function setRead(m: Record<string, boolean>) {
  localStorage.setItem(READ_KEY, JSON.stringify(m));
}

export default function NotificationBell({ items }: { items: MfNotification[] }) {
  const [read, setReadState] = useState<Record<string, boolean>>(() => getRead());
  const unread = useMemo(() => items.filter((i) => !read[i.id]), [items, read]);
  const [open, setOpen] = useState(false);

  // Toast + native notify for new unread items (one-shot per id)
  useEffect(() => {
    const toastKey = "mf-notif-toasted-v1";
    let seen: Record<string, boolean> = {};
    try {
      seen = JSON.parse(localStorage.getItem(toastKey) || "{}");
    } catch {}
    let hasNew = false;
    for (const n of unread) {
      if (seen[n.id]) continue;
      hasNew = true;
      seen[n.id] = true;
      toast(n.title, { description: n.detail });
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(n.title, { body: n.detail, icon: "/icon-192.png" });
        } catch {}
      }
    }
    if (hasNew) localStorage.setItem(toastKey, JSON.stringify(seen));
  }, [unread]);

  const requestPerm = async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      toast.success("เปิดการแจ้งเตือนแล้ว");
      return;
    }
    const p = await Notification.requestPermission();
    if (p === "granted") toast.success("เปิดการแจ้งเตือนแล้ว");
    else toast("ยังไม่ได้อนุญาตการแจ้งเตือน");
  };

  const markAllRead = () => {
    const m = { ...read };
    items.forEach((n) => (m[n.id] = true));
    setRead(m);
    setReadState(m);
  };

  const markOne = (id: string) => {
    const m = { ...read, [id]: true };
    setRead(m);
    setReadState(m);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="w-5 h-5" />
          {unread.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
              {unread.length > 99 ? "99+" : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,340px)] p-0">
        <div className="px-3 py-2 flex items-center justify-between border-b border-border">
          <div className="text-sm font-semibold">การแจ้งเตือน</div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={requestPerm}>
              เปิดแจ้งเตือน
            </Button>
            {unread.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAllRead}>
                อ่านทั้งหมด
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-[360px] overflow-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 opacity-60" />
              ยังไม่มีแจ้งเตือน
            </div>
          ) : (
            <ul>
              {items.map((n) => {
                const isRead = !!read[n.id];
                return (
                  <li
                    key={n.id}
                    className={`px-3 py-2.5 border-b border-border/60 text-sm cursor-pointer transition-colors ${
                      isRead ? "opacity-70" : "bg-accent/40"
                    } hover:bg-accent/60`}
                    onClick={() => markOne(n.id)}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                          n.kind === "budget_over"
                            ? "bg-rose-500/15 text-rose-500"
                            : "bg-amber-500/15 text-amber-500"
                        }`}
                      >
                        {n.kind === "budget_over" ? "!" : <Repeat className="w-3.5 h-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm leading-snug break-words">{n.title}</div>
                        <div className="text-xs text-muted-foreground leading-snug break-words">{n.detail}</div>
                      </div>
                      {!isRead && <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
