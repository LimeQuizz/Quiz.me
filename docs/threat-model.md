# Threat model

This document lists what Quiz.me protects, who might attack it, and which
controls address each threat. It describes the code in this repository and
the reference deployments; an operator's own deployment can add or remove
protections.

## Assets

| Asset | Why it matters |
|-------|----------------|
| Users' decks, cards, and study history | Private study material; may contain personal or confidential notes copied from course files |
| Uploaded files | May contain anything (exam papers, internal slides). Never stored, but processed in memory and on a tmpfs |
| Identity data | Provider account ID, name, email address |
| Session tokens | A stolen token is a signed-in session |
| Secrets | `AUTH_SECRET`, OAuth client secrets, database passwords, extractor shared secret |
| Availability | Students cramming before an exam need it up |
| Release artifacts | Images and chart that operators run |

## Actors

- **Anonymous internet users**, including automated scanners and botnets.
- **Signed-in users** trying to reach other users' data or abuse resources.
- **Malicious documents**: a file crafted to exploit a parser, exhaust
  resources, or inject content.
- **Compromised dependency or CI component** (supply chain).
- **A network attacker** between browser and app (mitigated by TLS).

Out of scope as attackers: the operator and their cloud provider, who can
read the database by design.

## Trust boundaries

```
 browser --(1: internet, TLS)--> ingress --(2)--> web --(3: internal, shared secret)--> extractor
                                                   |
                                                   +--(4: TLS, runtime role)--> PostgreSQL
 web --(5: OIDC)--> Google / Microsoft
 GitHub Actions --(6: OIDC, signed)--> GHCR --(7: cosign verify)--> operator deploy
```

1. **Browser to ingress:** everything from the browser is untrusted:
   headers, cookies, bodies, file contents, and `X-Forwarded-*`.
2. **Ingress to web:** web trusts only as many `X-Forwarded-For` hops as
   `TRUSTED_PROXY_HOPS` says.
3. **Web to extractor:** the extractor accepts requests only with the shared
   secret, compared in constant time, and only on an internal network
   (compose internal network, Kubernetes NetworkPolicy, Container Apps
   internal ingress). The extractor trusts nothing about the file.
4. **Web to database:** the runtime role can only read and write rows; it
   cannot change the schema.
5. **Identity providers:** trusted to authenticate users, not to link
   accounts (emails are not used as identity).
6. and 7. **Build and release:** see Supply chain.

## Threats and controls

### Broken access control (IDOR)

*Threat:* a signed-in user changes a deck or card ID in a URL, form, or API
call to read, edit, delete, export, study, or upload into another user's
deck.

*Controls:*
- One data-access layer (`web/src/server/data/`) takes the caller's user ID
  as the first argument of every function and filters every query by it,
  including joins from cards to decks.
- ESLint forbids importing the database client anywhere else, and a unit
  test enforces the same rule.
- Another user's ID and a non-existent ID both produce the same 404, so IDs
  cannot be enumerated. IDs are random UUIDs.
- `web/tests/integration/ownership.test.ts` checks each operation against a
  second user; the e2e suite checks it through the browser.

### Authentication and account takeover

*Threat:* an attacker controls an email address at one provider that
matches a victim's email at another, and signs in as the victim.

*Controls:* accounts are keyed by `(provider, provider_account_id)`. The
adapter's lookup by email always returns nothing, so Auth.js never links by
email. A second provider can only be linked while signed in. The test
sign-in provider refuses to load unless `AUTH_TEST_MODE=true` and `AUTH_URL`
is a local address.

### Session token theft

*Threat:* stealing a session cookie through XSS, a network attacker, or a
cross-site request.

*Controls:*
- Database sessions: the cookie is an opaque random token that can be
  revoked by deleting the row (sign out, delete account).
- `HttpOnly`, `SameSite=Lax`, `Secure` and the `__Secure-` prefix over HTTPS,
  30-day rolling expiry.
- XSS defenses below. HSTS at the ingress.
- OAuth access and refresh tokens are not stored, so a database leak does
  not expose provider access.

*Residual risk:* malware on the user's device can read cookies. Sessions are
not bound to a device or IP.

