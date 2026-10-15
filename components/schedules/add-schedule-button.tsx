"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ScheduleDialog } from "./schedule-dialog";

type AddScheduleButtonProps = {
  accounts: { id: string; name: string; type: string; is_budget_account: boolean }[];
  categories: { id: string; name: string; category_group_id: string }[];
  categoryGroups: { id: string; name: string; is_income: boolean; is_system?: boolean }[];
};

export function AddScheduleButton({
  accounts,
  categories,
  categoryGroups,
}: AddScheduleButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="pill" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add schedule
      </Button>
      <ScheduleDialog
        open={open}
        onOpenChange={setOpen}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
      />
    </>
  );
}
