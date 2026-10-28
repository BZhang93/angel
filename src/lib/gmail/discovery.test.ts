import { describe, expect, it } from "vitest";
import { beforeTermFor, buildDiscoveryQuery, classifyMail, type MailShape } from "./discovery";

function mail(overrides: Partial<MailShape> = {}): MailShape {
  return {
    subject: null,
    fromAddress: "founder@acme.com",
    text: "",
    attachmentNames: [],
    bulk: false,
    ...overrides,
  };
}

describe("classifyMail, what it keeps", () => {
  it("keeps a plain investor update", () => {
    const verdict = classifyMail(
      mail({
        subject: "Acme October Investor Update",
        text: "ARR is now $1.2M, up from $900k. Runway sits at 14 months and burn is flat.",
      }),
    );
    expect(verdict.keep).toBe(true);
    expect(verdict.reason).toContain("investor update");
  });

  it("keeps wire instructions even with a bare subject", () => {
    const verdict = classifyMail(
      mail({
        subject: "Next steps",
        text: "Wire instructions are below. The capital call is due Friday.",
      }),
    );
    expect(verdict.keep).toBe(true);
  });

  it("keeps a one-line email that attaches the paperwork", () => {
    const verdict = classifyMail(
      mail({
        subject: "Signed",
        text: "Countersigned, attached.",
        attachmentNames: ["Acme-SAFE-executed.pdf"],
      }),
    );
    expect(verdict.keep).toBe(true);
    expect(verdict.reason).toContain("Acme-SAFE-executed.pdf");
  });

  it("keeps a founder update sent through a mailing tool, on its deal vocabulary", () => {
    // Plenty of real updates go out through Mailchimp. Bulk alone must not
    // reject, or the feature misses the companies that send most reliably.
    //
    // The footer is the point of this fixture. An earlier version of this test
    // omitted it and so proved nothing: the footer text was a hard rejection
    // forty lines above the bulk allowance, and every real Mailchimp update
    // was being refused while this passed.
    const verdict = classifyMail(
      mail({
        subject: "Acme Monthly Update",
        text:
          "We closed the bridge round at a $20M valuation cap. Pro rata rights are attached." +
          "\n\nView this email in your browser. Unsubscribe from this list.",
        bulk: true,
      }),
    );
    expect(verdict.keep).toBe(true);
  });

  it("keeps a plain update that happens to carry a mailing-tool footer", () => {
    const verdict = classifyMail(
      mail({
        subject: "Acme Q3 Investor Update",
        text:
          "Revenue grew to $2M ARR with 11 months of runway. Our valuation cap stands." +
          "\n\nManage your preferences | Unsubscribe from this list",
        bulk: false,
      }),
    );
    expect(verdict.keep).toBe(true);
  });
});

describe("classifyMail, what it refuses", () => {
  it("refuses a newsletter whose subject merely looks right", () => {
    const verdict = classifyMail(
      mail({
        subject: "Your Monthly Update from Strava",
        text: "You ran 42km in October. Keep it up!",
        bulk: true,
      }),
    );
    expect(verdict.keep).toBe(false);
  });

  it("refuses marketing that borrows the vocabulary", () => {
    const verdict = classifyMail(
      mail({
        subject: "Webinar: extend your runway and cut burn",
        text: "Register now to hear how founders manage runway and burn rate. Promo code SAVE20.",
      }),
    );
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toContain("marketing");
  });

  it("refuses bulk mail whose deal words are only in the subject", () => {
    const verdict = classifyMail(
      mail({
        subject: "Your Monthly Update",
        text: "You walked 42km in October. Unsubscribe from this list.",
        bulk: true,
      }),
    );
    expect(verdict.keep).toBe(false);
  });

  it("refuses a receipt", () => {
    const verdict = classifyMail(
      mail({
        subject: "Your receipt from Acme Legal",
        text: "Invoice attached for the subscription agreement review.",
      }),
    );
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toContain("notification");
  });

  // The whole point of the gate. A broad query over a personal mailbox will
  // surface mail like this, and nothing about it may reach an LLM.
  it("refuses private mail that shares no investment vocabulary", () => {
    const verdict = classifyMail(
      mail({
        subject: "Results from your appointment",
        fromAddress: "records@clinic.example",
        text: "Your test results are ready. Please call the office to discuss next steps.",
      }),
    );
    expect(verdict.keep).toBe(false);
    expect(verdict.score).toBe(0);
  });

  it("refuses a single passing mention", () => {
    const verdict = classifyMail(
      mail({ subject: "Coffee?", text: "Was great to hear about your runway. Free Thursday?" }),
    );
    expect(verdict.keep).toBe(false);
  });

  it("does not fire on words that merely contain a metric name", () => {
    const verdict = classifyMail(
      mail({
        subject: "Arrangements",
        text: "I have arranged the car and the burner phone. Barry from Burnley arrives at noon.",
      }),
    );
    expect(verdict.keep).toBe(false);
    expect(verdict.score).toBe(0);
  });

  it("refuses Google service mail outright", () => {
    const verdict = classifyMail(
      mail({
        fromAddress: "calendar-notification@google.com",
        subject: "Invitation: Investor update call",
        text: "Pro rata discussion. Term sheet review.",
      }),
    );
    expect(verdict.keep).toBe(false);
  });
});

describe("buildDiscoveryQuery", () => {
  it("bounds the search by age and excludes spam and trash", () => {
    const query = buildDiscoveryQuery({ sinceDays: 90 });
    expect(query).toContain("newer_than:90d");
    expect(query).toContain("-in:spam");
    expect(query).toContain("-in:trash");
  });

  it("never searches the user's own outgoing mail", () => {
    // Gmail searches all mail by default. Without these, the investor's own
    // email to a founder about a wire is discovered, matched to that company on
    // content, and filed as the company's own update.
    const query = buildDiscoveryQuery();
    expect(query).toContain("-in:sent");
    expect(query).toContain("-in:drafts");
    expect(query).toContain("-in:chats");
  });

  it("searches subjects, bodies and attachment names", () => {
    const query = buildDiscoveryQuery();
    expect(query).toContain('subject:"investor update"');
    expect(query).toContain('"wire instructions"');
    expect(query).toContain("filename:safe");
  });

  it("is one OR group, so the age bound applies to all of it", () => {
    // Without the parentheses, `newer_than` binds to the last term only and
    // the rest of the query searches the whole mailbox history.
    const query = buildDiscoveryQuery();
    expect(query.startsWith("(")).toBe(true);
    expect(query).toMatch(/\) newer_than:\d+d/);
  });
});

describe("walking backwards through a mailbox", () => {
  it("asks for the day after the oldest seen, not the day itself", () => {
    // Gmail's before: excludes the whole day named. Asking for the oldest
    // message's own day would skip every other message from that day, and
    // skip it permanently, since the cursor only ever moves backwards.
    expect(beforeTermFor(new Date("2026-03-14T18:00:00Z"))).toBe("before:2026/03/15");
  });

  it("handles a month boundary", () => {
    expect(beforeTermFor(new Date("2026-02-28T23:30:00Z"))).toBe("before:2026/03/01");
  });

  it("adds the boundary to the same bounded group", () => {
    const query = buildDiscoveryQuery({ sinceDays: 365, before: new Date("2026-03-14T00:00:00Z") });
    expect(query).toContain("newer_than:365d before:2026/03/15");
    // Still excludes the user's own mail on a backfill pass.
    expect(query).toContain("-in:sent");
  });

  it("omits the boundary when there is nothing to walk back from", () => {
    expect(buildDiscoveryQuery()).not.toContain("before:");
  });
});
