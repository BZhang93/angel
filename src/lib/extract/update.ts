import "server-only";
import { extractStructured } from "@/lib/ai/client";
import { ExtractionSchema, type Extraction } from "./schema";

const SYSTEM = `You read investor updates that a founder sent to an angel investor and turn them into structured data.

Rules:
- Only report what the email states. Never infer, never estimate, never fill a gap with a plausible number.
- Every metric, signal and action item must carry sourceQuote: the verbatim sentence from the email it came from. If you cannot quote it, do not report it.
- Normalise numbers to absolutes: "$1.2M ARR" becomes 1200000; "18 months of runway" becomes 18.
- Signals: RISK is anything that could lose the investor money (runway, churn, litigation, a key departure, a missed plan). ASK is something the founder is asking the investor to do. Severity reflects the money at stake, not the founder's tone.
- Action items are only things requiring a decision or a deadline from the investor, such as a pro-rata election or a consent form. A general "let me know if you have thoughts" is not an action item.
- Founders write optimistically. Report the facts, not the framing.

Two kinds of email are not investor updates and are handled by their own fields:
- A BANK TRANSFER confirmation (a wire receipt, a payment sent notice, an outgoing transfer alert). Fill payment: the gross amount that left the account, the value date, the beneficiary as the bank wrote it, and statedFees if the same email names legal or admin fees. Leave metrics and signals empty. The gross amount often bundles the investment and its fees; report the gross, and put the fees in statedFees rather than subtracting them yourself.
- A SIGNED DOCUMENT notification (DocuSign, HelloSign, Dropbox Sign, Adobe Sign) saying an envelope was completed. Fill execution with the document title, the completion date and the company. Signing is not payment: never fill payment from one of these.
- Empty arrays are the correct answer for an email that contains nothing of that kind.
- Linked documents (an investment memo, a call transcript) count as part of this update: extract from them too, quoting them the same way. A number stated in a transcript is as real as one in the email body.`;

export async function extractFromUpdate(input: {
  companyName?: string | null;
  subject?: string | null;
  receivedAt: Date;
  text: string;
  /// Memos and call transcripts fetched from links in this email. They carry
  /// the numbers and risks the covering note only alludes to.
  linkedText?: string[];
}): Promise<Extraction> {
  const user = [
    input.companyName ? `Company: ${input.companyName}` : null,
    `Received: ${input.receivedAt.toISOString().slice(0, 10)}`,
    input.subject ? `Subject: ${input.subject}` : null,
    "",
    "Email body:",
    input.text,
    ...(input.linkedText?.length
      ? ["", "Linked documents fetched from this email:", ...input.linkedText]
      : []),
  ]
    .filter((line) => line !== null)
    .join("\n");

  return extractStructured(SYSTEM, user, ExtractionSchema);
}
