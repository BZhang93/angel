# Angel

A private, single-user tracker for angel investments: what you own, on what terms, what it is
worth, what is at risk, and what you have to do next. Investor updates are pulled from Gmail and
turned into per-company metrics, risk flags and a task queue.

PRD: the "Angel Investment Tracker PRD" document in Linear.

## Stack

Next.js (App Router) · Prisma 7 · Supabase Postgres + Auth · Vercel · Claude for extraction.

## Getting started

```bash
pnpm install
cp .env.example .env       # fill in the values, see below
pnpm db:migrate            # creates the schema
pnpm dev
```

Then sign up at `/login`, and optionally seed demo data:

```bash
SEED_USER_ID=<your supabase auth user id> pnpm db:seed
```

### Environment

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project, safe to expose. The older `NEXT_PUBLIC_SUPABASE_ANON_KEY` name is still accepted |
| `DATABASE_URL` | Pooled connection (port 6543), used at runtime |
| `DIRECT_URL` | Direct connection (port 5432), used by migrations and seeds |
| `APP_ENCRYPTION_KEY` | 32 bytes base64. Encrypts the stored Gmail refresh token |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client for read-only Gmail |
| `ANTHROPIC_API_KEY` | Claude, for extraction. Without it, updates are stored but not extracted |
| `CRON_SECRET` | Shared secret for the daily Vercel cron sync |

Never prefix a secret with `NEXT_PUBLIC_`.

## How it works

**Money is a ledger.** A position's value is never a stored number. Cash in and out lives in
`Transaction`, worth lives in `Valuation`, and deployed, realized, unrealized, MOIC and IRR are all
computed in `src/lib/portfolio.ts`. Every one of those functions is pure and unit tested.

**Convertibles are linked, not mutated.** A SAFE that converts points at the equity position it
became (`Position.convertedIntoId`). The original row keeps its original terms, so history stays
auditable.

**Risk rules need no LLM.** `src/lib/signals.ts` derives silence, low runway, approaching note
maturity, the QSBS five-year date, and down rounds from data the app already holds. Silence is the
most valuable of these: a founder who stops writing is usually a founder with bad news.

**Extraction carries provenance.** Every metric, risk and action item the model produces stores the
verbatim sentence it came from, a confidence score, and an `editedByUser` flag. Re-running
extraction replaces machine-written rows and never touches a value a human corrected.

**Matching is conservative.** An email is auto-assigned to a company only on a known contact
address or a matching sender domain. Anything weaker waits in the review queue at `/updates`.

## Privacy

This holds personal financial data and confidential private-company information.

- Single-user auth; every query is scoped to the signed-in Supabase user id.
- The Gmail scope is read-only, and only messages matching the sync query in Settings are ever
  fetched. Keep it narrow.
- Update bodies are sent to Anthropic when an update is extracted. That is stated in Settings.
- The Gmail refresh token is stored AES-256-GCM encrypted, with the key only in the environment.

## Commands

```bash
pnpm dev          # local dev server
pnpm test         # unit tests (vitest)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm build        # prisma generate && next build
pnpm db:migrate   # create and apply a migration locally
pnpm db:deploy    # apply pending migrations to a shared/prod database
pnpm db:studio    # browse the data
```

## Documents

Signed instruments reach the app three ways, all of which end in the same reader:

1. **Email attachments**, ingested automatically during a sync.
2. **DocuSign**, pulled over the eSignature API. This needs a DocuSign plan that includes API
   access; Personal and Standard do not, and Go-Live reports that the account does not support
   API integrations.
3. **Manual upload** on a company page, which is the answer when neither of the above applies.

Whatever the source, extracted terms may fill a gap on a position and never overwrite a value
already recorded, and an unsigned draft never touches a position at all.

## Not built yet

Document upload to Supabase Storage, CSV export for the accountant, and multi-currency. The schema
already carries the fields for the first two.
