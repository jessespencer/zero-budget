"use client";

import { useState, useRef, useId, useCallback, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";
import { scrollOptionIntoView } from "@/lib/utils";

type CategoryComboboxProps = {
  value: string;
  groupedCategories: { id: string; name: string; items: { id: string; name: string }[] }[];
  incomeCategories?: { id: string; name: string }[];
  onChange: (id: string) => void;
  onSplit?: () => void;
  placeholder?: string;
  className?: string;
  listboxSide?: "top" | "bottom";
};

export function CategoryCombobox({
  value,
  groupedCategories,
  incomeCategories = [],
  onChange,
  onSplit,
  placeholder = "Choose budget item(s)",
  className,
  listboxSide = "bottom",
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [side, setSide] = useState<"top" | "bottom">(listboxSide);
  // Index of the arrow-key-highlighted entry, or -1 for "none". Indices run
  // over the flattened option order, with the optional Split action last.
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
    // 220px ≈ max-h-52 (208px) + some padding
    setSide(spaceBelow < 220 ? "top" : "bottom");
  }, []);

  const allItems = [
    ...incomeCategories.map((c) => ({ ...c, groupName: "Inflow" })),
    ...groupedCategories.flatMap((g) =>
      g.items.map((c) => ({ ...c, groupName: g.name }))
    ),
  ];

  const selectedName = allItems.find((c) => c.id === value)?.name;

  const filtered = search
    ? allItems.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.groupName.toLowerCase().includes(search.toLowerCase())
      )
    : allItems;

  const groups = new Map<string, { id: string; name: string }[]>();
  for (const item of filtered) {
    const list = groups.get(item.groupName) ?? [];
    list.push(item);
    groups.set(item.groupName, list);
  }
  const groupEntries = [...groups.entries()];

  // Flattened option order matches the render order (grouped). The Split
  // action, when present, occupies the index just past the last option.
  const flatItems = groupEntries.flatMap(([, items]) => items);
  const splitIndex = onSplit ? flatItems.length : -1;
  const navigableCount = flatItems.length + (onSplit ? 1 : 0);

  // Keep the highlighted entry scrolled into view as the user arrows through.
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

  const handleClear = () => {
    onChange("");
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus({ preventScroll: true });
  };

  const handleSplit = () => {
    onSplit?.();
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
      if (navigableCount === 0) return;
      setActiveIndex((i) => (i + 1) % navigableCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (navigableCount === 0) return;
      setActiveIndex((i) => (i <= 0 ? navigableCount - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      if (activeIndex === splitIndex && splitIndex >= 0) {
        handleSplit();
        return;
      }
      // Highlighted option wins; otherwise the top match when the user has
      // typed a search. Either way the list closes so Tab can reach submit.
      const picked =
        activeIndex >= 0 ? flatItems[activeIndex] : search ? flatItems[0] : undefined;
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

  // Running index across groups so each option gets its flat-order index.
  let renderIndex = 0;

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
      <label htmlFor={`cat-combobox-${listboxId}`} className="sr-only">Category</label>
      <input
        id={`cat-combobox-${listboxId}`}
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
      {value ? (
        <button
          type="button"
          aria-label="Clear category"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClear}
          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-accent/30 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
      )}
      {open && (
        <div
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-label="Categories"
          className={`absolute z-50 w-full rounded-2xl bg-popover shadow-lg ring-1 ring-foreground/5 max-h-52 overflow-y-auto px-2 pt-2 ${onSplit ? "pb-0" : "pb-2"} ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {groupEntries.map(([groupName, items]) => (
            <div key={groupName} role="group" aria-label={groupName}>
              <div className="px-2.5 pt-2.5 pb-1 text-[11px] font-extrabold text-primary uppercase tracking-wider" aria-hidden="true">
                {groupName}
              </div>
              {items.map((c) => {
                const i = renderIndex++;
                return (
                  <button
                    key={c.id}
                    id={`${listboxId}-opt-${i}`}
                    data-index={i}
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`w-full text-left rounded-lg px-2.5 py-2 text-base whitespace-nowrap truncate transition-colors ${i === activeIndex ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.06]"}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(c.id)}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-base text-muted-foreground">
              No categories found
            </div>
          )}
          {onSplit && (
            <div className="border-t border-border p-2 sticky bottom-0 bg-popover">
              <button
                id={`${listboxId}-opt-${splitIndex}`}
                data-index={splitIndex}
                type="button"
                className={`w-full rounded-md border border-border px-3 py-1.5 text-base font-medium text-foreground transition-colors ${splitIndex === activeIndex ? "bg-foreground/[0.06]" : "bg-background hover:bg-foreground/[0.06]"}`}
                onMouseEnter={() => setActiveIndex(splitIndex)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSplit}
              >
                Split
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
