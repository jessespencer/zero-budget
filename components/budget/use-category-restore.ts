"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui/toast";
import { restoreCategoryDeletionSnapshot } from "@/app/(app)/budget/actions";
import type { CategoryDeletionSnapshot } from "@/app/(app)/budget/actions";

/**
 * Undo a category/group deletion and tell the user if it didn't fully work.
 *
 * Deleting a category strands every transaction pointing at it — over a
 * thousand for a long-lived category — so the restore is the only way back and it must not
 * fail quietly. It can fail two ways, and SQLite treats them differently:
 *
 *   - a row skipped by `OR IGNORE` (UNIQUE / NOT NULL / CHECK / PK), which
 *     raises no error at all — the action reports this via `ok` / `missing*`;
 *   - a foreign-key violation, which ON CONFLICT does NOT cover: it throws and
 *     rolls the whole restore back. Undo runs inside a transition with no
 *     catch of its own, so that throw would otherwise surface nowhere.
 *
 * The second is the likelier one in practice, and the reason this wrapper
 * exists at all.
 *
 * Returns void so it can be used directly as a `MutationEntry.backward`.
 */
export function useCategoryRestore() {
  const { toast } = useToast();

  return useCallback(
    async (snapshot: CategoryDeletionSnapshot, label: string) => {
      try {
        const res = await restoreCategoryDeletionSnapshot(snapshot);
        if (res.ok) return;

        const parts: string[] = [];
        if (res.missingCategories > 0)
          parts.push(
            `${res.missingCategories} categor${
              res.missingCategories === 1 ? "y" : "ies"
            }`
          );
        if (res.missingGroups > 0)
          parts.push(
            `${res.missingGroups} group${res.missingGroups === 1 ? "" : "s"}`
          );

        toast({
          message: `Restored ${label}, but ${parts.join(
            " and "
          )} could not be brought back`,
          variant: "error",
          duration: 6000,
        });
      } catch {
        toast({
          message: `Could not restore ${label} — nothing was changed`,
          variant: "error",
          duration: 6000,
        });
      }
    },
    [toast]
  );
}
