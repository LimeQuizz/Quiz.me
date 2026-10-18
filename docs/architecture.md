# Architecture

Quiz.me is an open source flashcard app. A signed-in user uploads a PDF or
PPTX, the app proposes question/answer cards, the user reviews them, and the
accepted cards become a private deck that can be studied from any browser.

## Components

```
                   browser (phone, tablet, desktop)
                              |
                         HTTPS (ingress terminates TLS, sets HSTS)
                              |
                   +----------v-----------+
                   |  web  (Next.js 15)   |  Auth.js (Google, Microsoft Entra ID)
                   |  - UI, server actions|  Drizzle ORM
                   |  - ownership layer   |
                   |  - upload proxy      |
                   +----+------------+----+
       internal HTTP    |            |   TCP + TLS
  X-Extractor-Secret    |            |
                 +------v------+  +--v-----------------+
                 |  extractor  |  |  PostgreSQL 16     |
                 |  (FastAPI)  |  |  users, decks,     |
                 |  no egress  |  |  cards, progress   |
                 +-------------+  +--------------------+
```

| Component | Tech | Responsibility |
|-----------|------|----------------|
| `web/` | Next.js 15 App Router, TypeScript, Tailwind, Drizzle, Auth.js v5 | Sign-in, UI, server actions, upload proxy, study scheduling (FSRS), CSV export |
| `extractor/` | Python 3.12, FastAPI, PyMuPDF, python-pptx, Tesseract | Turns one file into candidate cards. Stateless. Never stores files or talks to the database. |
| Postgres | PostgreSQL 16 | All persistent state. See [data-model.md](data-model.md). |

There is no object storage. Uploaded files exist only in memory in the web
process (as a stream) and on a tmpfs inside the extractor for the duration of
one extraction.

## Request flows

### Sign-in

1. The user picks Google or Microsoft on `/signin`.
2. Auth.js runs the OAuth 2.0 / OIDC authorization code flow with PKCE and
   state checks.
3. On callback, Auth.js looks up `accounts(provider, provider_account_id)`.
   If found, that user signs in. If not, a new user is created. Accounts are
   never linked by matching email (see [threat-model.md](threat-model.md)).
4. A row is written to `sessions`, and the browser receives an httpOnly,
   SameSite=Lax session cookie (Secure whenever `AUTH_URL` is https). Sessions
   last 30 days and roll forward on use.

A signed-in user can link a second provider from `/account`. That is the only
way two provider accounts end up on one user.

### Upload and review

1. The browser `POST`s the raw file body to `/api/uploads`.
2. The route handler authenticates the user, checks the per-user rate limit
   (10/hour, 100/day, counted in `upload_events`), and if a target deck is
   given, checks the user owns it.
3. The body is streamed through a size-and-magic-bytes check (25 MB, `%PDF-`
   or a ZIP header) straight into an internal `POST /v1/extract` call to the
   extractor, with the shared secret in `X-Extractor-Secret`.
4. The extractor writes the stream to a tmpfs file, validates it (magic bytes,
   PPTX content types, no macros, no encryption), runs the pipeline in a
   child process with a hard 60 s timeout, deletes the file in a `finally`
   block, and returns JSON cards.
5. The web route returns those candidate cards to the browser. Nothing is
   persisted yet except the `upload_events` row.
6. The review screen lets the user edit, delete, or accept each card. Saving
   calls a server action that validates every card with Zod and inserts the
   deck and cards in one transaction.

### Study

Study pages load the deck through the ownership layer. Flashcard ratings
(Again/Hard/Good/Easy) are sent to a server action that runs the FSRS
scheduler from `ts-fsrs` and writes `card_progress` and `review_log`. The
multiple choice, write, and test modes are practice modes and do not change
the schedule.

## The ownership layer

All database access for user data lives in `web/src/server/data/`. Every
exported function takes the caller's `userId` as its first argument and
filters on it:

- deck queries always include `decks.user_id = $userId`;
- card queries always join `decks` and filter on `decks.user_id`;
- progress and review rows carry `user_id` and are filtered on it.

Server actions and route handlers obtain `userId` from the Auth.js session via
`requireUserId()` and only ever call this layer. An ESLint rule
(`no-restricted-imports`) forbids importing the database client or schema from
anywhere else in `src/`, so a new route cannot bypass the layer without the
lint step failing. Integration tests in `web/tests/integration/` run every
function against a real Postgres and prove cross-user access is denied.

A deck that exists but belongs to someone else is reported exactly like a deck
that does not exist (404), so IDs cannot be probed.

## Configuration

All configuration is environment variables; see [`.env.example`](../.env.example)
for the full list. Secrets (`AUTH_SECRET`, OAuth client secrets,
`EXTRACTOR_SHARED_SECRET`, database URLs) are injected at runtime by the
platform (Kubernetes Secrets via `existingSecret` in the Helm chart, or a key
vault in managed platforms). The repository contains no secrets.

## Deployment artifacts

This repository publishes, and never deploys:

- `ghcr.io/limequizz/quizme-web` and `ghcr.io/limequizz/quizme-extractor`
  images, signed with cosign keyless signing, with an SBOM and SLSA
  provenance attestation;
- the Helm chart `oci://ghcr.io/limequizz/charts/quizme`;
- reference Bicep for Azure Container Apps under
  `deploy/azure-container-apps/` (documentation for operators).

Operators keep their environment-specific configuration in their own private
repository. See [deploy.md](deploy.md).

## Further reading

- [data-model.md](data-model.md)
- [extraction.md](extraction.md)
- [threat-model.md](threat-model.md)
- [local-dev.md](local-dev.md)
- [testing.md](testing.md)
