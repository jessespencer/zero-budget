"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { ToolbarIconButton } from "@/components/shared/toolbar-icon-button";
import { PayCardDialog, type PayCardSourceAccount } from "./pay-card-dialog";

type PayCardButtonProps = {
  cardId: string;
  cardName: string;
  currentBalance: number;
  sourceAccounts: PayCardSourceAccount[];
};

export function PayCardButton({
  cardId,
  cardName,
  currentBalance,
  sourceAccounts,
}: PayCardButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Secondary header action: icon-only with a tooltip. */}
      <ToolbarIconButton
        label="Pay card"
        variant="outline"
        aria-label={`Pay ${cardName}`}
        onClick={() => setOpen(true)}
      >
        <CreditCard />
      </ToolbarIconButton>
      <PayCardDialog
        open={open}
        onOpenChange={setOpen}
        cardId={cardId}
        cardName={cardName}
        currentBalance={currentBalance}
        sourceAccounts={sourceAccounts}
      />
    </>
  );
}
