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

## Next steps

Ordered, because the first item blocks the two after it. Last revised 2026-10-04.

1. **Reconnect Gmail. This one needs a human.** Google answers the refresh request with
   `400 invalid_grant: Bad Request`. Two things follow from the error code and neither is a guess.
   `invalid_grant` rather than `invalid_client` means Google accepted `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, so the environment is fine and only the stored grant is dead;
   `decryptSecret` succeeds before the request goes out, so `APP_ENCRYPTION_KEY` is intact too.

   What killed the grant is **not** determinable from inside the app. The token was written when the
   account was connected on 2026-09-03 23:47Z and last used successfully at 2026-09-04 04:40Z, five
   hours later, and nothing has exercised it since, so the death could date from anywhere in the
   33 days after. The seven-day Testing-mode expiry under External services fits, but so do a
   revoke and a password change, and there is no observation in the window that separates them. Two
   places outside the app decide it: the consent screen's publishing status in the Google Cloud
   console, and the third-party access page in the Google account, which shows a revoke. Check
   those before concluding anything, and publish the consent screen only if it really says Testing.

   The month of silence has a separate and duller cause: no sync was scheduled to run. `autoSync` is
   on, but Gmail push cannot reach a laptop and the hourly run is a Vercel cron that does not exist
   until BRA-208 deploys. Nothing failed silently because nothing ran. The loudness problem is still
   real for when it does run, and is worth fixing in the same pass.

2. **Recover the 21 lost bodies.** Run
   `NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/reparse-truncated.mts`.
   Gmail calls only, no LLM, so it costs nothing. Each repaired row has `extractedAt` cleared, so
   the normal extraction pass picks it up afterwards; that pass does cost tokens. Watch the first
   one rather than running all 21 blind. **Vessel is the priority:** nine of its monthly updates
   were stored empty, so it has effectively never been read and its sector, trend and signals are
   built on nothing. Then Saile (5), Bravi (4), Zaqa AI (1).

3. **Sync, to pull the unread month.** Only once Gmail authenticates again. A September Saile update
   is the known example, and there is a month of mail behind it.

4. **BRA-214, multi-user.** The cron calls `findFirst({ autoSync: true })` and therefore syncs one
   arbitrary user; it needs `findMany` and a loop. Also a disposable-email blocklist in `signup()`
   and a cross-tenant isolation integration test. Database-level RLS is deliberately deferred: see the
   Supabase note under External services for why `where: { userId }` is the real boundary. One item cannot be done from here, the "confirm email before
   sign-in" setting, which exists only in the Supabase dashboard.

5. **BRA-208, deploy.** The runbook is now `docs/DEPLOY.md`, written in order, with
   the steps that need a human at a dashboard marked. The short version: a separate Supabase
   project for production, the pooler for `DATABASE_URL` with `DIRECT_URL` left unset in Vercel,
   migrations run from a laptop, Node 22, a fresh `APP_ENCRYPTION_KEY` that then never changes,
   and the production redirect URIs added to the Google OAuth client. Read section 5 of it before
   letting anyone else sign up: sign-up is unrestricted and the tenant boundary is `where:
   { userId }` with no test behind it.

6. **Then promote.** `main` was fast-forwarded to `develop` on 2026-10-18 after a review, and the
   two matched at `4146a96`. **Still none of it has been exercised in a browser**, so the
   browser pass is owed on `main` as much as it was on `develop`. The review that ran then left ten
   findings unaddressed, four of them medium: double-settling one payment against two obligations,
   fees booked against an unconfirmed company match, `UNFILED_MAIL` blind to pending rows, and the
   truncation heuristic below.

Known and not yet ticketed: Marr Labs carries nine stale signature reminders that only a
"completed DocuSign envelope closes its reminders" rule would clear. Worth a ticket of its own.

## Running it

```bash
pnpm install
pnpm dev          # regenerates the Prisma client first, on purpose (see below)
pnpm test         # 267 unit tests, all pure logic
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
12. **An email that yielded nothing says so.** A body the parser emptied and an extraction that
   found nothing both used to be indistinguishable from a quiet month, which is how 21 forwarded
   updates sat empty across four companies while their pages read as healthy. Both now set
   `Update.ingestIssue`, and a flagged row cannot auto-confirm on a subject-line match, because a
   subject survives truncation and was scoring 0.9 on its own.
13. **The sync never re-reads a stored email.** It deduplicates on Gmail message id, so no number
   of syncs will repair a row that was parsed wrongly. Repairing one is a different operation:
   `lib/gmail/reparse.ts` re-fetches by message id and rewrites only the parsed fields, leaving the
   company match, review state and anything `editedByUser` alone.
14. **Trim the bottom of an email, not the top.** Quoted-reply markers cut at the earliest match,
   and a forward puts `From:` in a header block at the top, so the marker meant for Outlook history
   discarded entire payloads. `stripQuotedReplies` skips a forward preamble before cutting. The
   test that claimed to cover this had no forward in its fixture, which is why it passed for months.

15. **Searching is free, storing is the decision.** Discovery searches the whole mailbox because
    the search happens inside Gmail and reveals nothing. Storing is what exposes an email, since a
    stored row is later read by the LLM, so the gate in `lib/gmail/discovery.ts` is deterministic
    and tested rather than a judgement made by another model. Mail it refuses is never stored.

16. **A bulk header is not a disqualification.** Many founders send their updates through a
    mailing tool, so List-Unsubscribe only raises the bar: such mail has to earn its way in on deal
    vocabulary rather than on a subject line that merely reads right.

17. **An email the user never filed explains itself.** Discovery records why it kept each one in
    `ingestReason`, and the review queue shows it. Without that the queue reads as the app having
    rummaged through the mailbox.

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

Of the 196 stored emails, 44 have been extracted and **32 are flagged as having carried nothing**:
21 whose bodies the forward bug emptied (Vessel 9, Saile 5, Bravi 4, Zaqa AI 1) and 11 that
extracted cleanly and produced no metrics, signals, money or documents. The second group is not
necessarily broken; some months genuinely have no news in them. Both show a notice on the company
page and in the review queue. Treat any per-company reading of signals or trend as provisional
until step 2 of Next steps has run, Vessel's above all.

Three loose ends: Vessel's wire is filed but not yet extracted, so its position is not marked
payment-confirmed; existing positions predate `underlyingInstrument`, so they show "not stated"
until a document is re-read or it is set by hand; and Gmail has not synced since 2026-09-04 because
its refresh token is dead, so everything above is a month stale.

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
