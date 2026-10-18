# Contributing to Quiz.me

Thanks for helping. Bug reports, fixes, new extraction heuristics, docs, and
translations are all welcome.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security problems privately, never in a public issue. See
  [SECURITY.md](SECURITY.md).
- For anything larger than a small fix, open an issue first so we can agree
  on the approach.

## Development

[docs/local-dev.md](docs/local-dev.md) explains the setup;
[docs/testing.md](docs/testing.md) lists the test layers.

Install the pre-commit hooks once. They run gitleaks (secret scanning),
basic file checks, and ruff:

```sh
pipx install pre-commit   # or: pip install pre-commit
pre-commit install
```

Before opening a pull request:

```sh
cd web && npm run lint && npm run typecheck && npm test
cd extractor && ruff check . && ruff format --check . && mypy && pytest
helm lint deploy/helm/quizme && helm unittest deploy/helm/quizme
```

CI also runs the integration tests (Testcontainers), the Playwright suite
against docker-compose, CodeQL, image builds with a vulnerability scan, and
gitleaks over the full history.

## Rules for changes

- **Never commit secrets.** No tokens, passwords, client secrets, private
  keys, or `.env` files. Only `.env.example` with placeholders. gitleaks runs
  in pre-commit and CI.
- **No deployment details.** This repository does not contain anyone's
  domain, tenant ID, subscription ID, resource names, or email addresses.
  Use placeholders such as `<your-domain>`.
- **User data goes through `web/src/server/data/`.** That layer scopes every
  query to the signed-in user. ESLint blocks database imports elsewhere. Add
  an ownership test in `web/tests/integration/ownership.test.ts` for any new
  query on user data.
- **Render text, not HTML.** No `dangerouslySetInnerHTML`.
- **Validate input with Zod** and give every string a maximum length.
- **Changing a detector?** Add or update a fixture in
  `extractor/scripts/make_fixtures.py` and the expected cards in
  `extractor/tests/test_fixtures.py`.
- **Pin new GitHub Actions by full commit SHA**, with the version in a
  comment.
- Keep commits focused and write messages that explain why.

## Pull requests from forks

Workflows triggered by pull requests from forks run with a read-only token
and no secrets. Nothing in CI needs secrets: the e2e job generates throwaway
credentials for its own docker-compose stack.

## For maintainers: repository settings

Please keep these enabled on `LimeQuizz/Quiz.me`:

- **Branch protection on `main`:** require a pull request with at least one
  approving review, require review from Code Owners, require the CI checks
  (`gitleaks`, `web-lint`, `web-unit`, `web-integration`, `extractor-lint`,
  `extractor-test`, `helm`, `images`, `e2e`, CodeQL) to pass, dismiss stale
  approvals, block force pushes and deletion.
- **Secret scanning and push protection** (Settings, Code security).
- **Dependabot alerts and security updates.**
- **Private vulnerability reporting.**
- **Actions:** "Require approval for all outside collaborators" for fork
  workflows, and default `GITHUB_TOKEN` permissions set to read-only.
- **Tag protection** for `v*` tags, since tags publish releases.

## Releases

Pushing a `vX.Y.Z` tag on `main` publishes versioned images and the Helm
chart. Bump `deploy/helm/quizme/Chart.yaml` (`version` and `appVersion`) in
the same pull request that prepares the release.
