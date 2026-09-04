// Deciding what a document is allowed to change. Pure, so the rule that matters
// most here is unit tested: a document may FILL a gap, never overwrite. A signed
// SAFE is better evidence than an email, but it is not better evidence than the
// number the user typed in, and silently rewriting curated data would make the
// whole app untrustworthy.

export function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/// Picks the position a document describes: the only one, or where the document
/// carries a date, the position closest to it. Returns null rather than guessing
/// between several undated candidates.
export function chooseTargetPosition<T extends { id: string; investmentDate: Date }>(
  positions: T[],
  terms: { investmentDate: string | null },
): T | null {
  if (positions.length === 0) return null;
  if (positions.length === 1) return positions[0]!;

  const target = parseIsoDate(terms.investmentDate);
  if (!target) return null;

  return positions.reduce((best, position) => {
    const bestGap = Math.abs(best.investmentDate.getTime() - target.getTime());
    const gap = Math.abs(position.investmentDate.getTime() - target.getTime());
    return gap < bestGap ? position : best;
  });
}

/// Only the fields the position is currently missing.
export function gapsOnly<T extends Record<string, unknown>>(
  current: T,
  incoming: Partial<Record<keyof T, unknown>>,
): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    if (current[key as keyof T] == null) patch[key] = value;
  }
  return patch as Partial<T>;
}