### Cross-site scripting and content injection

*Threat:* card text extracted from a file, or typed by a user, contains
HTML or script.

*Controls:* React renders card text as text; `dangerouslySetInnerHTML` is
banned by lint. CSP with a per-request nonce and `strict-dynamic`, no
`unsafe-inline`, `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'`. CSV export prefixes cells that start with `=`,
`+`, `-`, `@` so spreadsheets do not run them as formulas.

### Cross-site request forgery

*Controls:* `SameSite=Lax` cookies; Auth.js CSRF tokens on its own routes;
Next.js server actions check the origin; the middleware and the upload
route reject state-changing requests whose `Origin` is not the configured
`AUTH_URL`.

### Upload abuse

*Threat:* oversized files, huge numbers of uploads, files that are not what
they claim, or uploads into someone else's deck.

*Controls:* 25 MB limit enforced on `Content-Length` and again while
streaming, in both web and extractor; type from magic bytes, never the file
name or `Content-Type`; per-user limits of 10 per hour and 100 per day,
stored in the database and serialized with an advisory lock so parallel
requests cannot exceed them; a per-IP limit checked before authentication;
target-deck ownership checked before any bytes are forwarded.

### Malicious PDFs and presentations

*Threat:* a file that exploits a bug in PyMuPDF, python-pptx, Pillow, or
Tesseract, or that expands into huge amounts of data (ZIP bombs, images with
enormous dimensions, thousands of pages).

*Controls:*
- Encrypted PDFs, encrypted Office files, legacy `.ppt` (OLE), and
  macro-enabled presentations are rejected outright.
- ZIP checks before parsing: at most 5000 members, 512 MB total uncompressed,
  compression ratio at most 200.
- At most 300 pages or slides. Images capped at 40 megapixels before
  decoding; OCR renders capped at 300 DPI and 40 megapixels.
- Each extraction runs in a separate process with an address-space limit,
  in its own process group, killed with `SIGKILL` after 60 s together with
  any `tesseract` child. The worker's environment does not contain the
  shared secret.
- The extractor container runs as a non-root user with a read-only root
  filesystem, all capabilities dropped, `no-new-privileges`, a memory limit,
  a PID limit, and a size-limited tmpfs. It has no database credentials and
  no outbound network access. A parser compromise therefore yields a
  short-lived process that can read only the file it was given.
- The file is deleted in a `finally` block on every path.

*Residual risk:* a memory-corruption exploit in a native parser could run
code inside the sandbox until the timeout. Keep images updated (Dependabot,
Trivy in CI).

### OCR and processing denial of service

*Threat:* documents designed to make extraction as slow as possible (every
page a scanned image), sent in parallel to tie up the extractor.

*Controls:* the timeout, page cap, and DPI cap bound the cost of one file;
the per-user and per-IP upload limits bound the number of files. The
extractor admits a fixed number of concurrent jobs plus a small queue, and
turns further requests away before reading their bodies. It learns the
average job duration and rejects requests whose estimated wait is too long,
with a `Retry-After` computed from that average. The web app limits
in-flight uploads per replica and puts a circuit breaker in front of the
extractor so a struggling extractor is given time to recover instead of
more work. Autoscaling (Container Apps, or an HPA you add) adds replicas.

### Request floods and slow clients (application layer)

*Threat:* floods of HTTP requests, credential-less hammering of sign-in or
upload endpoints, and slowloris-style connections that send headers or
bodies very slowly.

*Controls:*
- Per-IP token-bucket limits in the web app for reads, writes, and uploads,
  answered with `429` and `Retry-After`. When total traffic to a replica
  rises above a threshold, every client's refill rate drops to a quarter,
  so a distributed flood is throttled harder than normal use. A client that
  keeps retrying while blocked has its block doubled each time, up to 60 s.
  The limiter keeps at most 20,000 clients in memory.
- The client IP is taken from `X-Forwarded-For` only as far as the trusted
  proxy hop count, so attackers cannot spoof another address to dodge
  limits or get someone else blocked.
- The health endpoint is exempt so the platform does not restart healthy
  replicas under load.
