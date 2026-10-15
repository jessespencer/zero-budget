"use client";

import { useState, useRef, useId, useCallback, useMemo, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { scrollOptionIntoView } from "@/lib/utils";

type AccountOption = { id: string; name: string };

type AccountComboboxProps = {
  value: string;
  accounts: AccountOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
};

export function AccountCombobox({
  value,
  accounts,
  onChange,
  placeholder = "Choose an account",
  className,
}: AccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  // Index of the arrow-key-highlighted option, or -1 for "none".
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

  const selectedName = accounts.find((a) => a.id === value)?.name;

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    [accounts]
  );

  const filtered = search
    ? sortedAccounts.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase())
      )
    : sortedAccounts;

  // Keep the highlighted option scrolled into view as the user arrows through.
  useEffect(() => {
    if (activeIndex < 0 || !listboxRef.current) return;
    const el = listboxRef.current.querySelector(`[data-index="${activeIndex}"]`);
    scrollOptionIntoView(listboxRef.current, el as HTMLElement | null);
  }, [activeIndex]);

  const handleSelect = (id: string) => {
    onChange(id);
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      // Highlighted option wins; otherwise the top match when the user has
      // typed a search. Either way the list closes so Tab can reach submit.
      const picked =
        activeIndex >= 0 ? filtered[activeIndex] : search ? filtered[0] : undefined;
      if (picked) {
        handleSelect(picked.id);
      } else {
        setOpen(false);
        setSearch("");
      }
    } else if (e.key === "Escape" && open) {
      // Close the list, not the surrounding dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setSearch("");
      setActiveIndex(-1);
    }
  };

  return (
    <div
      className="relative"
      ref={containerRef}
      onBlur={(e) => {
        // Only close when focus leaves the combobox entirely. Tabbing from the
        // input to an option keeps focus inside the container, so the listbox
        // stays open instead of vanishing mid-focus-transfer.
        if (containerRef.current?.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
        setSearch("");
      }}
    >
      <label htmlFor={`account-combobox-${listboxId}`} className="sr-only">Account</label>
      <input
        id={`account-combobox-${listboxId}`}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
        }
        placeholder={placeholder}
        value={open ? search : (selectedName ?? "")}
        onChange={(e) => {
          setSearch(e.target.value);
          setActiveIndex(-1);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          computeSide();
          setSearch("");
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={className ? `${className} pr-6` : "flex h-10 w-full rounded-lg border border-input bg-transparent px-2.5 pr-6 py-2 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-muted-foreground dark:bg-input"}
      />
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
      {open && (
        <div
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-label="Accounts"
          className={`absolute z-50 w-full rounded-2xl bg-popover shadow-lg ring-1 ring-foreground/5 max-h-52 overflow-y-auto p-2 ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {filtered.map((a, i) => (
            <button
              key={a.id}
              id={`${listboxId}-opt-${i}`}
              data-index={i}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              className={`w-full text-left rounded-lg px-2.5 py-2 text-base whitespace-nowrap truncate transition-colors ${i === activeIndex ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.06]"}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(a.id)}
            >
              {a.name}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-base text-muted-foreground">
              No accounts found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
