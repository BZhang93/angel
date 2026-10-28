import { describe, expect, it } from "vitest";
import {
  extractBody,
  extractLinks,
  guessDocumentKind,
  isWorthReading,
  listAttachments,
  parseFrom,
  isBulkMail,
  isDocumentAttachment,
  looksTruncated,
  parseMessage,
  stripHtml,
  stripQuotedReplies,
  type EmailAttachment,
  type GmailMessage,
} from "./parse";

const b64 = (text: string) =>
  Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("parseFrom", () => {
  it("splits a display name from an address", () => {
    expect(parseFrom("Jane Founder <jane@acme.com>")).toEqual({
      name: "Jane Founder",
      address: "jane@acme.com",
    });
  });

  it("handles a quoted name and a bare address", () => {
    expect(parseFrom('"Founder, Jane" <JANE@Acme.com>').address).toBe("jane@acme.com");
    expect(parseFrom("jane@acme.com")).toEqual({ name: null, address: "jane@acme.com" });
    expect(parseFrom(null).address).toBe("");
  });
});

describe("extractBody", () => {
  it("prefers text/plain from a multipart message", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Plain version") } },
        { mimeType: "text/html", body: { data: b64("<p>HTML version</p>") } },
      ],
    });
    expect(body).toBe("Plain version");
  });

  it("falls back to stripped HTML when there is no plain part", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/html", body: { data: b64("<p>ARR is <b>$1.2M</b></p>") } }],
    });
    expect(body).toBe("ARR is $1.2M");
  });

  it("searches nested parts", () => {
    const body = extractBody({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "application/pdf", filename: "deck.pdf", body: { size: 100 } },
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64("Nested plain") } }],
        },
      ],
    });
    expect(body).toBe("Nested plain");
  });
});

describe("stripHtml", () => {
  it("keeps line structure and decodes entities", () => {
    expect(stripHtml("<div>Runway<br>9 months &amp; growing</div>")).toBe(
      "Runway\n9 months & growing",
    );
  });
});

describe("stripQuotedReplies", () => {
  it("drops the quoted thread below an On ... wrote: marker", () => {
    const text = "Q3 update: ARR $1.2M.\n\nOn Mon, Jul 1, 2026, Bryan wrote:\n> How is it going?";
    expect(stripQuotedReplies(text)).toBe("Q3 update: ARR $1.2M.");
  });

  it("drops a trailing signature", () => {
    const text = "Latest numbers below.\n\n--\nJane\nCEO, Acme";
    expect(stripQuotedReplies(text)).toBe("Latest numbers below.");
  });

  // This is the shape that cost five months of Saile updates: the `From:` in a
  // forward's header block matched the reply-history marker, so everything
  // after character 39 was discarded and the row stored the delimiter alone.
  it("keeps the content of a forwarded message", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Jane Founder <jane@acme.com>",
      "Date: Mon, 31 Aug 2026 at 09:14",
      "Subject: Acme - August 2026 Updates",
      "To: Syndicate <deals@viaka.net>",
      "",
      "ARR crossed $1.2M this month.",
      "We closed the Series A extension.",
    ].join("\n");

    expect(stripQuotedReplies(text)).toBe(
      "ARR crossed $1.2M this month.\nWe closed the Series A extension.",
    );
  });

  it("keeps forwarded content when the recipient list wraps", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Jane Founder <jane@acme.com>",
      "To: Syndicate <deals@viaka.net>,",
      "\tAngels <angels@viaka.net>",
      "",
      "ARR crossed $1.2M this month.",
    ].join("\n");

    expect(stripQuotedReplies(text)).toBe("ARR crossed $1.2M this month.");
  });

  it("unwraps a forwarded forward", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Syndicate <deals@viaka.net>",
      "Subject: Fwd: Acme - August 2026 Updates",
      "",
      "---------- Forwarded message ---------",
      "From: Jane Founder <jane@acme.com>",
      "Subject: Acme - August 2026 Updates",
      "",
      "ARR crossed $1.2M this month.",
    ].join("\n");

    expect(stripQuotedReplies(text)).toBe("ARR crossed $1.2M this month.");
  });

  it("still cuts reply history that follows forwarded content", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Jane Founder <jane@acme.com>",
      "",
      "ARR crossed $1.2M this month.",
      "",
      "On Mon, Jul 1, 2026, Bryan wrote:",
      "> How is it going?",
    ].join("\n");

    expect(stripQuotedReplies(text)).toBe("ARR crossed $1.2M this month.");
  });

  it("leaves a bare From: block cutting as reply history", () => {
    const text = "No forward delimiter here.\n\nFrom: Bryan\nSent: earlier\nLast quarter: $900K";
    expect(stripQuotedReplies(text)).toBe("No forward delimiter here.");
  });

  it("leaves a clean email untouched", () => {
    expect(stripQuotedReplies("Short and clean.")).toBe("Short and clean.");
  });
});

