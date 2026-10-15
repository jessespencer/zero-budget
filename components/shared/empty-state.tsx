import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateAction = {
  label: string;
  onClick: () => void;
};

type EmptyStateProps = {
  /** Required except for the compact variant, which never shows one. */
  icon?: LucideIcon;
  headline?: string;
  message: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /**
   * inline: a table/list with nothing in it. page: a whole empty route.
   * compact: a no-match inside a dialog, card, or search — text only.
   */
  variant?: "inline" | "page" | "compact";
  children?: ReactNode;
};

export function EmptyState({
  icon: Icon,
  headline,
  message,
  primaryAction,
  secondaryAction,
  variant = "inline",
  children,
}: EmptyStateProps) {
  const isPage = variant === "page";

  if (variant === "compact") {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
        {headline && (
          <p className="text-sm font-semibold text-foreground">{headline}</p>
        )}
        <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        isPage ? "min-h-[100dvh] gap-6 py-10" : "gap-5 py-20",
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-foreground/[0.06] text-muted-foreground",
            isPage ? "size-20" : "size-14",
          )}
        >
          <Icon
            aria-hidden
            className={isPage ? "size-9" : "size-6"}
            strokeWidth={1.75}
          />
        </div>
      )}
      <div className={cn("flex flex-col items-center", isPage ? "gap-2" : "gap-1.5")}>
        {headline && (
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            {headline}
          </h1>
        )}
        <p
          className={cn(
            "max-w-md text-muted-foreground",
            isPage ? "text-base" : "text-sm",
          )}
        >
          {message}
        </p>
      </div>
      {children
        ? children
        : (primaryAction || secondaryAction) && (
            <div className="flex items-center gap-2">
              {primaryAction && (
                <Button size={isPage ? "lg" : "sm"} onClick={primaryAction.onClick}>
                  {primaryAction.label}
                </Button>
              )}
              {secondaryAction && (
                <Button
                  size={isPage ? "lg" : "sm"}
                  variant="ghost"
                  onClick={secondaryAction.onClick}
                >
                  {secondaryAction.label}
                </Button>
              )}
            </div>
          )}
    </div>
  );
}
