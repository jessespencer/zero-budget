"use client";

import { ArrowUpRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  APP_VERSION,
  AUTHOR_NAME,
  AUTHOR_URL,
  COPYRIGHT,
  LICENSE_NAME,
  REPO_URL,
  releaseUrl,
} from "@/lib/version";

type AboutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const links = [
  { label: "Source code", href: REPO_URL },
  { label: "License", href: `${REPO_URL}/blob/main/LICENSE` },
  { label: "Release notes", href: `${REPO_URL}/releases` },
  { label: "Report an issue", href: `${REPO_URL}/issues` },
  { label: AUTHOR_NAME, href: AUTHOR_URL },
];

/**
 * Version, license notice and project links. The AGPL asks an interactive UI
 * to show its copyright, the no-warranty disclaimer and where the license
 * lives (section 5d) — this is where Zero does that. Everything is static;
 * the links only leave the app when clicked.
 */
export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>About Zero</DialogTitle>
          <DialogDescription className="text-sm">
            Personal budgeting that lives on your computer, not in someone&apos;s cloud.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>
            <a
              href={releaseUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium tabular-nums hover:underline"
            >
              Version {APP_VERSION}
            </a>
          </p>
          <p className="text-muted-foreground">
            Zero is free software: you can redistribute and modify it under the
            terms of the {LICENSE_NAME}. It comes with no warranty.
          </p>
          <p className="text-muted-foreground">Copyright {COPYRIGHT}</p>
        </div>

        <ul className="-mx-2 flex flex-col">
          {links.map(({ label, href }) => (
            <li key={href}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center justify-between rounded-lg px-2 text-sm transition-colors hover:bg-muted"
              >
                {label}
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
