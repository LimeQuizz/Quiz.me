# Testing

| Layer | Tool | Location | Needs | CI job |
|-------|------|----------|-------|--------|
| Web unit | Vitest | `web/tests/unit/` | Node | `web-unit` |
| Web integration | Vitest + Testcontainers (PostgreSQL 16) | `web/tests/integration/` | Docker | `web-integration` |
| Extractor unit and fixtures | pytest | `extractor/tests/` | Python, Tesseract | `extractor-test` |
| Extractor API | pytest + httpx (ASGI transport) | `extractor/tests/integration/` | Python, Tesseract | `extractor-test` |
| End to end | Playwright against docker-compose | `web/e2e/` | Docker, built images | `e2e` |
| Helm | `helm lint`, helm-unittest | `deploy/helm/quizme/tests/` | Helm | `helm` |
| Static | ESLint, `tsc`, ruff, mypy `--strict`, CodeQL, gitleaks, Trivy | | | several |

Coverage reports are uploaded as CI artifacts: `coverage-web-unit`,
`coverage-web-integration`, and `coverage-extractor`. Playwright traces,
screenshots, and the compose logs are uploaded as `e2e-report`.

## Web

```sh
cd web
npm test                 # unit tests
npm run test:unit        # unit tests with coverage (coverage/)
npm run test:integration # starts PostgreSQL in Docker via Testcontainers
```

Unit tests cover FSRS scheduling, fuzzy answer matching, CSV export (formula
injection guard), rate-limit windows, Zod limits, security headers and CSP,
upload magic-byte checks, distractor generation, auth configuration (cookie
flags, no email linking, test-mode guard), and an architecture test that
fails if code outside `src/server/data` imports the database.

Integration tests run against a real PostgreSQL with the same roles as
production: `roles.sql` creates `quizme_migrator` and `quizme_app`,
migrations run as the migrator, and tests connect as the runtime role. They
cover:

- **Ownership:** a second user cannot read, update, delete, export, study,
  or rate cards in another user's deck, or upload into it. Each case asserts
  the same "not found" result as a missing deck, so IDs cannot be probed.
- Rate limiting (10/hour, 100/day, `Retry-After`), including concurrent
  reservations.
- The upload route end to end with a stubbed extractor.
- Account deletion in one transaction.
- The Auth.js adapter: no lookup by email, no token storage.
- Database roles: the runtime role cannot run DDL.

If Docker uses a mirror or a proxy, set `TEST_POSTGRES_IMAGE`. On hosts where
the Testcontainers reaper cannot start, set `TESTCONTAINERS_RYUK_DISABLED=true`.

## Extractor

```sh
cd extractor
. .venv/bin/activate
ruff check . && ruff format --check . && mypy
pytest --cov
```

`tests/test_fixtures.py` asserts the exact cards extracted from each fixture
in `tests/fixtures/`, including the scanned PDF (OCR path). The API tests
cover authentication, size limits (header and streamed), magic bytes,
encrypted and macro-enabled files, corrupt files, the page cap, the timeout,
and that the temporary file is always deleted.

## End to end

The e2e suite runs against the production images in docker-compose with
`AUTH_TEST_MODE=true` (the `docker-compose.e2e.yml` overlay), on three
Playwright projects: Desktop Chrome, Pixel 7, and iPhone 14 (viewport and
user agent; rendered with Chromium).

```sh
docker compose build
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --wait
cd web && npx playwright install chromium && npm run test:e2e
docker compose -f docker-compose.yml -f docker-compose.e2e.yml down -v
```

The flow tests check that signed-out visitors are redirected, then sign in,
upload a PPTX fixture, review and accept the extracted cards, study them as
flashcards, and confirm a second user cannot open the first user's deck by
URL. The security tests check response headers, a fresh CSP nonce per
request, that pages run with no CSP violations, and that cross-origin
state-changing requests are refused.

## Helm

```sh
helm lint deploy/helm/quizme -f deploy/helm/quizme/ci-values.yaml --strict
helm unittest deploy/helm/quizme
```
