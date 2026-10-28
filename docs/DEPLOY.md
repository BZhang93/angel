# Deploying Angel Flight

Written to be followed in order. Steps marked **you** need a human at a dashboard:
I cannot create projects, hold keys or click consent screens.

Nothing here has run yet. This is the first deployment.

## 1. A separate Supabase project for production (you)

Do not point production at `wdtxfeciuofzyuyzzhdx`. That project is the development
database and holds the real portfolio; a deployment that writes to it has no
margin for a bad migration, and there is no second copy.

Create a new project, then from its Settings:

- `NEXT_PUBLIC_SUPABASE_URL`, the project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the anon public key. Public by design: every
  table has RLS enabled with no policies, so this key reads nothing.
- `SUPABASE_SERVICE_ROLE_KEY`, from the same page. Secret. Needed for attachment
  storage, which is the only thing that bypasses RLS. Never prefix it with
  `NEXT_PUBLIC_`.
- `DATABASE_URL`, the **pooler** string on port 6543.

Then, in the new project's dashboard:

- Authentication, turn on "Confirm email" before sign-in.
- Storage, create the attachments bucket, private, and set
  `SUPABASE_ATTACHMENTS_BUCKET` to its name.

### The connection string trap

Set `DATABASE_URL` to the pooler (6543) and **do not set `DIRECT_URL` in
Vercel**. The direct host (5432) is IPv6 only and Vercel's functions cannot
reach it, so a `DIRECT_URL` present in the environment makes every query that
uses it fail with a connection timeout that reads like a credentials problem.

Migrations therefore do not run from Vercel. Run them from your machine against
the production database, once, before the first deploy:

    DIRECT_URL="<prod direct string>" npx prisma migrate deploy

## 2. Vercel project (you)

Import the repo, framework Next.js, and set Node to **22 or later**. Node 20
still builds but `@supabase/supabase-js` now warns that it is deprecated, and
the warning will become a break.

`vercel.json` already declares the hourly cron at `/api/gmail/sync`. It needs
`CRON_SECRET` set, because the route authenticates the scheduled caller with it
and **fails closed**: with no secret set, the cron request falls through to the
session check and gets a 401. A cron that quietly does nothing is the failure
mode this project has already had once.

## 3. Environment variables

| Variable | Secret | Why |
| --- | --- | --- |
| `DATABASE_URL` | yes | Pooler, port 6543 |
| `DIRECT_URL` | - | **Leave unset in Vercel.** Local only, for migrations |
| `NEXT_PUBLIC_SUPABASE_URL` | no | Supabase API host |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Browser key, RLS makes it safe |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Attachment storage only |
| `SUPABASE_ATTACHMENTS_BUCKET` | no | Bucket name |
| `APP_ENCRYPTION_KEY` | yes | AES-256 key for stored Gmail refresh tokens |
| `ANTHROPIC_API_KEY` | yes | Extraction. A real key, with spend limits set |
| `AI_MODEL` | no | Optional override |
| `GOOGLE_CLIENT_ID` | no | OAuth client |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client |
| `GOOGLE_PUBSUB_TOPIC` | no | Optional. Without it, ingest polls hourly |
| `CRON_SECRET` | yes | Authenticates the scheduled run |
| `DOCUSIGN_INTEGRATION_KEY` | no | Optional |
| `DOCUSIGN_SECRET_KEY` | yes | Optional |

`APP_ENCRYPTION_KEY` is a **new** key for production, generated with
`openssl rand -base64 32`. It must never change afterwards: the stored Gmail
refresh tokens are encrypted with it and become unreadable without it. Do not
copy the development key into production, and do not copy production data back.

## 4. Google OAuth for the production domain (you)

In the Google Cloud console, add to the OAuth client:

- Authorized redirect URI: `https://<domain>/api/gmail/callback`
- Authorized redirect URI: `https://<domain>/api/docusign/callback` if DocuSign
  is used

Leaving these out produces a `redirect_uri_mismatch` after the user has already
granted consent, which is the most confusing possible moment to fail.

**Publish the consent screen** while you are here, or leave it in Testing
knowingly: in Testing, Google expires refresh tokens after seven days, so every
connected account silently stops syncing a week after it connects.

## 5. Before you open it to anyone else

Two things are open by design for a single user and are not safe once a stranger
can sign up.

- **Sign-up is unrestricted.** `signup()` in `src/app/login/actions.ts` accepts
  any address. For a private tool, restrict it to your own address; if it is to
  be a product, it needs a disposable-address blocklist at minimum.
- **The tenant boundary is `where: { userId }` and nothing else.** Every table
  has RLS enabled with zero policies, but Prisma connects as the table owner and
  so bypasses RLS entirely. Each server action was read and each one does check
  ownership before it mutates, but there is no automated test holding that line,
  so the next action written is one forgotten `userId` away from showing one
  investor another's portfolio.

## 6. First deploy

1. Migrations applied to the production database (step 1).
2. Deploy.
3. Sign up, confirm the email, sign in.
4. Connect Gmail. Check the consent screen names the production domain.
5. Press Sync Now once and read the result line before turning auto-sync on.
   The first run on a real mailbox is the one worth watching: discovery reports
   how many emails it searched and left alone, and that number is the check on
   whether the gate is set where you want it.