- Extractor: at most 64 open connections per replica, 5 s keep-alive, 30 s
  deadline for the whole body.
- `web/scripts/loadtest.mjs` checks these behaviors in CI.

*Residual risk:* limits are per replica and held in memory, so the effective
limit scales with the replica count and resets on restart. Users behind one
NAT address share limits; tune with `RATE_LIMIT_SCALE`.

### Network-layer floods and malformed packets

*Threat:* volumetric DDoS (SYN floods, UDP amplification) and malformed
packet attacks such as the "ping of death" (oversized, fragmented ICMP
packets that crashed 1990s network stacks).

*Controls and division of responsibility:* these attacks target the network
and the kernel, not the application, and are handled below it. The ping of
death was fixed in operating system kernels in the late 1990s and does not
affect current Linux kernels. In the reference deployments, only HTTPS
reaches the app: Azure Container Apps and Kubernetes ingress controllers
terminate TCP and TLS at a managed proxy, and ICMP is never forwarded to the
containers. Azure applies its always-on infrastructure DDoS protection to
public endpoints. Operators who need more can put Azure Front Door with WAF
rate-limit rules, Azure DDoS Network Protection, or another CDN/WAF in front;
those are deployment choices, not part of this repository.

### Server-side request forgery

*Threat:* making the server fetch an attacker-chosen URL.

*Controls:* no feature fetches user-supplied URLs. The extractor never
follows links or loads external resources from documents (PyMuPDF and
python-pptx read the file only), and it has no outbound network route
(compose internal network, Kubernetes egress policy allowing only DNS). Web
talks only to the configured extractor URL, the database, and the two
identity providers, with redirects disabled for extractor calls.

### Secrets exposure

*Controls:* no secrets in either repository: gitleaks runs as a pre-commit
hook and in CI over full history, and GitHub push protection should be on.
Only `.env.example` with placeholders is committed. The Helm chart references
existing Kubernetes Secrets by name; the Azure reference reads every secret
from Key Vault through managed identities. Logs drop emails, names, file
names, card content, and tokens. The extractor's worker process does not
receive the shared secret.

### SQL injection

*Controls:* Drizzle builds parameterized queries; no SQL is assembled from
strings. Zod validates every input with maximum lengths. The runtime role
cannot run DDL, which limits what an injection could do.

### Supply chain

*Threat:* a compromised dependency, base image, or GitHub Action; a tampered
image in the registry.

*Controls:* lockfiles and pinned Python requirements; base images pinned by
digest; every GitHub Action pinned to a full commit SHA; Dependabot weekly
for npm, pip, Docker, and Actions; `npm audit` and Trivy (HIGH/CRITICAL) in
CI; CodeQL. Release workflow permissions are limited to `contents: read`,
`packages: write`, and `id-token: write`. Images are signed with cosign
keyless signing bound to this repository's release workflow and carry SBOM
and SLSA provenance attestations; operators should run `cosign verify`
before every deploy. Workflows from forks get no secrets.

### Data remanence and privacy

*Controls:* uploaded files are not stored; account deletion removes all rows
for the user in one transaction; cards are exported only to their owner.

## Not covered

- **Compromised user devices or browsers** (malware, malicious extensions).
- **Compromised identity provider accounts.** Quiz.me relies on Google and
  Microsoft for multi-factor authentication and account recovery.
- **The operator.** Operators can read all data in the database. There is
  no end-to-end or per-user encryption.
- **Encryption at rest** is the database platform's responsibility (Azure
  PostgreSQL Flexible Server encrypts storage by default).
- **Volumetric network DDoS** beyond what the hosting platform provides.
- **Distributed rate limiting.** Limits are per replica and in memory.
- **Account enumeration via identity providers** and phishing of users.
- **Content moderation.** Decks are private, so there is no review of what
  users upload.
- **Backups and disaster recovery**, which depend on the deployment.
- **Side channels** inside shared cloud hardware.
- **A full sandbox for parsers.** The extractor's isolation is container
  hardening plus process limits, not gVisor, Firecracker, or seccomp
  profiles beyond the runtime default.
