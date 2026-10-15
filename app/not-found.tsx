"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { Compass } from "lucide-react";

export default function NotFound() {
  const router = useRouter();

  return (
    <EmptyState
      variant="page"
      icon={Compass}
      headline="This page didn't make the budget."
      message="It doesn't exist, or it may have been moved."
      primaryAction={{ label: "Go home", onClick: () => router.push("/") }}
    />
  );
}
