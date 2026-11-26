import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import { ToastProvider } from "@/components/ui/toast";
import { DemoModeBanner, DemoModeProvider } from "@/components/shared/demo-mode";
import { getDemoModeStatus } from "@/lib/demo-mode-status";
import { RefreshOnVisible } from "./refresh-on-visible";
import "../globals.css";

export const metadata: Metadata = {
  title: "Zero quick add",
  description: "Capture a transaction in seconds",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zero",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFF4F0" },
    { media: "(prefers-color-scheme: dark)", color: "#080B09" },
  ],
};

// Reads the Demo mode switch per request, like the page below it.
export const dynamic = "force-dynamic";

export default function QuickLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <DemoModeProvider status={getDemoModeStatus()}>
      <ToastProvider>
        <DemoModeBanner />
        <RefreshOnVisible />
        {children}
      </ToastProvider>
    </DemoModeProvider>
  );
}
