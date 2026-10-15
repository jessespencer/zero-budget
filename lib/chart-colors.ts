// Categorical data-viz palette: color = category identity, hashed by name.
// "Groceries" gets the same hue every month regardless of where it ranks. All
// ten hues sit at uniform OKLCH lightness/chroma (see globals.css) so the wheel
// reads as one family — no slice dominates by color, slice SIZE carries the
// spend signal. Shared so any per-category visual (donut, legend, goal progress
// ring) draws from the same source of truth.

export const COLORS = [
  "var(--chart-spend-1)",
  "var(--chart-spend-2)",
  "var(--chart-spend-3)",
  "var(--chart-spend-4)",
  "var(--chart-spend-5)",
  "var(--chart-spend-6)",
  "var(--chart-spend-7)",
  "var(--chart-spend-8)",
  "var(--chart-spend-9)",
  "var(--chart-spend-10)",
];

// "Everything else" always renders in slot 9 regardless of the FNV hash, so its
// color stays stable across months and reads cleanly against the slots above it.
export const BUCKET_COLOR = "var(--chart-spend-9)";

// FNV-1a hash — fast, deterministic, good distribution. Maps a category name to
// a stable slot in the wheel.
function hashSlot(name: string, slots: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % slots;
}

export const colorForName = (name: string) => COLORS[hashSlot(name, COLORS.length)];
