// Finding investment mail that was never labelled.
//
// The label-based sync asks the user to file every email by hand, which is the
// chore this removes. Two halves, both here and both pure:
//
//   - the Gmail query that discovers candidates. Searching happens inside
//     Google, so a broad query costs nothing and reveals nothing.
//   - the gate that decides whether a discovered email is stored at all. This
//     is the half that matters, because a stored email is later read by the
//     LLM, so the gate is what keeps an investor's personal mail out of a
//     third-party model. It is deterministic and tested rather than a
//     judgement call made by another model.
//
// Precision beats recall here. A missed update is found by the next scan or by
// the sender-based one; a false positive sends somebody's medical results to
// an API. Everything that passes is still stored PENDING for a human.

export interface MailShape {
  subject: string | null;
  fromAddress: string;
  text: string;
  attachmentNames: string[];
  /// True when the message carries List-Unsubscribe or a bulk Precedence, which
  /// is how a newsletter announces itself.
  bulk: boolean;
}

export interface Verdict {
  keep: boolean;
  /// Why, in words a person can check against the email in front of them. The
  /// review queue shows this, so a wrong call is diagnosable rather than
  /// mysterious.
  reason: string;
  score: number;
}

/// Phrases that name the genre in a subject line. Deliberately specific: an
/// investor writes "Acme October Update", not "update".
const SUBJECT_PHRASES = [
  "investor update",
  "investor letter",
  "shareholder update",
  "portfolio update",
  "monthly update",
  "quarterly update",
  "annual update",
  "company update",
  "founder update",
  "kpi update",
  "metrics update",
  "capital call",
  "wire instructions",
  "funding complete",
  "closing documents",
  "signature requested",
  "countersigned",
  "pro rata",
  "cap table",
];

/// Phrases in the body that only investment mail tends to use.
const BODY_PHRASES = [
  "wire instructions",
  "capital call",
  "pro rata",
  "cap table",
  "safe agreement",
  "convertible note",
  "subscription agreement",
  "side letter",
  "term sheet",
  "post-money",
  "pre-money",
  "valuation cap",
  "discount rate",
  "fully diluted",
  "liquidation preference",
  "board consent",
  "409a",
  "secondary sale",
  "tender offer",
  "bridge round",
  "down round",
  "runway",
  "burn rate",
  "net new arr",
  "annual recurring revenue",
  "monthly recurring revenue",
];

/// Operating metrics, which an update states and a newsletter does not. Weaker
/// than the phrases above because a tech newsletter discusses them too, so
/// these only ever add to another signal.
const METRIC_PHRASES = ["arr", "mrr", "gmv", "churn", "runway", "burn", "headcount", "logo retention"];

/// Attachment names that are the paperwork of a round.
const PAPERWORK_FILENAME =
  /(safe|convertible[\s_-]?note|subscription[\s_-]?agreement|side[\s_-]?letter|term[\s_-]?sheet|stock[\s_-]?purchase|board[\s_-]?consent|cap[\s_-]?table)/i;

// The plumbing a mailing tool adds to the bottom of whatever it sends. This is
// NOT evidence against an email: a founder who sends their update through
// Mailchimp gets this footer too, and treating it as disqualifying threw out
// the companies that report most reliably. It only raises the bar, exactly as
// a bulk header does.
const MAILING_TOOL_FOOTER = [
  "unsubscribe from this list",
  "manage your preferences",
  "view this email in your browser",
  "update your preferences",
  "sent to you by",
];

// Promotional language, which an investor update never uses. This one really is
// disqualifying: it is the difference between a founder telling their investors
// about the quarter and somebody selling tickets to a webinar about runway.
const PROMOTIONAL_MARKERS = [
  "register now",
  "save your seat",
  "early bird",
  "limited time",
  "promo code",
  "book a demo",
  "upgrade your plan",
  "sponsored by",
];

const NOTIFICATION_MARKERS = [
  "order confirmation",
  "your receipt",
  "invoice attached",
  "payment reminder",
  "password reset",
  "verify your email",
  "security alert",
  "has invited you to",
  "calendar invitation",
  "out of office",
];

/// Senders whose mail is always a service notification rather than a deal.
const DISQUALIFYING_SENDERS = [
  "noreply@google.com",
  "no-reply@accounts.google.com",
  "calendar-notification@google.com",
  "notifications@github.com",
  "noreply@medium.com",
];

const KEEP_THRESHOLD = 2;

function countPhrases(haystack: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => haystack.includes(phrase));
}

