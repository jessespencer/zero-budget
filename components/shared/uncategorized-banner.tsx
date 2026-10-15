"use client";

import { useRouter } from "next/navigation";
import { Info } from "lucide-react";

type UncategorizedBannerProps = {
  count: number;
  /** URL to navigate to when clicked. If not provided, uses onView callback. */
  href?: string;
  /** Callback when clicked. Used for client-side filter toggling. */
  onView?: () => void;
};

export function UncategorizedBanner({ count, href, onView }: UncategorizedBannerProps) {
  const router = useRouter();

  if (count === 0) return null;

  const handleClick = () => {
    if (onView) {
      onView();
    } else if (href) {
      router.push(href);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-between w-full px-6 py-2.5 bg-warning/10 text-warning text-[13px] hover:bg-warning/20 transition-colors cursor-pointer border-b border-warning/20"
    >
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4" />
        <span className="font-semibold">
          {count} {count === 1 ? "transaction" : "transactions"} to categorize.
        </span>
      </div>
      <span className="text-xs font-semibold border border-warning/30 rounded-md px-2.5 py-1 hover:bg-warning/10 transition-colors">
        View
      </span>
    </button>
  );
}

export function UncategorizedFilterActive({ onClear }: { onClear: () => void }) {
  return (
    <button
      onClick={onClear}
      className="flex items-center justify-between w-full px-6 py-2.5 bg-warning/10 text-warning text-[13px] hover:bg-warning/20 transition-colors cursor-pointer border-b border-warning/20"
    >
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4" />
        <span className="font-semibold">Showing uncategorized transactions only.</span>
      </div>
      <span className="text-xs font-semibold border border-warning/30 rounded-md px-2.5 py-1 hover:bg-warning/10 transition-colors">
        Clear filter
      </span>
    </button>
  );
}
