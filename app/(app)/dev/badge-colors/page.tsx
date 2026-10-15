import Link from "next/link";
import { ChevronLeft, Target, Zap } from "lucide-react";

/* ============================================================
   Badge color explorations

   Compare candidate sub-color palettes against the brand acid lime.
   Each option overrides the four badge tokens via inline CSS vars
   on a scoped wrapper — nothing leaks into the rest of the app.

   WCAG: every chip carries its computed contrast ratio against the
   pill's tinted background. Target 4.5:1 for small text (AA).

   Brand reference: --primary = oklch(0.86 0.21 128)  (acid lime)
   ============================================================ */

type Option = {
  key: string;
  name: string;
  blurb: string;
  light: PaletteVars;
  dark: PaletteVars;
  recommended?: boolean;
};

type PaletteVars = {
  "--badge-positive": string;
  "--badge-negative": string;
  "--badge-warning": string;
  "--badge-info": string;
};

const CARD_LIGHT: Oklch = { L: 0.992, C: 0.004, H: 100 };
const CARD_DARK: Oklch = { L: 0.205, C: 0.008, H: 150 };

const CURRENT: Option = {
  key: "current",
  name: "Current",
  blurb: "Today's palette — low chroma + low lightness. Passes contrast but reads muted next to the acid lime brand.",
  light: {
    "--badge-positive": "oklch(0.46 0.17 138)",
    "--badge-negative": "oklch(0.50 0.21 27)",
    "--badge-warning":  "oklch(0.52 0.15 70)",
    "--badge-info":     "oklch(0.50 0.18 270)",
  },
  dark: {
    "--badge-positive": "oklch(0.82 0.21 132)",
    "--badge-negative": "oklch(0.70 0.21 27)",
    "--badge-warning":  "oklch(0.82 0.16 80)",
    "--badge-info":     "oklch(0.72 0.16 270)",
  },
};

const options: Option[] = [
  {
    key: "acid-family",
    name: "B — Acid family",
    blurb: "Hues shifted toward the brand (greens lean lime, reds warm to coral, blue goes electric indigo, amber goes saffron). Chroma maxed out at the highest lightness that still clears WCAG AA against the tinted pill background.",
    recommended: true,
    light: {
      // Lightness held ≤ 0.50 — that's the ceiling for AA on small text
      // against a bg that's ~85% white + 15% of the same hue. Chroma
      // pushed to the per-hue gamut edge for max vibrancy.
      "--badge-positive": "oklch(0.49 0.20 132)",  // lime-leaning green
      "--badge-negative": "oklch(0.51 0.23 24)",   // coral-leaning red
      "--badge-warning":  "oklch(0.52 0.16 65)",   // saffron — orange-amber holds chroma at this L
      "--badge-info":     "oklch(0.48 0.22 258)",  // electric indigo
    },
    dark: {
      // Dark bg is ~78% dark card + 22% hue. fg L 0.78+ gives ample
      // contrast to push chroma without dimming the chip.
      "--badge-positive": "oklch(0.84 0.22 130)",
      "--badge-negative": "oklch(0.78 0.22 22)",   // L lifted from 0.74 → 0.78 for AA in dark mode
      "--badge-warning":  "oklch(0.86 0.18 75)",
      "--badge-info":     "oklch(0.78 0.21 258)",
    },
  },
  {
    key: "acid-family-bold",
    name: "B′ — Acid family (bold)",
    blurb: "Same hues as B but pushed brighter — chroma at the edge of sRGB, lightness lifted toward 0.55. Drops some intents into AA-Large (3:1) territory. Worth seeing in context: at badge sizes the perceptual punch can outweigh the AA hit on glance value.",
    light: {
      "--badge-positive": "oklch(0.58 0.22 130)",
      "--badge-negative": "oklch(0.58 0.24 22)",
      "--badge-warning":  "oklch(0.65 0.18 70)",
      "--badge-info":     "oklch(0.55 0.23 258)",
    },
    dark: {
      "--badge-positive": "oklch(0.86 0.23 130)",
      "--badge-negative": "oklch(0.76 0.24 22)",
      "--badge-warning":  "oklch(0.88 0.19 78)",
      "--badge-info":     "oklch(0.80 0.22 258)",
    },
  },
];

