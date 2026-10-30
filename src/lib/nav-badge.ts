// The number on a nav tab.
//
// Capped because the point of the badge is "there is work here", not an exact
// census: past a couple of dozen the digits get wider while the message stops
// changing, and a three-digit count in a 13px tab reads as noise.

export const BADGE_CAP = 20;

/// The label for a count, or null when there is nothing to say. Zero shows
/// nothing at all rather than a "0": an empty queue is not news.
export function badgeLabel(count: number, cap: number = BADGE_CAP): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  if (whole <= 0) return null;
  return whole > cap ? `${cap}+` : String(whole);
}
