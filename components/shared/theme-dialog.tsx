"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

type ThemeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The theme picker body, controlled by whoever owns the trigger.
 *
 * This markup used to exist twice, character-for-character, in ThemeToggle and
 * SettingsMenu — the comment in the latter acknowledged the duplication and
 * ruled out reuse because ThemeToggle owns its own button. Splitting the dialog
 * out from the button removes that objection: both callers keep their own
 * trigger and share the list.
 *
 * The `mounted` guard next-themes needs stays with the callers, since it also
 * gates their triggers.
 */
export function ThemeDialog({ open, onOpenChange }: ThemeDialogProps) {
  const { theme, setTheme } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Theme</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTheme(value);
                onOpenChange(false);
              }}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left",
                theme === value
                  ? "bg-primary/15 ring-1 ring-primary/25 text-foreground"
                  : "text-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              {label}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