export default function BadgeColorExplorationsPage() {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link
        href="/dev"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to dev
      </Link>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Badge color explorations</h1>
        <span className="font-mono text-[11px] text-muted-foreground">app/(app)/dev/badge-colors/page.tsx</span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Option B (Acid family) is the direction. Below: the current palette as baseline,
        then two B variants — a strict-AA build and a louder build that trades some
        contrast for glance impact. Every chip is annotated with its WCAG ratio against
        the pill background.
      </p>

      <Legend />

      <ComparisonRow option={CURRENT} isCurrent />
      {options.map((opt) => (
        <ComparisonRow key={opt.key} option={opt} />
      ))}

      <div className="mt-10 rounded-lg border border-border bg-card p-5 text-sm">
        <div className="mb-2 font-medium">Why the strict-AA build looks dimmer than expected</div>
        <p className="mb-2 text-muted-foreground">
          The pill recipe mixes 15% of the foreground color into a near-white card to
          make the tinted background. That gives us a high-luminance bg (~0.78), which
          forces the foreground luminance down to ≤ ~0.15 to clear 4.5:1. In OKLCH
          that&apos;s lightness ≤ ~0.52 — past that, the chip stops passing AA on small
          text.
        </p>
        <p className="mb-2 text-muted-foreground">
          Three levers if we want more punch <em>and</em> AA:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Raise the bg mix from 15% → 20–22% (deeper pill background, same fg) — global recipe change in <code className="font-mono text-[11px]">.badge</code>.</li>
          <li>Use semibold weight on the chip text (lifts apparent contrast without changing color).</li>
          <li>Bump the chip font from 0.72rem → 0.78rem so the AA-Large bar (3:1) applies more places.</li>
        </ul>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-2 text-[11px]">
      <span className="text-muted-foreground">Contrast badge legend:</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--positive)" }} />
        AA pass — 4.5:1
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--warning)" }} />
        AA Large only — 3:1
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--negative)" }} />
        Fails
      </span>
    </div>
  );
}

function ComparisonRow({ option, isCurrent = false }: { option: Option; isCurrent?: boolean }) {
  return (
    <section className="mt-8">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">{option.name}</h2>
          {isCurrent && <Tag>baseline</Tag>}
          {option.recommended && <Tag tone="brand">recommended</Tag>}
        </div>
      </header>
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">{option.blurb}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <PreviewPanel option={option} mode="light" />
        <PreviewPanel option={option} mode="dark" />
      </div>
    </section>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "brand" }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={
        tone === "brand"
          ? { background: "var(--primary)", color: "var(--primary-foreground)" }
          : { background: "var(--muted)", color: "var(--muted-foreground)" }
      }
    >
      {children}
    </span>
  );
}

