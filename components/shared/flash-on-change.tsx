"use client";

import { useFlashOnChange } from "./use-flash-on-change";

/**
 * Client wrapper for server-rendered money: flashes its children when `value`
 * changes after a mutation + revalidate. Client components should call
 * useFlashOnChange directly instead.
 */
export function FlashOnChange({
  value,
  scope,
  className,
  children,
}: {
  value: number;
  scope?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const flash = useFlashOnChange(value, scope);
  return (
    <span data-flash={flash} className={className}>
      {children}
    </span>
  );
}
