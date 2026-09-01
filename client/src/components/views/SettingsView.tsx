import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";
import { CATEGORIES, CURRENCIES, type TxType } from "@/lib/money";
import { trpc } from "@/lib/trpc";
import { Bell, ChevronRight, Database, Gem, Laptop, Lock, Moon, Plus, Sun, Trash2 } from "lucide-react";
import PinSetupDialog from "@/components/PinSetupDialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type CustomCats = Record<TxType, string[]>;
type DeletedDefaults = Record<TxType, string[]>;

interface NotifSettings {
  budgetAlertEnabled: boolean;
  budgetAlertThreshold: number; // 0–100
  recurringReminderEnabled: boolean;
  recurringReminderDays: number; // days before due
  goalAlertEnabled: boolean;
  goalAlertThreshold: number; // 0–100 (% of target reached)
}

const DEFAULT_CUSTOM: CustomCats = { income: [], expense: [], saving: [] };
const DEFAULT_DELETED: DeletedDefaults = { income: [], expense: [], saving: [] };
const DEFAULT_NOTIF: NotifSettings = {
  budgetAlertEnabled: true,
  budgetAlertThreshold: 80,
  recurringReminderEnabled: true,
  recurringReminderDays: 3,
  goalAlertEnabled: true,
  goalAlertThreshold: 100,
};

function parseCustomCats(json: string | null | undefined): CustomCats {
  if (!json) return DEFAULT_CUSTOM;
  try {
    const parsed = JSON.parse(json);
    return {
      income: Array.isArray(parsed.income) ? parsed.income : [],
      expense: Array.isArray(parsed.expense) ? parsed.expense : [],
      saving: Array.isArray(parsed.saving) ? parsed.saving : [],
    };
  } catch {
    return DEFAULT_CUSTOM;
  }
}

function parseDeletedDefaults(json: string | null | undefined): DeletedDefaults {
  if (!json) return DEFAULT_DELETED;
  try {
    const parsed = JSON.parse(json);
    return {
      income: Array.isArray(parsed.income) ? parsed.income : [],
      expense: Array.isArray(parsed.expense) ? parsed.expense : [],
      saving: Array.isArray(parsed.saving) ? parsed.saving : [],
    };
  } catch {
    return DEFAULT_DELETED;
  }
}

function parseNotifSettings(json: string | null | undefined): NotifSettings {
  if (!json) return DEFAULT_NOTIF;
  try {
    const parsed = JSON.parse(json);
    return { ...DEFAULT_NOTIF, ...parsed };
  } catch {
    return DEFAULT_NOTIF;
  }
}

const TYPE_LABELS: Record<TxType, string> = {
  income: "รายรับ",
  expense: "รายจ่าย",
  saving: "ออม",
};

