import Link from "next/link";
import { logout } from "@/app/login/actions";
import { currentUser } from "@/lib/session";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/companies", label: "Companies" },
  { href: "/vehicles", label: "Vehicles" },
  { href: "/import", label: "Import" },
  { href: "/updates", label: "Updates" },
  { href: "/calendar", label: "Calendar" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Angel
          </Link>
          <nav className="flex flex-1 items-center gap-4 text-sm text-muted">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
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
