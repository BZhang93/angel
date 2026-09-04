"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/// While a scan is running, re-fetch the page every few seconds so proposals
/// appear as they are found. The scan writes each one before moving to the next
/// sender, so this is genuinely incremental rather than a fake progress bar.
export function ScanProgress({
  running,
  step,
  doneItems,
  totalItems,
  produced,
}: {
  running: boolean;
  step: string | null;
  doneItems: number;
  totalItems: number;
  produced: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [running, router]);

  if (!running) return null;

  const percent = totalItems > 0 ? Math.min(100, Math.round((doneItems / totalItems) * 100)) : 0;

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{step ?? "Working"}</span>
        <span className="tabular text-xs text-muted">
          {totalItems > 0 ? `${Math.min(doneItems, totalItems)} of ${totalItems}` : "…"}
          {produced > 0 ? ` · ${produced} found` : ""}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.max(percent, 3)}%` }}
        />
      </div>
    </div>
  );
}
