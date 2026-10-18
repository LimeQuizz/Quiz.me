# Quiz.me

Quiz.me is an open source alternative to Quizlet. Sign in with a personal
Google or Microsoft account, upload a PDF or PowerPoint file, review the
flashcards Quiz.me finds in it, and study them from any browser on a phone,
tablet, or computer.

Licensed under the [Apache License 2.0](LICENSE).

## Goals

- **Your material stays yours.** Decks are private to the account that
  created them. There is no sharing, no public gallery, no ads, and no
  tracking scripts.
- **Turn existing notes into cards.** Worksheets, glossaries, and lecture
  slides already contain questions and definitions; Quiz.me finds them so you
  do not retype them.
- **Study well.** Spaced repetition (FSRS) decides what is due, plus quiz
  modes for practice.
- **Easy to run yourself.** Three containers (web, extractor, PostgreSQL),
  signed images, a Helm chart, and reference Azure Bicep.

## Features compared to Quizlet

| | Quiz.me v1 | Quizlet |
|---|---|---|
| Create cards by hand | Yes | Yes |
| Create cards from a PDF or PPTX | Yes, rule-based, with a review step | Yes (AI features, paid tiers) |
| Scanned PDFs and image-only slides | Yes, OCR (English) | Yes |
| Flashcards with spaced repetition | Yes, FSRS | Partly, in paid tiers |
| Multiple choice, written answer, test | Yes | Yes |
| Matching game, audio, diagrams | No | Yes |
| Share decks, classes, public library | No (private only) | Yes |
| CSV export | Yes | Yes |
| Mobile apps | No; responsive web app down to 360 px wide | Yes |
| Self-hosting | Yes | No |
| Source code | Apache 2.0 | Closed |
| Ads | None | On the free tier |

## Privacy

- **Sign-in:** Google or Microsoft. Quiz.me stores your provider account ID,
  name, and email address. It does not store profile pictures, and it does
  not keep OAuth access or refresh tokens after sign-in.
- **Uploaded files are never stored.** The web server streams the file
  directly to the extractor. The extractor writes it to a temporary file on a
  memory-backed filesystem (tmpfs in docker-compose and Kubernetes), runs
  the extraction, and deletes the file in a `finally` block whether the
  extraction succeeded, failed, or timed out. There is no object storage.
  Only the cards you choose to save are kept.
- **No third parties see your files.** Extraction runs locally with
  PyMuPDF, python-pptx, and Tesseract. The extractor has no outbound network
  access.
- **Logs** are JSON and contain request metadata (route, status, timing,
  user ID). They never contain card text, file contents, file names, or
  email addresses.
- **Delete my account** removes your user, sign-in links, sessions, decks,
  cards, study history, and upload counters in one database transaction.
- **Export** your decks as CSV at any time.

## Security

What the code does, factually; see [docs/threat-model.md](docs/threat-model.md)
for the full analysis and what is not covered.

- Database sessions in httpOnly, SameSite=Lax cookies (Secure over HTTPS),
  30-day rolling expiry. Accounts are never linked by matching email.
- Every query on user data goes through one data-access layer that filters
  by the signed-in user's ID; a lint rule blocks database imports anywhere
  else. Integration tests check that one user cannot read, edit, delete,
  export, or upload into another user's deck.
- Uploads: 25 MB limit, type detected from magic bytes, encrypted PDFs and
  macro-enabled presentations rejected, ZIP bomb checks, 300-page cap, 60 s
  timeout that kills the whole worker process group, per-process memory
  limit, rate limits of 10 per hour and 100 per day.
- Content Security Policy with per-request nonces and no `unsafe-inline`
  scripts, plus `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `frame-ancestors 'none'`, and a cross-origin
  resource policy. Origin checks on every state-changing request.
- Card text is rendered as text, never as HTML.
- Containers run as a non-root user with a read-only root filesystem.
- Release images are signed with cosign and ship with an SBOM and SLSA
  provenance attestations. All GitHub Actions are pinned by commit SHA.

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Quickstart (about 5 minutes)

You need Docker with Compose v2.

```sh
git clone https://github.com/LimeQuizz/Quiz.me.git && cd Quiz.me
cp .env.example .env

# Fill in random local passwords and secrets.
for k in POSTGRES_PASSWORD POSTGRES_MIGRATOR_PASSWORD POSTGRES_APP_PASSWORD; do
  sed -i.bak "s|^$k=.*|$k=$(openssl rand -hex 16)|" .env
done
sed -i.bak "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" .env
sed -i.bak "s|^EXTRACTOR_SHARED_SECRET=.*|EXTRACTOR_SHARED_SECRET=$(openssl rand -hex 32)|" .env
rm .env.bak

docker compose up --build -d --wait
```

Open http://localhost:3000.

To sign in you need OAuth credentials: create a Google client and a Microsoft
app registration as described in [docs/deploy.md](docs/deploy.md#sign-in-providers)
with redirect URIs `http://localhost:3000/api/auth/callback/google` and
`http://localhost:3000/api/auth/callback/microsoft-entra-id`, put the IDs and
secrets in `.env`, and run `docker compose up -d` again.

To try the app without OAuth apps, use the test sign-in that the end-to-end
tests use. It only works on localhost:

```sh
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d --wait
```

See [docs/local-dev.md](docs/local-dev.md) for running the web app and
extractor outside Docker.

## Deploy your own

- **Kubernetes:** `helm install quizme oci://ghcr.io/limequizz/charts/quizme`
  with your own values and Secrets.
- **Azure Container Apps:** reference Bicep in
  [deploy/azure-container-apps/](deploy/azure-container-apps/).

[docs/deploy.md](docs/deploy.md) covers OAuth app registration, verifying
image signatures with `cosign verify`, a private deployment repository with
GitHub Environments and OIDC, and updating to a new image tag. This
repository publishes images and the chart; it never deploys anything itself.

## Documentation

| Document | Contents |
|----------|----------|
| [architecture.md](docs/architecture.md) | Components and request flows |
| [data-model.md](docs/data-model.md) | Tables, database roles, account deletion |
| [extraction.md](docs/extraction.md) | Extractor API, pipeline, detectors |
| [threat-model.md](docs/threat-model.md) | Assets, trust boundaries, threats, what is not covered |
| [deploy.md](docs/deploy.md) | Running Quiz.me in production |
| [local-dev.md](docs/local-dev.md) | Development setup |
| [testing.md](docs/testing.md) | Test layers and how to run them |

## Roadmap

- Import from CSV and Quizlet export files.
- More languages for OCR (Tesseract language packs).
- An optional, opt-in model-based extractor behind the interface in
  [extraction.md](docs/extraction.md#interface-for-a-future-llm-extractor).
- Images on cards.
- Offline study (installable PWA).
- Sharing a deck by link, off by default.
- Matching game.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).
