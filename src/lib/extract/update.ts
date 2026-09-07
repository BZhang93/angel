import "server-only";
import { extractStructured } from "@/lib/ai/client";
import { ExtractionSchema, type Extraction } from "./schema";

const SYSTEM = `You read investor updates that a founder sent to an angel investor and turn them into structured data.

Rules:
- Only report what the email states. Never infer, never estimate, never fill a gap with a plausible number.
- Set fundingComplete only when the email states that funding for this company is finished, such as "all wires received" or "the SPV is funded". A request to wire by a deadline is the opposite of this.
- Every signal needs a direction as well as a severity. Severity is how urgent it is; direction is whether it is good or bad news. A churned customer, a missed target, a departure or a delay is NEGATIVE. A launch, a signed partnership, a key hire or a raise is POSITIVE. Use PARTNERSHIP for a named commercial partner rather than a generic MILESTONE.
- Every metric, signal and action item must carry sourceQuote: the verbatim sentence from the email it came from. If you cannot quote it, do not report it.
- Normalise numbers to absolutes: "$1.2M ARR" becomes 1200000; "18 months of runway" becomes 18.
- Signals: RISK is anything that could lose the investor money (runway, churn, litigation, a key departure, a missed plan). ASK is something the founder is asking the investor to do. Severity reflects the money at stake, not the founder's tone.
- Action items are only things requiring a decision or a deadline from the investor, such as a pro-rata election or a consent form. A general "let me know if you have thoughts" is not an action item.
- Use PAYMENT_DUE when the reader has to send or is owed money, such as a wire against a commitment or a capital call. Set amount to the TOTAL the reader must send, fees included, since that is the figure that will leave their account: given "Investment $1,000, Fees $99, Total $1,099", the amount is 1099. Only set it when the email states the figure; never derive one from a percentage or an example. Every other kind leaves amount null.
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
