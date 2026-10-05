import { describe, expect, it } from "vitest";
import { ingestIssueNotice } from "./ingest-issue";

describe("ingestIssueNotice", () => {
  it("treats a truncated body as ours to fix", () => {
    const notice = ingestIssueNotice("TRUNCATED_BODY");
    expect(notice.actionable).toBe(true);
    // Not the sync: it deduplicates on message id and will never revisit a row
    // it has already stored.
    expect(notice.detail).not.toContain("sync");
    expect(notice.detail).toContain("Gmail");
  });

  it("does not blame the sender for an empty extraction", () => {
    const notice = ingestIssueNotice("NOTHING_EXTRACTED");
    expect(notice.actionable).toBe(false);
    expect(notice.detail).toContain("quiet month");
  });

  it("keeps labels short enough for a pill", () => {
    for (const issue of ["TRUNCATED_BODY", "NOTHING_EXTRACTED"] as const) {
      expect(ingestIssueNotice(issue).label.length).toBeLessThanOrEqual(20);
    }
  });
});