describe("looksTruncated", () => {
  const long = "x".repeat(2000);

  it("flags a substantial body stripped down to a delimiter", () => {
    expect(looksTruncated("---------- Forwarded message ---------", long.length)).toBe(true);
  });

  it("does not flag a genuinely terse reply", () => {
    expect(looksTruncated("Sounds good, wired today.", 40)).toBe(false);
  });

  it("does not flag an ordinary trim of quoted history", () => {
    expect(looksTruncated("y".repeat(900), 2000)).toBe(false);
  });
});

describe("parseMessage", () => {
  it("assembles the fields the Update row needs", () => {
    const message: GmailMessage = {
      id: "msg-1",
      threadId: "thread-1",
      internalDate: String(Date.UTC(2026, 6, 15)),
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Jane Founder <jane@acme.com>" },
          { name: "Subject", value: "Acme Q2 investor update" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: { data: b64("ARR $1.2M.\n\nOn Jul 1, 2026, Bryan wrote:\n> ping") },
          },
        ],
      },
    };

    const parsed = parseMessage(message);
    expect(parsed).toMatchObject({
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-1",
      fromAddress: "jane@acme.com",
      fromName: "Jane Founder",
      subject: "Acme Q2 investor update",
      text: "ARR $1.2M.",
    });
    expect(parsed.receivedAt.toISOString().slice(0, 10)).toBe("2026-07-15");
  });

  it("survives a message with no headers or body", () => {
    const parsed = parseMessage({ id: "msg-2" });
    expect(parsed.fromAddress).toBe("");
    expect(parsed.text).toBe("");
  });
});

describe("listAttachments", () => {
  const message: GmailMessage = {
    id: "m1",
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Signed SAFE attached.") } },
        {
          mimeType: "application/pdf",
          filename: "Acme SAFE countersigned.pdf",
          body: { attachmentId: "att-1", size: 184_320 },
        },
        {
          mimeType: "image/png",
          filename: "logo.png",
          headers: [{ name: "Content-Disposition", value: "inline; filename=logo.png" }],
          body: { attachmentId: "att-2", size: 4_096 },
        },
        {
          mimeType: "multipart/related",
          parts: [
            {
              mimeType: "application/pdf",
              filename: "Side Letter.pdf",
              body: { attachmentId: "att-3", size: 51_200 },
            },
          ],
        },
      ],
    },
  };

  it("finds attachments at any depth", () => {
    const found = listAttachments(message.payload);
    expect(found.map((a) => a.filename)).toEqual(["Acme SAFE countersigned.pdf", "Side Letter.pdf"]);
  });

  it("drops inline parts like signature logos", () => {
    expect(listAttachments(message.payload).some((a) => a.filename === "logo.png")).toBe(false);
  });

  it("still parses the body alongside attachments", () => {
    expect(parseMessage(message).text).toBe("Signed SAFE attached.");
    expect(parseMessage(message).attachments).toHaveLength(2);
  });
});

describe("isWorthReading", () => {
  const pdf = { attachmentId: "a", filename: "safe.pdf", mimeType: "application/pdf", sizeBytes: 1000 };

  it("takes PDFs and skips other types", () => {
    expect(isWorthReading(pdf)).toBe(true);
    expect(isWorthReading({ ...pdf, filename: "deck.pptx", mimeType: "application/vnd.ms-powerpoint" })).toBe(false);
  });

  it("trusts the extension when the type is generic", () => {
    expect(isWorthReading({ ...pdf, mimeType: "application/octet-stream" })).toBe(true);
  });

  it("refuses anything oversized", () => {
    expect(isWorthReading({ ...pdf, sizeBytes: 40 * 1024 * 1024 })).toBe(false);
  });
});

