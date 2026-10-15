// Shared heat ramp for insights heatmaps (spending calendar + seasonality).
// Three-stop monochrome violet ramp in oklch: hue held ~constant (~293, the
// Clothing hue from the spending-breakdown palette) while lightness + chroma
// carry magnitude — pale, barely-tinted lavender (low spend) → deep, saturated
// violet (heavy spend). Single-hue by construction so intensity reads cleanly,
// and darker always means more.
const COOL = { L: 0.9, C: 0.05, H: 295 }; // pale lavender (low spend)
const MID = { L: 0.64, C: 0.15, H: 293 }; // mid violet
const HOT = { L: 0.42, C: 0.17, H: 291 }; // deep violet (heavy spend)

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

// t (0..1) → oklch heat color along the pale → deep violet ramp (darker = more).
export function heatColorFor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const [from, to, f] =
    c < 0.5 ? [COOL, MID, c / 0.5] : [MID, HOT, (c - 0.5) / 0.5];
  const L = lerp(from.L, to.L, f).toFixed(3);
  const C = lerp(from.C, to.C, f).toFixed(3);
  const H = lerp(from.H, to.H, f).toFixed(1);
  return `oklch(${L} ${C} ${H})`;
}
