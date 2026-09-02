import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ThemeMode } from "@/contexts/ThemeContext";
import { Check, Gem, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useState } from "react";

const THEME_OPTIONS: Array<{
  mode: ThemeMode;
  label: string;
  icon: typeof Sun;
  swatchClass: string;
}> = [
  {
    mode: "light",
    label: "สว่าง",
    icon: Sun,
    swatchClass: "bg-gradient-to-br from-white to-slate-200 border border-border",
  },
  { mode: "dark", label: "มืด", icon: Moon, swatchClass: "bg-gradient-to-br from-slate-800 to-slate-950" },
  {
    mode: "blackgold",
    label: "ดำทอง",
    icon: Gem,
    swatchClass: "bg-gradient-to-br from-yellow-300 via-amber-500 to-black ring-1 ring-amber-400/60",
  },
  {
    mode: "system",
    label: "ตามระบบ",
    icon: Monitor,
    swatchClass: "bg-gradient-to-r from-white via-slate-200 to-slate-900 border border-border",
  },
];

export function ThemeMenu({
  mode,
  onModeChange,
}: {
  mode: ThemeMode;
  onModeChange: (m: ThemeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = THEME_OPTIONS.find((o) => o.mode === mode);
  const ActiveIcon = active?.icon ?? Palette;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 sm:h-10 sm:w-10"
          aria-label="เลือกธีม"
          title="เลือกธีม"
        >
          <ActiveIcon className="w-5 h-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1.5">
        <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">ธีม</div>
        {THEME_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = mode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => {
                onModeChange(opt.mode);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors ${isActive ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50"}`}
              aria-label={`เลือกธีม ${opt.label}`}
            >
              <span className={`w-5 h-5 rounded-full shrink-0 ${opt.swatchClass}`} />
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 text-left">{opt.label}</span>
              {isActive && <Check className="w-4 h-4 text-primary" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
