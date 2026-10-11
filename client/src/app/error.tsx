"use client";
import { ErrorState } from "@/components/ui";
export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="route-loading card">
      <ErrorState error={error} retry={reset} />
    </main>
  );
}
