// Closing the obligations a confirmed transfer has actually discharged.
//
// The reminder to wire and the bank's confirmation that it left the account are
// two records of one event, so leaving the reminder open makes the queue lie.
// The old rule closed any FOLLOW_UP whose title contained "wire", which both
// over-reached (an unrelated note that mentions a wire) and under-reached (a
// "send $500 by Friday" reminder, or a subscription agreement to sign in the
// same thread).
//
// Two rules replace it, and neither reads meaning: one compares money, the
// other compares thread identity. Both are facts already in the database.
//
// Pure and tested: this decides what disappears from the user's task list.

export interface OpenAction {
  id: string;
  kind: string;
  /// Set only on PAYMENT_DUE.
  amount: number | null;
  dueDate: Date | null;
  createdAt: Date;
  /// The thread of the email that raised it, when it came from one.
  threadId: string | null;
}

export interface ConfirmedPayment {
  amount: number;
  valueDate: Date;
  /// Every email thread this transfer settles.
  ///
  /// More than one, because the bank and the syndicate are different
  /// correspondences. The transfer is read from the bank's email, so its own
  /// thread holds nothing but the bank's notices, while the reminders worth
  /// closing ("sign the subscription agreement", "wire your commitment plus
  /// fees") live in the syndicate's wire-instructions thread. Anchoring on the
  /// bank thread alone made this rule inert on real mail.
  threadIds: string[];
}

export interface Resolution {
  id: string;
  rule: "AMOUNT" | "THREAD";
  /// Appended to the item's detail, so a closed task still explains itself.
  note: string;
}

/// Banks and syndicates round to different places, so a dollar either way is
/// the same obligation.
const ROUNDING = 1;

/// A wire bundles the investment with the legal and admin fees charged on it,
/// so the sum that leaves the account sits above the amount that was due. The
/// same ratio governs reconciliation and position merging; a larger gap is a
/// different payment, not a fee.
const MAX_FEE_RATIO = 0.25;

function settles(due: number, paid: number): boolean {
  if (Math.abs(paid - due) <= ROUNDING) return true;
  // Paying less than was asked settles nothing.
  return paid > due && paid - due <= due * MAX_FEE_RATIO;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/// Earliest obligation first: by the date it was due, then by when it was
/// raised. An item with no due date sorts after every dated one, since a
/// deadline is stronger evidence of age than a creation timestamp.
function earliestFirst(a: OpenAction, b: OpenAction): number {
  if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/// What a confirmed transfer closes.
///
/// Rule A, money: a PAYMENT_DUE whose amount this transfer covers. At most one,
/// however many match, because one transfer discharges one obligation. Closing
/// every $2,000 reminder on the strength of a single $2,000 wire would hide a
/// second cheque that is genuinely still owed.
///
/// Rule B, thread: anything still open that was raised in a correspondence this
/// transfer settles, whatever its kind. A wire-instructions thread also carries
/// the subscription agreement to sign and the reminder to send it, and the
/// transfer settles the lot. Thread identity does the work that would otherwise
/// need the model to judge relatedness.
export function resolveOnPayment(actions: OpenAction[], payment: ConfirmedPayment): Resolution[] {
  const resolutions = new Map<string, Resolution>();

  const byAmount = actions
    .filter(
      (action) =>
        action.kind === "PAYMENT_DUE" &&
        action.amount != null &&
        settles(action.amount, payment.amount),
    )
    .sort(earliestFirst);

  const settled = byAmount[0];
  if (settled) {
    resolutions.set(settled.id, {
      id: settled.id,
      rule: "AMOUNT",
      note: `Closed automatically: a ${money(payment.amount)} transfer confirmed on ${payment.valueDate
        .toISOString()
        .slice(0, 10)}.`,
    });
  }

  const settledThreads = new Set(payment.threadIds.filter(Boolean));
  if (settledThreads.size > 0) {
    for (const action of actions) {
      if (!action.threadId || !settledThreads.has(action.threadId)) continue;
      if (resolutions.has(action.id)) continue;
      resolutions.set(action.id, {
        id: action.id,
        rule: "THREAD",
        note: "Closed automatically: resolved in the same email thread as a confirmed transfer.",
      });
    }
  }

  return [...resolutions.values()];
}
