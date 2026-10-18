# Local development

## Prerequisites

- Docker with Compose v2
- Node.js 22 and npm
- Python 3.12 and Tesseract OCR with English data
  (`apt install tesseract-ocr tesseract-ocr-eng`, `brew install tesseract`)
- Optional: Helm 3 with the [helm-unittest](https://github.com/helm-unittest/helm-unittest)
  plugin, and [pre-commit](https://pre-commit.com)

## Configuration

```sh
cp .env.example .env
```

Replace every `change-me-*` value with a random one (the README quickstart
has a one-liner). `EXTRACTOR_SHARED_SECRET` must be at least 32 characters.
`.env` is gitignored; never commit it.

For OAuth sign-in locally, register redirect URIs
`http://localhost:3000/api/auth/callback/google` and
`http://localhost:3000/api/auth/callback/microsoft-entra-id`
(see [deploy.md](deploy.md#sign-in-providers)). Without OAuth apps, set
`AUTH_TEST_MODE=true` to get a password-less test sign-in. The web app
refuses that setting unless `AUTH_URL` points at localhost.

## Everything in Docker

```sh
docker compose up --build -d --wait
docker compose logs -f web extractor
```

Postgres creates the `quizme_migrator` and `quizme_app` roles from
`web/db/roles.sql` the first time its volume is created, and the web
container runs migrations when it starts. `docker compose down -v` wipes the
database.

## Web on the host, the rest in Docker

```sh
# Postgres plus the extractor published on 127.0.0.1:8000
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres extractor

cd web
npm ci
set -a; . ../.env; set +a
npm run db:migrate      # uses MIGRATION_DATABASE_URL
npm run dev             # http://localhost:3000
```

## Extractor on the host

```sh
cd extractor
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export EXTRACTOR_SHARED_SECRET=$(openssl rand -hex 32) EXTRACTOR_TMP_DIR=/tmp
uvicorn --factory app.main:create_app --port 8000 --reload
```

Try it against a fixture:

```sh
curl -sS -X POST localhost:8000/v1/extract \
  -H "X-Extractor-Secret: $EXTRACTOR_SHARED_SECRET" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @tests/fixtures/qa_worksheet.pdf | jq
```

Regenerate fixtures with `python scripts/make_fixtures.py`.

## Database changes

Edit `web/src/server/db/schema.ts`, then:

```sh
cd web && npm run db:generate   # writes a new SQL migration under drizzle/
```

Review the generated SQL and commit it with the schema change.

## Layout

```
web/                       Next.js app (UI, auth, server actions, upload proxy)
  src/server/data/         the only module that queries user data
  src/server/auth/         Auth.js configuration and adapter
  db/roles.sql             database roles
  drizzle/                 SQL migrations
  tests/unit, tests/integration, e2e/
extractor/                 FastAPI extraction service
  app/pipeline/            text extraction, OCR, cleanup, detectors
  tests/                   unit, fixture and API tests
deploy/helm/quizme/        Helm chart
deploy/azure-container-apps/  reference Bicep (documentation only)
```