function PreviewPanel({ option, mode }: { option: Option; mode: "light" | "dark" }) {
  const vars = mode === "light" ? option.light : option.dark;
  const card = mode === "light" ? CARD_LIGHT : CARD_DARK;
  const bgMix = mode === "light" ? 0.15 : 0.22;

  // Precompute contrast for each intent
  const ratios = {
    positive: contrastOnPill(vars["--badge-positive"], card, bgMix),
    negative: contrastOnPill(vars["--badge-negative"], card, bgMix),
    warning:  contrastOnPill(vars["--badge-warning"],  card, bgMix),
    info:     contrastOnPill(vars["--badge-info"],     card, bgMix),
  };

  return (
    <div
      className={mode === "dark" ? "dark" : ""}
      style={vars as React.CSSProperties}
    >
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border bg-accent/40 px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{mode}</span>
          <span className="badge badge-brand text-[11px]">brand</span>
        </div>

        <div className="space-y-3 p-5">
          <PreviewRow label="Groceries"      assigned="$100.00" activity="—"          available="$100.00"   tone="positive" ratio={ratios.positive} withTarget />
          <PreviewRow label="Eating out"     assigned="—"       activity="-$135.31"   available="-$135.31"  tone="negative" ratio={ratios.negative} />
          <PreviewRow label="Emergency fund" assigned="—"       activity="—"          available="$1,000.00" tone="positive" ratio={ratios.positive} />
          <PreviewRow label="Subscriptions"  assigned="—"       activity="-$196.00"   available="-$196.00"  tone="negative" ratio={ratios.negative} />

          <div className="my-3 h-px bg-border" />

          {/* Each intent labeled with its ratio */}
          <div className="flex flex-wrap gap-2 text-[11px]">
            <ChipWithRatio tone="positive" ratio={ratios.positive}>
              <Target className="h-3 w-3" /> on target
            </ChipWithRatio>
            <ChipWithRatio tone="negative" ratio={ratios.negative}>overspent</ChipWithRatio>
            <ChipWithRatio tone="warning"  ratio={ratios.warning}>underfunded</ChipWithRatio>
            <ChipWithRatio tone="info"     ratio={ratios.info}>scheduled</ChipWithRatio>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <div className="badge badge-brand gap-1 px-3 py-1 text-[12px]">
              <Zap className="h-3 w-3" /> Auto-assign
            </div>
            <span className="text-[11px] text-muted-foreground">← brand reference</span>
          </div>

          <details className="mt-3 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none">Tokens</summary>
            <div className="mt-2 grid gap-1 font-mono text-[10px]">
              {Object.entries(vars).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

type Tone = "positive" | "negative" | "warning" | "info";

function PreviewRow({
  label,
  assigned,
  activity,
  available,
  tone,
  ratio,
  withTarget = false,
}: {
  label: string;
  assigned: string;
  activity: string;
  available: string;
  tone: Tone;
  ratio: number;
  withTarget?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_80px_80px_160px] items-center gap-3 text-sm">
      <span className="truncate text-foreground">{label}</span>
      <span className="text-right tabular-nums text-muted-foreground">{assigned}</span>
      <span className="text-right tabular-nums text-muted-foreground">{activity}</span>
      <div className="flex items-center justify-end gap-1.5">
        <ContrastDot ratio={ratio} />
        <span className={`badge badge-${tone} text-[12px] tabular-nums`}>
          {withTarget && <Target className="h-3 w-3" />}
          {available}
        </span>
      </div>
    </div>
  );
}

function ChipWithRatio({ tone, ratio, children }: { tone: Tone; ratio: number; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className={`badge badge-${tone}`}>{children}</span>
      <RatioPill ratio={ratio} />
    </div>
  );
}

function ContrastDot({ ratio }: { ratio: number }) {
  const tone = ratioTone(ratio);
  const color =
    tone === "aa" ? "var(--positive)" :
    tone === "aaLarge" ? "var(--warning)" :
    "var(--negative)";
  return (
    <span
      title={`Contrast ${ratio.toFixed(2)}:1`}
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function RatioPill({ ratio }: { ratio: number }) {
  const tone = ratioTone(ratio);
  const fg =
    tone === "aa" ? "var(--positive)" :
    tone === "aaLarge" ? "var(--warning)" :
    "var(--negative)";
  return (
    <span
      className="rounded font-mono text-[10px] tabular-nums"
      style={{ color: fg }}
    >
      {ratio.toFixed(2)}:1
    </span>
  );
}

function ratioTone(ratio: number): "aa" | "aaLarge" | "fail" {
  if (ratio >= 4.5) return "aa";
  if (ratio >= 3) return "aaLarge";
  return "fail";
}

/* ============================================================
   OKLCH → sRGB → WCAG luminance → contrast ratio.

   Reference implementation: Björn Ottosson's OKLab spec, plus
   the standard sRGB transfer + relative luminance formula.
   ============================================================ */

type Oklch = { L: number; C: number; H: number };
type Oklab = { L: number; a: number; b: number };

function parseOklch(str: string): Oklch {
  // Accepts: "oklch(0.49 0.20 132)" or "oklch(0.49 0.20 132 / 0.8)"
  const m = str.match(/oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+(-?[0-9.]+)/);
  if (!m) throw new Error(`Cannot parse OKLCH: ${str}`);
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), H: parseFloat(m[3]) };
}

function oklchToOklab({ L, C, H }: Oklch): Oklab {
  const rad = (H * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

function mixOklab(a: Oklab, b: Oklab, t: number): Oklab {
  // t = weight of `a`
  return {
    L: t * a.L + (1 - t) * b.L,
    a: t * a.a + (1 - t) * b.a,
    b: t * a.b + (1 - t) * b.b,
  };
}

function oklabToLinearSrgb({ L, a, b }: Oklab): [number, number, number] {
  // OKLab → LMS' → LMS → linear sRGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const Llms = l_ * l_ * l_;
  const Mlms = m_ * m_ * m_;
  const Slms = s_ * s_ * s_;

  const r = +4.0767416621 * Llms - 3.3077115913 * Mlms + 0.2309699292 * Slms;
  const g = -1.2684380046 * Llms + 2.6097574011 * Mlms - 0.3413193965 * Slms;
  const bb = -0.0041960863 * Llms - 0.7034186147 * Mlms + 1.7076147010 * Slms;

  // Clamp to sRGB gamut for luminance calc.
  return [clamp01(r), clamp01(g), clamp01(bb)];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function relativeLuminance(linearSrgb: [number, number, number]): number {
  // WCAG relative luminance — coefficients applied to linear sRGB.
  const [r, g, b] = linearSrgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(L1: number, L2: number): number {
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function contrastOnPill(fgOklch: string, card: Oklch, mix: number): number {
  // Pill bg = mix% fg + (1-mix)% card, interpolated in OKLab.
  const fg = oklchToOklab(parseOklch(fgOklch));
  const bgOklab = mixOklab(fg, oklchToOklab(card), mix);
  const fgY = relativeLuminance(oklabToLinearSrgb(fg));
  const bgY = relativeLuminance(oklabToLinearSrgb(bgOklab));
  return contrast(fgY, bgY);
}