describe("guessDocumentKind", () => {
  it("reads the usual filenames", () => {
    expect(guessDocumentKind("Acme SAFE countersigned.pdf")).toBe("SAFE");
    expect(guessDocumentKind("side-letter-pro-rata.pdf")).toBe("SIDE_LETTER");
    expect(guessDocumentKind("Convertible Note 2024.pdf")).toBe("NOTE");
    expect(guessDocumentKind("cap_table_post_seed.pdf")).toBe("CAP_TABLE");
    expect(guessDocumentKind("2025 K-1 Acme LLC.pdf")).toBe("K1");
    expect(guessDocumentKind("wire receipt.pdf")).toBe("OTHER");
  });
});

describe("extractLinks", () => {
  it("pulls hrefs out of HTML before the markup is stripped", () => {
    const links = extractLinks(
      '<p>See our <a href="https://acme.com/investors">investor page</a> and the <a href="https://docsend.com/view/abc123">data room</a>.</p>',
    );
    expect(links).toEqual(["https://acme.com/investors", "https://docsend.com/view/abc123"]);
  });

  it("finds bare URLs in a plain-text email", () => {
    expect(extractLinks("Deck is at https://acme.com/deck.pdf, take a look.")).toEqual([
      "https://acme.com/deck.pdf",
    ]);
  });

  it("drops trackers, unsubscribe links and social buttons", () => {
    const links = extractLinks(
      [
        '<a href="https://acme.com">site</a>',
        '<a href="https://click.mailchimp.com/x">open</a>',
        '<a href="https://acme.com/unsubscribe?id=9">unsubscribe</a>',
        '<a href="https://twitter.com/acme">follow</a>',
      ].join(""),
    );
    // The URL constructor normalises a bare host to a trailing slash.
    expect(links).toEqual(["https://acme.com/"]);
  });

  it("ignores anything that is not an http link", () => {
    expect(extractLinks('<a href="mailto:jane@acme.com">email</a><a href="tel:+1555">call</a>')).toEqual(
      [],
    );
  });

  it("strips tracking parameters and dedupes what is left", () => {
    const links = extractLinks(
      '<a href="https://acme.com/news?utm_source=email&id=7">a</a><a href="https://acme.com/news?utm_campaign=x&id=7">b</a>',
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toContain("id=7");
    expect(links[0]).not.toContain("utm_");
  });
});

describe("isBulkMail", () => {
  function withHeaders(headers: { name: string; value: string }[]): GmailMessage {
    return { id: "m1", payload: { headers, mimeType: "text/plain", body: { data: "" } } };
  }

  it("spots a mailing tool by List-Unsubscribe", () => {
    expect(isBulkMail(withHeaders([{ name: "List-Unsubscribe", value: "<https://x/u>" }]))).toBe(true);
  });

  it("spots the older Precedence convention", () => {
    expect(isBulkMail(withHeaders([{ name: "Precedence", value: "Bulk" }]))).toBe(true);
  });

  it("leaves a personal email alone", () => {
    expect(isBulkMail(withHeaders([{ name: "From", value: "jane@acme.com" }]))).toBe(false);
  });
});

describe("isDocumentAttachment", () => {
  function attachment(overrides: Partial<EmailAttachment>): EmailAttachment {
    return {
      filename: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 250_000,
      attachmentId: "a1",
      ...overrides,
    };
  }

  it("keeps a signed agreement", () => {
    expect(isDocumentAttachment(attachment({ filename: "Subscription Agreement.pdf" }))).toBe(true);
  });

  it("drops the logo at the bottom of an HTML email", () => {
    // A real backfill recorded seventy-two of these as documents.
    expect(isDocumentAttachment(attachment({ mimeType: "image/png", filename: "logo.png" }))).toBe(
      false,
    );
  });

  it("drops a calendar invite and a tracking pixel", () => {
    expect(isDocumentAttachment(attachment({ mimeType: "text/calendar" }))).toBe(false);
    expect(isDocumentAttachment(attachment({ sizeBytes: 900 }))).toBe(false);
  });
});
