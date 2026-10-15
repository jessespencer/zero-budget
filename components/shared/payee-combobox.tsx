"use client";

import { useState, useRef, useId, useCallback, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { scrollOptionIntoView } from "@/lib/utils";

export type PayeeOption = { id: string; name: string; default_category_id: string | null };

type PayeeComboboxProps = {
  value: string;
  payees: PayeeOption[];
  placeholder?: string;
  onChange: (name: string, defaultCategoryId: string | null) => void;
  className?: string;
};

export function PayeeCombobox({
  value,
  payees,
  placeholder = "Payee",
  onChange,
  className,
}: PayeeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  // Index of the arrow-key-highlighted option, or -1 for "none" (Enter then
  // accepts the typed free-text value rather than an option).
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const computeSide = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setSide(spaceBelow < 220 ? "top" : "bottom");
  }, []);

  const filtered = value
    ? payees.filter((p) => p.name.toLowerCase().includes(value.toLowerCase()))
    : payees;
  const options = filtered.slice(0, 8);

  const showListbox = open && options.length > 0;

  // Keep the highlighted option scrolled into view as the user arrows through.
  useEffect(() => {
    if (activeIndex < 0 || !listboxRef.current) return;
    const el = listboxRef.current.querySelector(`[data-index="${activeIndex}"]`);
    scrollOptionIntoView(listboxRef.current, el as HTMLElement | null);
  }, [activeIndex]);

  const handleSelect = (name: string, defaultCategoryId: string | null) => {
    onChange(name, defaultCategoryId);
    setOpen(false);
    setActiveIndex(-1);
    // Re-focus the input after selection (e.g. keyboard Enter on an option)
    // so focus doesn't get stranded on the unmounting listbox. preventScroll so
    // re-focusing an off-screen editing row doesn't jerk the page to it.
    inputRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showListbox) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!showListbox) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      // A highlighted option wins; otherwise accept the typed free-text value.
      // Either way the list closes so Tab can reach the dialog's submit button.
      const picked = activeIndex >= 0 ? options[activeIndex] : undefined;
      if (picked) {
        handleSelect(picked.name, picked.default_category_id);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape" && open) {
      // Close the list, not the surrounding dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div
      className="relative z-10"
      ref={containerRef}
      onBlur={(e) => {
        // Only close when focus leaves the combobox entirely. Tabbing from the
        // input to an option keeps focus inside the container, so the listbox
        // stays open instead of vanishing mid-focus-transfer.
        if (containerRef.current?.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
      }}
    >
      <div className="relative">
        <label htmlFor={`payee-combobox-${listboxId}`} className="sr-only">Payee</label>
        <input
          id={`payee-combobox-${listboxId}`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showListbox}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            showListbox && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
          }
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value, null);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            computeSide();
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className={className ? `${className} pr-6` : "flex h-10 w-full rounded-lg border border-input bg-transparent px-2.5 pr-6 py-2 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-muted-foreground dark:bg-input"}
        />
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
      </div>
      {showListbox && (
        <div
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-label="Payees"
          className={`absolute z-50 w-full rounded-2xl bg-popover shadow-lg ring-1 ring-foreground/5 overflow-hidden max-h-48 overflow-y-auto p-2 ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {options.map((p, i) => (
            <button
              key={p.id}
              id={`${listboxId}-opt-${i}`}
              data-index={i}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              className={`w-full text-left rounded-lg px-2.5 py-2 text-base whitespace-nowrap truncate transition-colors ${i === activeIndex ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.06]"}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(p.name, p.default_category_id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
