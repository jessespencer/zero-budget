"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EditTrackedAssetDialog } from "./edit-tracked-asset-dialog";
import { useToast } from "@/components/ui/toast";
import { useNetWorthUndo } from "./use-net-worth-undo";
import type { TrackedAsset } from "@/lib/types";

type AssetMenuProps = {
  asset: TrackedAsset;
};

/**
 * Kebab menu for the /assets/[id] page header. Mirrors components/accounts/
 * account-menu.tsx — Archive and Delete confirm-and-redirect to /insights so
 * the user lands back on the holdings list after the action completes.
 *
 * Archive and Delete both go through useNetWorthUndo. An earlier note here
 * claimed they couldn't, because the user navigates away to /insights before
 * the entry could be seen — that was wrong on both halves. The undo stack is a
 * module singleton (lib/use-undo-redo.ts), so a client-side router.push does
 * not clear it, and both entries close over server-fetched snapshots rather
 * than anything owned by this component, so they stay valid after it unmounts.
 * The Toaster lives in the (app) shell, so the toast survives the navigation
 * too and lands on /insights with its Undo button intact.
 *
 * The toast's Undo is the only affordance on purpose: /insights mounts no
 * Cmd+Z handler (only budget and transfer-plan do), so neither confirm promises
 * one.
 */
export function AssetMenu({ asset }: AssetMenuProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();
  const { pushArchive, pushDelete, undoEntry } = useNetWorthUndo();

  const handleArchive = () => {
    startTransition(async () => {
      try {
        const entryId = await pushArchive(asset.id);
        router.push("/insights");
        toast({
          message: `"${asset.name}" archived`,
          action: { label: "Undo", onClick: () => undoEntry(entryId) },
        });
      } catch {
        // Without this the failure is invisible: the confirm closes, the page
        // stays put, and nothing says the asset is still here.
        toast({ message: `Couldn't archive "${asset.name}"`, variant: "error" });
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const entryId = await pushDelete(asset.id);
        router.push("/insights");
        toast({
          message: `"${asset.name}" deleted`,
          action: entryId
            ? { label: "Undo", onClick: () => undoEntry(entryId) }
            : undefined,
        });
      } catch {
        toast({ message: `Couldn't delete "${asset.name}"`, variant: "error" });
      }
    });
  };

  const ariaLabel = `Options for ${asset.name}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={ariaLabel} />}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-[200px]">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit asset
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
            <Archive className="h-3.5 w-3.5" />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditTrackedAssetDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        asset={asset}
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive "${asset.name}"?`}
        description="The asset will be hidden from the net worth tab and stop counting toward your net worth. You can unarchive it later from the Archived section of the holdings list."
        confirmLabel="Archive"
        destructive={false}
        onConfirm={handleArchive}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${asset.name}"?`}
        description="This will delete the asset and every recorded history value. Undo from the toast afterwards restores all of it."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </>
  );
}
