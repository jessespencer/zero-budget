"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { TriangleAlert } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      variant="page"
      icon={TriangleAlert}
      headline="We overspent our error budget."
      message="Something went wrong. You can try again, or reload the page if the problem persists."
      primaryAction={{ label: "Try again", onClick: reset }}
    />
  );
}
