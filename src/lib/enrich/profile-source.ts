// Choosing which fetched document describes a company best.
//
// Three kinds get fetched (see ./classify.ts) and any of them can carry what a
// profile needs, but they are not equally good at it. Reading whichever
// happened to be fetched first meant a call transcript could set the sector
// while a memo sat unread.
//
// Pure and tested: this decides which text the model is shown.

export type ProfileSourceKind = "WEBSITE" | "MEMO" | "RECORDING";

/// Best first.
///
/// A website is the cleanest single source for one plain sentence: it is about
/// the company and nothing else. A memo states the sector more explicitly than
/// any homepage will, but it is an investor writing about a deal, so it mixes
/// in terms and opinions. A transcript is the weakest, being speech, and is a
/// last resort rather than a preference.
export const PROFILE_SOURCE_PRIORITY: ProfileSourceKind[] = ["WEBSITE", "MEMO", "RECORDING"];

export function isProfileSourceKind(kind: string): kind is ProfileSourceKind {
  return (PROFILE_SOURCE_PRIORITY as string[]).includes(kind);
}

/// The best document to profile a company from, or null if none qualifies.
///
/// Ties are broken by the order given, so a caller that queries oldest first
/// gets the memo written when the deal was announced rather than a later one.
export function pickProfileSource<T extends { kind: string; textContent?: string | null }>(
  documents: T[],
): T | null {
  for (const kind of PROFILE_SOURCE_PRIORITY) {
    const found = documents.find(
      (document) => document.kind === kind && (document.textContent ?? "").trim().length > 0,
    );
    if (found) return found;
  }
  return null;
}

/// How the model is told to read what it is given. A memo is not a homepage,
/// and reading one as though it were produces a description of the round.
export function sourceFraming(kind: ProfileSourceKind): {
  noun: string;
  label: string;
  caution: string;
} {
  switch (kind) {
    case "WEBSITE":
      return {
        noun: "a startup's own website",
        label: "Website text",
        caution: "Strip the marketing voice: \"AI-powered platform revolutionising X\" becomes what it actually is.",
      };
    case "MEMO":
      return {
        noun: "an investment memo or deck about a startup, written by an investor",
        label: "Memo text",
        caution:
          "Describe the COMPANY, never the deal. Valuation, round size, terms and the author's opinion of the opportunity are not part of a profile.",
      };
    case "RECORDING":
      return {
        noun: "a transcript of a call with a startup's founders",
        label: "Call transcript",
        caution:
          "This is speech, so it rambles and misattributes. Take only what a founder states plainly about their own company, and prefer null over inference.",
      };
  }
}
