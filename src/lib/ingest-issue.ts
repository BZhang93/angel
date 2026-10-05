// Copy for the two ways an update can arrive carrying nothing. Both used to be
// invisible: a body the stripper had emptied still read as a healthy row, and
// an extraction that found nothing read as a quiet month. Kept pure so the
// wording is tested rather than buried in a page.

export type IngestIssueKind = "TRUNCATED_BODY" | "NOTHING_EXTRACTED";

export interface IngestIssueNotice {
  label: string;
  detail: string;
  /// A truncated body is ours to fix by re-reading the email. An empty
  /// extraction may simply be an email with no news in it, so it is reported
  /// without implying a fault.
  actionable: boolean;
}

export function ingestIssueNotice(issue: IngestIssueKind): IngestIssueNotice {
  if (issue === "TRUNCATED_BODY") {
    return {
      label: "Body not read",
      detail:
        "Almost all of this email was lost when it was stored, so what you see is not what was sent. Re-run the sync to read it again.",
      actionable: true,
    };
  }

  return {
    label: "Nothing found",
    detail:
      "This was read in full and produced no metrics, signals or money. That may be a quiet month, or the update may say its numbers in a way the extractor missed.",
    actionable: false,
  };
}
