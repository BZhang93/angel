import Link from "next/link";
import type { ReactNode } from "react";
import type { Severity } from "@/lib/signals";

// Shared presentational pieces. Small on purpose: this app is tables and
// numbers, and consistency matters more than variety.

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative";
}) {
  const toneClass =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "";
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const SEVERITY_CLASS: Record<Severity, string> = {
  CRITICAL: "bg-negative/12 text-negative border-negative/30",
  HIGH: "bg-negative/8 text-negative border-negative/25",
  MEDIUM: "bg-warn/10 text-warn border-warn/30",
  LOW: "bg-accent/10 text-accent border-accent/25",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${SEVERITY_CLASS[severity]}`}
    >
      {severity}
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
