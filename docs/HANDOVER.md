# Angel Flight: handover

A private, single-user angel portfolio tracker. It holds the portfolio as structured data and
builds most of it from Gmail: what you own, on what terms, what it cost, what is at risk, and what
you have to do next.

Read this before changing anything. The invariants section in particular exists because most bugs
in this codebase have come from breaking one of them, not from writing broken code.

- **Repo:** https://github.com/BZhang93/angel (private). Branches: `develop` for work, `main` for
  stable. No CI or deployment yet.
- **Linear:** project "Angel Investment Tracker" (team Brainchildren Nursery). PRD lives in the
  project document; BRA-208 holds the remaining deployment work.
- **Stack:** Next.js 16 App Router, Prisma 7, Supabase Postgres + Auth + Storage, Claude for
  extraction, Vercel (not yet deployed).

## Running it

```bash
pnpm install
pnpm dev          # regenerates the Prisma client first, on purpose (see below)
pnpm test         # 188 unit tests, all pure logic
pnpm typecheck
pnpm build
```

`.env` is gitignored; `.env.example` documents every variable. Supabase, Gmail OAuth and Claude
are configured; DocuSign is configured but unusable (see External services).

**After any schema change, restart the dev server.** A running server holds a stale Prisma client
and fails with "Unknown field" or "Cannot read properties of undefined". `pnpm dev` runs
`prisma generate` first so this cannot happen at boot, but a migration applied while the server
runs still needs a restart.

Migrations are applied with `prisma migrate deploy`; `migrate dev` is interactive and fails in a
non-interactive shell. Write the SQL by hand into `prisma/migrations/<timestamp>_<name>/migration.sql`
and deploy it.

## Shape of the code

Pure logic lives apart from anything that touches the network or the database, and that is what
makes the interesting parts testable. If a module needs `server-only`, its decision-making usually
belongs in a sibling that does not.

| Concern | Pure | Server |
| --- | --- | --- |
| Portfolio maths | `lib/portfolio.ts` | `lib/data/portfolio.ts` |
| Risk rules | `lib/signals.ts` | via the data layer |
| Reconciliation | `lib/reconcile.ts`, `lib/discrepancies.ts` | `lib/extract/payments.ts` |
| Company identity | `lib/import/identity.ts`, `lib/import/domains.ts` | `lib/import/accept.ts` |
| Deduplication | `lib/import/merge.ts` | `lib/import/scan.ts` |
| Email parsing | `lib/gmail/parse.ts`, `content-match.ts`, `company-queries.ts` | `lib/gmail/*.ts` |
| Fetching pages | `lib/enrich/html.ts`, `net-guard.ts`, `classify.ts` | `lib/enrich/fetch.ts`, `links.ts` |

One ingest pipeline, `lib/gmail/pipeline.ts`, is called by the Sync button, the cron and the push
webhook, so those three cannot drift apart.

## Invariants

Break these and the app quietly lies about money.

1. **Fill, never overwrite.** An extracted value may fill an empty field. It may never replace a
   value already there, and never one a human edited (`editedByUser`). A signed document beats an
   email; neither beats what the user typed.
2. **Deployed includes fees; carrying value does too.** A fee is money that left the account and
   bought no ownership. Excluding it flatters the return, so `totalDeployed` counts it. The
   carrying value of an unmarked position is also the full amount paid, or every position reads
   0.91x on the day it is created.
3. **One position per cheque.** Two readings describe the same investment when their dates fall
   within ten weeks and either the amounts match or a bank figure exceeds a commitment by a
   fee-sized margin. See `lib/import/merge.ts`.
4. **Amounts are attributed, not merged.** Every source records its own `AmountClaim`, and a
   ledger line without a matching claim is invisible to the cross-check, so write both. Trust
   depends on what is being asserted: for what was committed the investor's own words win, for a
   fee or a total the bank does, because those are records of money that moved. Conflicts surface
   as "Needs Review" naming the source.
5. **A fee has a source before a wire does.** A syndicate states the fee exactly, once, in a
   personalised row of its wire instructions. Deriving it from a bank transfer instead only works
   after the money moves, so a position awaiting a wire read as a cleaner deal than it is. The
   table is parsed deterministically in `lib/import/wire-table.ts` and only accepted when the row
   adds up; the model was asked to read it for seven imports and found it once.
6. **Identity is deterministic.** `canonicalCompanyKey` decides that two names are one company.
   Fuzzy matching may suggest a merge; it must never perform one.
