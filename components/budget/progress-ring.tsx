import { cn } from "@/lib/utils";

type ProgressRingProps = {
  percent: number;
  size?: number;
  strokeWidth?: number;
  /** Arc stroke color (e.g. a data-viz `var(--chart-spend-N)`). Falls back to
   * semantic positive/warning/negative coloring when omitted. */
  color?: string;
  /** Show the centered "N%" label. Off at icon scale where it can't fit. */
  showLabel?: boolean;
  /** Class for the unfilled background track. Default is a neutral muted ring;
   * pass e.g. `text-current opacity-25` to tint it with the arc's color. */
  trackClassName?: string;
  className?: string;
};

function getProgressColor(percent: number): string {
  if (percent >= 100) return "text-positive";
  if (percent >= 50) return "text-warning";
  return "text-negative";
}

export function ProgressRing({
  percent,
  size = 80,
  strokeWidth = 6,
  color,
  showLabel = true,
  trackClassName = "text-muted/50",
  className,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className={trackClassName}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color ?? "currentColor"}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            "transition-[stroke-dashoffset] duration-500",
            !color && getProgressColor(clamped)
          )}
        />
      </svg>
      {showLabel && (
        <span className="absolute text-sm font-semibold tabular-nums">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  );
}