/// Whole-word match, so "arr" does not fire on "arrange" and "burn" does not
/// fire on "Burnley". The short metric names make this non-optional.
function countWords(haystack: string, words: string[]): string[] {
  return words.filter((word) => new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i").test(haystack));
}

export function classifyMail(mail: MailShape): Verdict {
  const subject = (mail.subject ?? "").toLowerCase();
  const text = mail.text.toLowerCase();
  const body = `${subject}\n${text}`;
  const sender = mail.fromAddress.toLowerCase();

  if (DISQUALIFYING_SENDERS.includes(sender)) {
    return { keep: false, reason: `Service mail from ${sender}.`, score: 0 };
  }

  const promotions = countPhrases(body, PROMOTIONAL_MARKERS);
  if (promotions.length > 0) {
    return { keep: false, reason: `Reads as marketing: "${promotions[0]}".`, score: 0 };
  }
  const notices = countPhrases(body, NOTIFICATION_MARKERS);
  if (notices.length > 0) {
    return { keep: false, reason: `Reads as a notification: "${notices[0]}".`, score: 0 };
  }

  const reasons: string[] = [];
  let score = 0;

  const subjectHits = countPhrases(subject, SUBJECT_PHRASES);
  if (subjectHits.length > 0) {
    score += 2;
    reasons.push(`subject says "${subjectHits[0]}"`);
  }

  const bodyHits = countPhrases(text, BODY_PHRASES);
  if (bodyHits.length > 0) {
    // Two distinct deal phrases is its own strong signal: one can be a passing
    // mention, two is the vocabulary of the thing itself.
    score += bodyHits.length >= 2 ? 2 : 1;
    reasons.push(`mentions ${bodyHits.slice(0, 2).map((hit) => `"${hit}"`).join(" and ")}`);
  }

  const paperwork = mail.attachmentNames.filter((name) => PAPERWORK_FILENAME.test(name));
  if (paperwork.length > 0) {
    score += 2;
    reasons.push(`attaches ${paperwork[0]}`);
  }

  const metrics = countWords(text, METRIC_PHRASES);
  if (metrics.length >= 2 && score > 0) {
    score += 1;
    reasons.push(`reports ${metrics.slice(0, 2).join(" and ")}`);
  }

  // A newsletter can still be a real update: plenty of founders send theirs
  // through a mailing tool. It just has to earn it on the deal vocabulary
  // rather than on the subject line alone. A mailing-tool footer counts the
  // same as a bulk header, since both say only how the mail was sent.
  const sentInBulk = mail.bulk || countPhrases(body, MAILING_TOOL_FOOTER).length > 0;
  if (sentInBulk && bodyHits.length === 0 && paperwork.length === 0) {
    return {
      keep: false,
      reason: subjectHits.length > 0
        ? `Bulk mail whose only signal is the subject line ("${subjectHits[0]}").`
        : "Bulk mail with no investment signal.",
      score,
    };
  }

  if (score < KEEP_THRESHOLD) {
    return {
      keep: false,
      reason: reasons.length > 0 ? `Too little to go on: ${reasons.join(", ")}.` : "No investment signal.",
      score,
    };
  }
  return { keep: true, reason: `${reasons.join(", ")}.`, score };
}

/// The Gmail query that finds candidates. Subject phrases plus body phrases
/// plus the paperwork filenames, bounded by age and kept out of spam and
/// trash. Long, but Gmail does the work and the result set stays small.
export function buildDiscoveryQuery(opts: { sinceDays?: number } = {}): string {
  const sinceDays = opts.sinceDays ?? 365;
  const subjectTerms = SUBJECT_PHRASES.map((phrase) => `subject:"${phrase}"`);
  const bodyTerms = [
    '"wire instructions"',
    '"capital call"',
    '"pro rata"',
    '"safe agreement"',
    '"convertible note"',
    '"subscription agreement"',
    '"valuation cap"',
    '"term sheet"',
  ];
  // No `filename:note`: it matches "meeting-notes.pdf", whose full body would
  // then be fetched, and PAPERWORK_FILENAME has no "note" alternative that
  // could ever score it. Pure quota for nothing.
  const filenameTerms = ["filename:safe", "filename:subscription", "filename:spa"];
  const any = [...subjectTerms, ...bodyTerms, ...filenameTerms].join(" OR ");
  // -in:sent and -in:drafts matter more than they look. Gmail searches all mail
  // by default, so without them the investor's own outgoing email about a wire
  // is discovered, and content matching scores a body naming a portfolio
  // company high enough to file it as that company's own update.
  return `(${any}) newer_than:${sinceDays}d -in:spam -in:trash -in:sent -in:drafts -in:chats`;
}
