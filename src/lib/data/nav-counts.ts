import "server-only";
import { prisma } from "@/lib/prisma";

// What the nav badges count.
//
// One place on purpose. The Updates tab is where things wait for a decision,
// and more kinds of decision are coming: a proposed position ending, a
// suggested company for mail nobody filed. Each of those adds a term here and
// changes nothing else, which is the point of counting in a function rather
// than in the layout.

export interface NavCounts {
  /// Everything on /updates waiting for the user to decide something.
  updates: number;
}

export async function getNavCounts(userId: string): Promise<NavCounts> {
  const pending = await prisma.update.count({ where: { userId, reviewState: "PENDING" } });
  return { updates: pending };
}