7. **A sender domain is not a company website.** Two lists answer two questions: `isCompanyDomain`
   (can this be a website) and `isGroupableSender` (is this sender's mail worth reading). A
   syndicate's or bank's domain is read for deals and transfers and is never an identity.
8. **Provenance on everything extracted.** Every metric, signal, action item and term carries the
   verbatim sentence it came from. If it cannot be quoted, it is not recorded.
9. **Take the best match, never the first.** Sender and content are two readings of one email and the sender rule is weak at its lower end on purpose, so `sender ?? content` let a 0.6 guess suppress a 0.95 match and the email then failed the threshold and filed nowhere. Use `bestMatch`.
10. **Only exactly one named company files an email.** A digest naming several files against none.
   A subject naming one is what the email is about and files at 0.9; a body-only mention is 0.85.
11. **Never claim silence for a filing failure.** If unfiled mail mentions a company, say so and
   point at the review queue instead of reporting the founder as quiet.

## External services and their traps

**Supabase.** `DATABASE_URL` is the transaction pooler (6543) for runtime; `DIRECT_URL` is a direct
or session connection (5432) for migrations, which need prepared statements the pooler cannot do.
The true direct host is IPv6-only, which works from this laptop but not from Vercel, so
`DATABASE_URL` must be the pooler in production. Every table has RLS on with no policies, since
Prisma connects as the owner and the API roles must see nothing. Storage objects live under the
owner's user id with policies enforcing it, and cannot be deleted with SQL, only through the
Storage API, which needs `SUPABASE_SERVICE_ROLE_KEY` (not yet set, and required for the cron).

**Gmail.** Read-only scope, bounded by a user-editable query. 6,000 quota units per minute per
user and a message fetch costs 5, so reads are throttled to ten per second and retried with
backoff. Gmail signals per-minute quota with a **403**, not a 429, and a genuine permission failure
is also a 403; `lib/gmail/throttle.ts` tells them apart. A `users.watch` subscription lapses after
seven days and stops delivering with no error, so it is renewed on every scheduled run. While the
Google OAuth consent screen is in Testing, refresh tokens expire after seven days; publishing the
app removes that.

**Claude.** Credentials resolve as `ANTHROPIC_API_KEY`, then `ANTHROPIC_AUTH_TOKEN`, then an
`ant auth login` profile on disk. The key is commented out in `.env` so local runs use the profile;
a deployment needs a real key, since Vercel cannot read `~/.config/anthropic`. Extraction runs six
calls at a time (`lib/concurrency.ts`) because it is dominated by waiting.

**DocuSign.** Written, working, and unusable: API access is excluded from Personal and Standard
plans, and Go-Live reports "these accounts don't support API integrations". The MCP server hits the
same wall, since it calls the same APIs. Signed PDFs are uploaded by hand instead and read by the
same extractor. Leave the integration in place behind its config.

## Environments

One Supabase project, `wdtxfeciuofzyuyzzhdx`, and the local `.env` is the development
environment. There is no staging database and no Vercel environment configured yet.

Branches do not select a database, env vars do, so a migration run locally is already applied
to the only database there is. Every migration so far has been additive (a new enum value, a
nullable column, a column with a default), which is what makes that safe; a destructive one
would have no untouched copy to fall back to.

Before the app takes anyone else's data, create a second Supabase project for production
rather than pointing Vercel at this one.

## Current data state

Seven companies, all held through Viaka, each with one position and amounts traced to a quote from
the investor's own commitment email. All seven now carry a fee: five from the wire instructions that
stated it, four confirmed by the transfer that settled it. Roughly 196 stored emails, 161 of them
filed against a company. Five of seven companies have a sector and description, filled from fetched
memos. The two that do not are explainable rather than broken: Marr Labs keeps its memos on Drive,
which is gated on purpose, and Asendia's filed mail carries no memo link at all. Documents were cleared during a reset; `scripts/reset-derived.mts` does that again if
needed (dry run by default, `--confirm` to apply).

The review queue holds 34 updates, all scoring zero against every company: they
are about a deal that was never taken and about unrelated personal transfers.
The queue groups by suggested company and confirms a group at once, which is
inert while nothing carries a suggestion and matters from the next deal on.

Bravi is the one position flagged for review, correctly: its wire instructions billed $425 including
a $250 admin fee waived for members, and $175 was wired. The flag names the schedule, not the bank.

Two loose ends: Vessel's wire is filed but not yet extracted, so its position is not marked
payment-confirmed; and existing positions predate `underlyingInstrument`, so they show "not stated"
until a document is re-read or it is set by hand.

## Working preferences

**Communication.** Talk decisions through in prose rather than pushing forms. Keep chat
high-level: no code diffs, no large console dumps. No em dashes in documents or product copy. Say
plainly when a change needs a dev-server restart (🔄) or merely hot-reloads (♻️).

**Verification.** Check against real data before claiming something works. Several bugs here were
found by querying the database and comparing to the underlying emails, and would have been missed
by reasoning alone. When a fix is proposed, simulate its effect on the real mailbox first where
that is possible.

**Code.** Build to a shippable bar: working code, considered UI, finished copy. Pure logic gets
unit tests, especially anything that decides what money means. Comments explain why, not what, and
say what would go wrong otherwise. Shared primitives over per-call-site styling: `ControlRow` and
`CONTROL_*` exist because hand-written alignment classes drifted three times.

**Process.** Work on `develop`, merge to `main`. Run `/code-review` before merging. Commit messages
explain the reasoning, not the file list. Update Linear as work lands.
