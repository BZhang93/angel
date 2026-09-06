// Arranging the review queue so it can be worked through rather than scrolled.
//
// A flat newest-first list makes the reviewer decide the same thing over and
// over: a syndicate sends eight emails about one deal, and each one asks for
// its own company pick and its own click. Grouped by the company already
// suggested, that becomes one decision for the group.
//
// Oldest first throughout, which is the opposite of the old ordering and the
// point of the change: the queue is a backlog, and the thing that has waited
// longest is the thing most likely to be forgotten.
//
// Pure and tested: this decides the order a person works in.

export interface QueueItem {
  companyId: string | null;
  receivedAt: Date;
}

export interface ReviewGroup<T> {
  /// Null for the unassigned group, which has no company to confirm against.
  companyId: string | null;
  companyName: string | null;
  items: T[];
}

/// Groups pending updates by the company each was matched to, oldest first
/// within a group and oldest group first.
///
/// A companyId with no name behind it is treated as unassigned rather than
/// dropped: the company was deleted after the match, so there is nothing to
/// confirm against, but the mail still needs a decision.
export function groupPendingUpdates<T extends QueueItem>(
  updates: T[],
  companyNames: Map<string, string>,
): ReviewGroup<T>[] {
  const groups = new Map<string, ReviewGroup<T>>();
  const unassigned: T[] = [];

  for (const update of updates) {
    const name = update.companyId ? companyNames.get(update.companyId) : undefined;
    if (!update.companyId || !name) {
      unassigned.push(update);
      continue;
    }

    const group = groups.get(update.companyId);
    if (group) group.items.push(update);
    else groups.set(update.companyId, { companyId: update.companyId, companyName: name, items: [update] });
  }

  const oldestFirst = (a: T, b: T) => a.receivedAt.getTime() - b.receivedAt.getTime();

  const ordered = [...groups.values()]
    .map((group) => ({ ...group, items: [...group.items].sort(oldestFirst) }))
    .sort((a, b) => a.items[0]!.receivedAt.getTime() - b.items[0]!.receivedAt.getTime());

  // Always last: it is the residue, and it is the only group without a bulk
  // action, so putting it anywhere else interrupts the run of work.
  if (unassigned.length > 0) {
    ordered.push({
      companyId: null,
      companyName: null,
      items: [...unassigned].sort(oldestFirst),
    });
  }

  return ordered;
}
