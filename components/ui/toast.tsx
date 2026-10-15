"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { clientId } from "@/lib/client-id";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastVariant = "default" | "success" | "error";

type ToastInput = {
  message: string;
  action?: ToastAction;
  duration?: number;
  variant?: ToastVariant;
};

type ToastEntry = {
  id: string;
  message: string;
  action?: ToastAction;
  duration: number;
  variant: ToastVariant;
};

type ToastContextValue = {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = clientId();
    setToasts((arr) => [
      ...arr,
      {
        id,
        message: input.message,
        action: input.action,
        duration: input.duration ?? 6000,
        variant: input.variant ?? "default",
      },
    ]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: (id: string) => void;
}) {
  const [progressEnd, setProgressEnd] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setProgressEnd(true))
    );
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [toast.id, toast.duration, onDismiss, paused]);

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        "pointer-events-auto relative flex min-h-[52px] w-[28rem] max-w-[calc(100vw-2rem)] items-center gap-3",
        "overflow-hidden rounded-xl bg-foreground py-2.5 pl-4 pr-2 text-background shadow-lg",
        "animate-in fade-in slide-in-from-bottom-2 duration-200"
      )}
    >
      {toast.variant !== "default" && <ToastVariantIcon variant={toast.variant} />}
      <span className="flex-1 text-sm">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            onDismiss(toast.id);
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-background/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="rounded-md p-1 text-background/60 transition-colors hover:bg-background/10 hover:text-background"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-background/40"
        style={{
          transform: progressEnd && !paused ? "scaleX(0)" : "scaleX(1)",
          transitionProperty: "transform",
          transitionDuration: paused ? "0ms" : `${toast.duration}ms`,
          transitionTimingFunction: "linear",
        }}
      />
    </div>
  );
}

function ToastVariantIcon({ variant }: { variant: Exclude<ToastVariant, "default"> }) {
  const isSuccess = variant === "success";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white",
        isSuccess ? "bg-[var(--color-positive)]" : "bg-[var(--color-negative)]"
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {isSuccess ? (
          <path d="M20 6L9 17l-5-5" />
        ) : (
          <path d="M18 6L6 18M6 6l12 12" />
        )}
      </svg>
    </span>
  );
}
