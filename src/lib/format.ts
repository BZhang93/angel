// Display formatting. Kept in one place so a dollar figure looks the same on
// every surface.

export function money(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  }).format(value);
}

export function multiple(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2)}x`;
}

export function percent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function shortDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/// "in 42 days" / "3 months ago". Used on the calendar and the silence flags,
/// where the gap matters more than the exact date.
export function relativeDays(days: number): string {
  const abs = Math.abs(days);
  const unit = abs >= 60 ? "months" : "days";
  const amount = unit === "months" ? Math.round(abs / 30) : abs;
  return days >= 0 ? `in ${amount} ${unit}` : `${amount} ${unit} ago`;
}

/// Acronyms that would otherwise be title-cased into words.
const ACRONYMS = new Set(["KISS", "SAFE", "SPV", "LP", "IPO", "QSBS", "MOIC", "IRR", "K1", "AI"]);

export function titleCase(value: string): string {
  if (ACRONYMS.has(value.toUpperCase().replace(/_/g, ""))) {
    return value.toUpperCase().replace(/_/g, " ");
  }
  return value
    .toLowerCase()
    .split("_")
    .map((word) =>
      ACRONYMS.has(word.toUpperCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}
