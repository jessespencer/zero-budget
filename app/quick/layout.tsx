import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import { ToastProvider } from "@/components/ui/toast";
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

export default function QuickLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ToastProvider>
      <RefreshOnVisible />
      {children}
    </ToastProvider>
  );
}
