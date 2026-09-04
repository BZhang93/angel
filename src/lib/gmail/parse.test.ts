import { describe, expect, it } from "vitest";
import {
  extractBody,
  guessDocumentKind,
  isWorthReading,
  listAttachments,
  parseFrom,
  parseMessage,
  stripHtml,
  stripQuotedReplies,
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

  it("drops a forwarded header block and a signature", () => {
    const text = "Latest numbers below.\n\n--\nJane\nCEO, Acme";
    expect(stripQuotedReplies(text)).toBe("Latest numbers below.");
  });

  it("leaves a clean email untouched", () => {
    expect(stripQuotedReplies("Short and clean.")).toBe("Short and clean.");
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