export function SettingsView({ onOpenBackup }: { onOpenBackup?: () => void }) {
  const { mode, setMode } = useTheme();
  const utils = trpc.useUtils();
  const cur = trpc.settings.get.useQuery();

  const pinStatus = trpc.security.status.useQuery();
  const [pinDialog, setPinDialog] = useState<"set" | "disable" | null>(null);

  const [currency, setCurrency] = useState<string>("THB");
  const [customCats, setCustomCats] = useState<CustomCats>(DEFAULT_CUSTOM);
  const [deletedDefaults, setDeletedDefaults] = useState<DeletedDefaults>(DEFAULT_DELETED);
  const [notif, setNotif] = useState<NotifSettings>(DEFAULT_NOTIF);
  const [newCat, setNewCat] = useState<Record<TxType, string>>({ income: "", expense: "", saving: "" });
  const [catTab, setCatTab] = useState<TxType>("expense");
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (cur.data?.currency) setCurrency(cur.data.currency);
    if (cur.data) {
      setCustomCats(parseCustomCats(cur.data.customCategories));
      setDeletedDefaults(parseDeletedDefaults((cur.data as any).deletedDefaultCategories));
      setNotif(parseNotifSettings((cur.data as any).notificationSettings));
    }
    if ("Notification" in window) setNotifPermission(Notification.permission);
    else setNotifPermission("unsupported");
  }, [cur.data]);

  const update = trpc.settings.update.useMutation({
    onMutate: async (vars) => {
      await utils.settings.get.cancel();
      const prev = utils.settings.get.getData();
      utils.settings.get.setData(undefined, (old: unknown) => ({ ...((old ?? {}) as object), ...vars }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.settings.get.setData(undefined, ctx.prev);
      toast.error("บันทึกไม่สำเร็จ");
    },
    onSuccess: () => toast.success("บันทึกการตั้งค่าแล้ว"),
    onSettled: () => utils.settings.get.invalidate(),
  });

  const saveCats = (cats: CustomCats, deleted?: DeletedDefaults) => {
    update.mutate({
      customCategories: JSON.stringify(cats),
      ...(deleted !== undefined ? { deletedDefaultCategories: JSON.stringify(deleted) } : {}),
    });
  };

  const saveNotif = (n: NotifSettings) => {
    update.mutate({});
  };

  const addCategory = (type: TxType) => {
    const val = newCat[type].trim();
    if (!val) return;
    const visible = CATEGORIES[type].filter((c) => !deletedDefaults[type].includes(c));
    const all = [...(customCats[type] || []), ...visible];
    if (all.includes(val)) { toast.error("มีหมวดหมู่นี้แล้ว"); return; }
    const updated = { ...customCats, [type]: [...(customCats[type] || []), val] };
    setCustomCats(updated);
    setNewCat((p) => ({ ...p, [type]: "" }));
    saveCats(updated);
  };

  const removeCustomCategory = (type: TxType, cat: string) => {
    const updated = { ...customCats, [type]: customCats[type].filter((c) => c !== cat) };
    setCustomCats(updated);
    saveCats(updated);
  };

  const deleteDefaultCategory = (type: TxType, cat: string) => {
    const updated = { ...deletedDefaults, [type]: [...deletedDefaults[type], cat] };
    setDeletedDefaults(updated);
    saveCats(customCats, updated);
  };

  const restoreDefaultCategory = (type: TxType, cat: string) => {
    const updated = { ...deletedDefaults, [type]: deletedDefaults[type].filter((c) => c !== cat) };
    setDeletedDefaults(updated);
    saveCats(customCats, updated);
  };

  const requestNotify = async () => {
    if (!("Notification" in window)) { toast.error("เบราว์เซอร์ไม่รองรับการแจ้งเตือน"); return; }
    const p = await Notification.requestPermission();
    setNotifPermission(p);
    if (p === "granted") toast.success("เปิดการแจ้งเตือนแล้ว");
    else toast("ยังไม่ได้เปิดสิทธิ์แจ้งเตือน");
  };

  const updateNotif = <K extends keyof NotifSettings>(key: K, value: NotifSettings[K]) => {
    const updated = { ...notif, [key]: value };
    setNotif(updated);
    saveNotif(updated);
  };

  const visibleDefaults = CATEGORIES[catTab].filter((c) => !deletedDefaults[catTab].includes(c));
  const hiddenDefaults = CATEGORIES[catTab].filter((c) => deletedDefaults[catTab].includes(c));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Backup / data — full-width entry that opens its own sub-page */}
      <button
        type="button"
        onClick={onOpenBackup}
        className="md:col-span-2 rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card mf-list-item text-left flex items-center gap-3 hover:bg-card hover:border-border transition-colors cursor-pointer"
      >
        <span className="w-10 h-10 shrink-0 rounded-xl bg-primary/10 text-primary grid place-items-center">
          <Database className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">สำรอง & กู้คืนข้อมูล (Backup)</span>
          <span className="block text-xs text-muted-foreground">Export รายการทั้งหมดเป็น JSON/CSV · Import ย้อนหลังเข้าบัญชี</span>
        </span>
        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Currency */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="text-sm font-semibold mb-2">สกุลเงิน</div>
        <div className="text-xs text-muted-foreground mb-3">ใช้สำหรับแสดงผลทั้งแอป</div>
        <div className="flex gap-2">
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.code} — {c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => update.mutate({ currency })} disabled={update.isPending || currency === cur.data?.currency}>บันทึก</Button>
        </div>
      </div>

      {/* Theme */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="text-sm font-semibold mb-2">ธีม</div>
        <div className="text-xs text-muted-foreground mb-3">เลือก "ดำทอง" ได้ทั้งที่นี่และจากปุ่มธีมบนหัวเว็บ — "ตามระบบ" ปรับสว่าง/มืดตามเครื่องอัตโนมัติ</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(
            [
              { value: "light" as const, label: "สว่าง", icon: Sun, swatch: "bg-gradient-to-br from-white to-slate-200 border border-border" },
              { value: "dark" as const, label: "มืด", icon: Moon, swatch: "bg-gradient-to-br from-slate-800 to-slate-950" },
              { value: "blackgold" as const, label: "ดำทอง", icon: Gem, swatch: "bg-gradient-to-br from-yellow-300 via-amber-500 to-black ring-1 ring-amber-400/60" },
              { value: "system" as const, label: "ตามระบบ", icon: Laptop, swatch: "bg-gradient-to-r from-white via-slate-200 to-slate-900 border border-border" },
            ]
          ).map(({ value, label, icon: Icon, swatch }) => (
            <button
              key={value}
              onClick={() => setMode && setMode(value)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs transition-colors ${
                mode === value
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              <span className={`h-4 w-4 rounded-full shrink-0 ${swatch}`} />
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Notification Settings — full width */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card md:col-span-2">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-4 h-4" />
          <div className="text-sm font-semibold">การแจ้งเตือน</div>
        </div>
        <div className="text-xs text-muted-foreground mb-4">ตั้งค่าการแจ้งเตือนสำหรับงบประมาณ รายการประจำ และเป้าหมาย</div>

        {/* Permission banner */}
        {notifPermission !== "granted" && notifPermission !== "unsupported" && (
          <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-4">
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {notifPermission === "denied" ? "การแจ้งเตือนถูกบล็อก — เปิดใน browser settings" : "ยังไม่ได้อนุญาตการแจ้งเตือน"}
            </div>
            {notifPermission === "default" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={requestNotify}>อนุญาต</Button>
            )}
          </div>
        )}
        {notifPermission === "granted" && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mb-4">
            <Bell className="w-3 h-3" /> เปิดการแจ้งเตือนแล้ว
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Budget alert */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">แจ้งเตือนงบเกิน</Label>
              <Switch
                checked={notif.budgetAlertEnabled}
                onCheckedChange={(v) => updateNotif("budgetAlertEnabled", v)}
              />
            </div>
            {notif.budgetAlertEnabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>เตือนเมื่อใช้ถึง</span>
                  <span className="font-medium text-foreground">{notif.budgetAlertThreshold}%</span>
                </div>
                <Slider
                  min={50}
                  max={100}
                  step={5}
                  value={[notif.budgetAlertThreshold]}
                  onValueChange={([v]) => updateNotif("budgetAlertThreshold", v)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>50%</span><span>75%</span><span>100%</span>
                </div>
              </div>
            )}
          </div>

          {/* Recurring reminder */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">เตือนรายการประจำ</Label>
              <Switch
                checked={notif.recurringReminderEnabled}
                onCheckedChange={(v) => updateNotif("recurringReminderEnabled", v)}
              />
            </div>
            {notif.recurringReminderEnabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>ล่วงหน้า</span>
                  <span className="font-medium text-foreground">{notif.recurringReminderDays} วัน</span>
                </div>
                <Slider
                  min={1}
                  max={14}
                  step={1}
                  value={[notif.recurringReminderDays]}
                  onValueChange={([v]) => updateNotif("recurringReminderDays", v)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>1 วัน</span><span>7 วัน</span><span>14 วัน</span>
                </div>
              </div>
            )}
          </div>

          {/* Goal alert */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">แจ้งเตือนเป้าหมาย</Label>
              <Switch
                checked={notif.goalAlertEnabled}
                onCheckedChange={(v) => updateNotif("goalAlertEnabled", v)}
              />
            </div>
            {notif.goalAlertEnabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>เตือนเมื่อสะสมถึง</span>
                  <span className="font-medium text-foreground">{notif.goalAlertThreshold}%</span>
                </div>
                <Slider
                  min={25}
                  max={100}
                  step={25}
                  value={[notif.goalAlertThreshold]}
                  onValueChange={([v]) => updateNotif("goalAlertThreshold", v)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PIN Lock */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4" />
          <div className="text-sm font-semibold">ล็อกด้วย PIN</div>
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          ตั้งรหัส PIN 4-6 หลัก เพื่อล็อกหน้าเว็บ กันคนอื่นเปิดดูข้อมูลการเงินได้ทันทีที่หยิบเครื่องขึ้นมา
        </div>

        {pinStatus.data?.pinEnabled ? (
          <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <Lock className="w-3 h-3" /> ตั้งรหัส PIN แล้ว
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPinDialog("set")}>
                เปลี่ยนรหัส
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => setPinDialog("disable")}>
                ปิดการล็อก
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={() => setPinDialog("set")}>
            <Lock className="w-4 h-4 mr-1.5" /> ตั้งรหัส PIN
          </Button>
        )}

        <PinSetupDialog
          open={pinDialog !== null}
          onOpenChange={(v) => setPinDialog(v ? (pinDialog ?? "set") : null)}
          pinEnabled={Boolean(pinStatus.data?.pinEnabled)}
          mode={pinDialog ?? "set"}
        />
      </div>

      {/* Custom Categories — full width */}
      <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md p-4 mf-card md:col-span-2">
        <div className="text-sm font-semibold mb-1">หมวดหมู่</div>
        <div className="text-xs text-muted-foreground mb-3">จัดการหมวดหมู่ default และเพิ่มหมวดหมู่ใหม่</div>

        {/* Tab */}
        <div className="flex gap-1 mb-3">
          {(["income", "expense", "saving"] as TxType[]).map((t) => (
            <button
              key={t}
              onClick={() => setCatTab(t)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${catTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Default categories (deletable) */}
        <div className="mb-3">
          <div className="text-[11px] text-muted-foreground mb-1.5">หมวดหมู่ default</div>
          <div className="flex flex-wrap gap-1.5">
            {visibleDefaults.map((cat) => (
              <span key={cat} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground group">
                {cat}
                <button
                  onClick={() => deleteDefaultCategory(catTab, cat)}
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-all ml-0.5"
                  aria-label="ซ่อน"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          {hiddenDefaults.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-muted-foreground mb-1">ซ่อนอยู่ — คลิกเพื่อคืนค่า</div>
              <div className="flex flex-wrap gap-1.5">
                {hiddenDefaults.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => restoreDefaultCategory(catTab, cat)}
                    className="px-2 py-0.5 rounded-full bg-muted/40 text-xs text-muted-foreground/50 line-through hover:no-underline hover:text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Custom categories */}
        <div className="mb-3">
          <div className="text-[11px] text-muted-foreground mb-1.5">หมวดหมู่ที่เพิ่มเอง</div>
          {customCats[catTab].length === 0 ? (
            <div className="text-xs text-muted-foreground italic">ยังไม่มีหมวดหมู่เพิ่มเติม</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {customCats[catTab].map((cat) => (
                <span key={cat} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-xs text-primary border border-primary/30">
                  {cat}
                  <button
                    onClick={() => removeCustomCategory(catTab, cat)}
                    className="hover:text-destructive transition-colors ml-0.5"
                    aria-label="ลบ"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Add new */}
        <div className="flex gap-2 max-w-xs">
          <Input
            placeholder="ชื่อหมวดหมู่ใหม่..."
            value={newCat[catTab]}
            onChange={(e) => setNewCat((p) => ({ ...p, [catTab]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(catTab); }}
            className="text-sm h-8"
          />
          <Button size="sm" variant="outline" onClick={() => addCategory(catTab)} disabled={!newCat[catTab].trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
