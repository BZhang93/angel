import Link from "next/link";
import { logout } from "@/app/login/actions";
import { currentUser } from "@/lib/session";
import { getNavCounts } from "@/lib/data/nav-counts";
import { badgeLabel } from "@/lib/nav-badge";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/companies", label: "Companies" },
  { href: "/import", label: "Import" },
  { href: "/updates", label: "Updates" },
  { href: "/calendar", label: "Calendar" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  // Signed out there is nothing to count, and the layout still renders: the
  // login page lives under its own route but the nav must not query for a
  // user that does not exist.
  const counts = user ? await getNavCounts(user.id) : null;
  const badges: Record<string, string | null> = {
    "/updates": badgeLabel(counts?.updates ?? 0),
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            angel flight
          </Link>
          <nav className="flex flex-1 items-center gap-4 text-sm text-muted">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                {item.label}
                {badges[item.href] && (
                  <span
                    title="Waiting for a decision"
                    className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warn/15 px-1.5 py-0.5 tabular text-[11px] font-medium text-warn"
                  >
                    {badges[item.href]}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          {user && (
            <form action={logout}>
              <button type="submit" className="text-xs text-muted hover:text-foreground">
                Sign Out
              </button>
            </form>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
