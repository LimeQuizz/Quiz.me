# Deploying Quiz.me

This repository publishes signed container images and a Helm chart. It never
deploys anything. Operators keep their deployment configuration (resource
names, hostnames, identity IDs) in their own private repository.

Everything below uses placeholders such as `<your-domain>`,
`<your-tenant-id>`, `<your-subscription-id>`, and `<your-org>`.

## What gets published

| Artifact | Location | Tags |
|----------|----------|------|
| Web image | `ghcr.io/limequizz/quizme-web` | full git sha on every push to `main`, `latest` on `main`, `X.Y.Z` / `X.Y` on `vX.Y.Z` tags |
| Extractor image | `ghcr.io/limequizz/quizme-extractor` | same |
| Helm chart | `oci://ghcr.io/limequizz/charts/quizme` | chart version on `vX.Y.Z` tags |

Each image is signed with cosign keyless signing (GitHub OIDC, Fulcio, Rekor)
and carries two signed attestations: an SPDX SBOM produced by syft and a SLSA
provenance predicate. Deploy by git sha tag or digest, never by `latest`.

## Verify before deploying

```sh
IMAGE=ghcr.io/limequizz/quizme-web:<git-sha>
cosign verify "$IMAGE" \
  --certificate-identity-regexp '^https://github.com/LimeQuizz/Quiz\.me/\.github/workflows/release\.yml@refs/(heads/main|tags/v.*)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# Optional: check the SBOM and provenance attestations too.
cosign verify-attestation "$IMAGE" --type spdxjson \
  --certificate-identity-regexp '^https://github.com/LimeQuizz/Quiz\.me/\.github/workflows/release\.yml@refs/(heads/main|tags/v.*)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com > /dev/null
```

A deploy pipeline should fail closed if verification fails.

## Sign-in providers

You need one OAuth client per provider per environment.

**Google** ([Google Cloud console, Credentials](https://console.cloud.google.com/apis/credentials)):
create an OAuth client ID of type "Web application".

- Authorized JavaScript origin: `https://<your-domain>`
- Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`
- OAuth consent screen scopes: `openid`, `email`, `profile`.

**Microsoft** ([Microsoft Entra admin center, App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)):
register an application.

- Supported account types: **Accounts in any organizational directory (Any
  Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts
  (e.g. Skype, Xbox)**. Quiz.me uses the `common` endpoint, so users with a
  personal Outlook/Hotmail account and users with a work or school account
  can both sign in.
- Platform: Web. Redirect URI:
  `https://<your-domain>/api/auth/callback/microsoft-entra-id`
- Certificates & secrets: create a client secret and store it in your secret
  store immediately; it is shown only once.
- API permissions: the default `User.Read` delegated permission can be
  removed. Quiz.me only requests `openid profile email` and never calls
  Microsoft Graph.
- Leave `AUTH_MICROSOFT_ENTRA_ID_ISSUER` unset to use
  `https://login.microsoftonline.com/common/v2.0`. Set it to
  `https://login.microsoftonline.com/<your-tenant-id>/v2.0` only if you want
  to restrict sign-in to one organization.

## Runtime configuration

| Variable | Secret | Notes |
|----------|--------|-------|
| `AUTH_URL` | no | Public URL, `https://<your-domain>` |
| `AUTH_SECRET` | yes | 32+ random bytes, base64 (`openssl rand -base64 32`) |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | yes | Google OAuth client |
| `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` | yes | Microsoft app registration |
| `DATABASE_URL` | yes | `quizme_app` role, `sslmode=require` |
| `MIGRATION_DATABASE_URL` | yes | `quizme_migrator` role, used only at container start |
| `EXTRACTOR_URL` | no | Internal URL of the extractor |
| `EXTRACTOR_SHARED_SECRET` | yes | Same value in web and extractor, 32+ characters |
| `AUTH_TEST_MODE` | no | Must be unset or `false` in every real deployment. The app refuses to start with it unless `AUTH_URL` points at localhost or the compose service name `web`. |

Create the database roles once per database with
[`web/db/roles.sql`](../web/db/roles.sql) (see
[data-model.md](data-model.md#database-roles)). Migrations run when the web
container starts, as `quizme_migrator`.

## HSTS and TLS

The app sends HSTS only when it sees an https request, and TLS is terminated
before traffic reaches it. Set HSTS at your ingress or load balancer as well:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
```

Add `preload` only once you are sure every subdomain serves HTTPS.

## Option A: Helm

```sh
kubectl create namespace quizme
kubectl -n quizme create secret generic quizme-db \
  --from-literal=DATABASE_URL='<runtime-url>' \
  --from-literal=MIGRATION_DATABASE_URL='<migration-url>'
# ...one Secret per entry under `secrets:` in values.yaml, or sync them from
# your vault with the External Secrets Operator or the CSI driver.

helm install quizme oci://ghcr.io/limequizz/charts/quizme --version <chart-version> \
  -n quizme -f my-values.yaml
```

The chart never renders secret values; it only references existing Secrets
by name. It ships NetworkPolicies (extractor ingress only from web, extractor
egress limited to DNS), non-root read-only pods with all capabilities
dropped, and resource limits. Run `helm test quizme -n quizme` after install.

## Option B: Azure Container Apps

[`deploy/azure-container-apps/`](../deploy/azure-container-apps/) contains
reference Bicep: a VNet-integrated Container Apps environment, the web app
(external HTTPS), the extractor (internal ingress only), PostgreSQL Flexible
Server B1ms with private access, Key Vault with managed identities, Log
Analytics, and alerts. Every name is a parameter.

### Private deployment repository

Keep a separate private repository (for example `<your-org>/<your-deploy-repo>`)
holding:

- a copy of the Bicep plus one `.bicepparam` file per environment;
- a deploy workflow (`workflow_dispatch` with an `image_tag` input);
- no secrets. Runtime secrets live in Key Vault; the workflow authenticates
  with OIDC.

### GitHub Environments

In the private repository create one GitHub Environment per stage
(`staging`, `qa`, `prod`). Under each one:

- **Required reviewers** for `qa` and `prod`, so a person approves each
  promotion.
- **Deployment branches**: `main` only.
- Variables (not secrets; these are identifiers):
  `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_CLIENT_ID`.

### OIDC federated credentials

Create an Entra application (or user-assigned identity) for the deploy
workflow and add one federated credential per GitHub Environment:

```sh
APP_ID=$(az ad app create --display-name quizme-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
for ENV in staging qa prod; do
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"github-$ENV\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:<your-org>/<your-deploy-repo>:environment:$ENV\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"
done
# Contributor on each environment's resource group only, never the subscription.
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope /subscriptions/<your-subscription-id>/resourceGroups/<your-resource-group>
```

The subject pins tokens to one repository and one environment, so a workflow
in any other repository, or a job without the environment, cannot get a
token.

### First deployment

```sh
RG=<your-resource-group>
az deployment group create -g "$RG" -f main.bicep -p <env>.bicepparam -p bootstrap=true
```

Seed Key Vault. The vault firewall only admits the Container Apps subnet, so
add your IP for the duration:

```sh
KV=<your-keyvault-name>
MYIP=$(curl -fsS https://api.ipify.org)
az keyvault network-rule add -n "$KV" --ip-address "$MYIP/32"
# az keyvault role assignment for yourself: "Key Vault Secrets Officer"
az keyvault secret set --vault-name "$KV" -n auth-secret --file <(openssl rand -base64 32 | tr -d '\n') >/dev/null
# ...repeat for: postgres-admin-password, google-client-id, google-client-secret,
# microsoft-client-id, microsoft-client-secret, extractor-shared-secret,
# database-url, migration-database-url
az keyvault network-rule remove -n "$KV" --ip-address "$MYIP/32"
```

Use `--file` with process substitution (or a prompt that does not echo)
rather than `--value`, so secrets do not land in shell history.

Then deploy the database and apps, create the database roles from inside the
VNet (for example with a one-off Container Apps job running `psql` with
`web/db/roles.sql`), and restart the web revision.

### Updating the image

```sh
TAG=<git-sha>
cosign verify ghcr.io/limequizz/quizme-web:$TAG ...        # as above
cosign verify ghcr.io/limequizz/quizme-extractor:$TAG ...
az containerapp update -g <your-resource-group> -n quizme-<env>-extractor \
  --image ghcr.io/limequizz/quizme-extractor:$TAG
az containerapp update -g <your-resource-group> -n quizme-<env>-web \
  --image ghcr.io/limequizz/quizme-web:$TAG
```

Update the extractor first: the extractor API is backward compatible within a
major version. Roll back by running the same commands with the previous tag.

### Production safeguards

- Put a `CanNotDelete` resource lock on the production resource group (or at
  least on PostgreSQL and Key Vault).
- Key Vault purge protection is on; a deleted vault stays recoverable for 90
  days.
- PostgreSQL keeps 7 days of point-in-time backups by default; raise
  `backupRetentionDays` if you need more.

## Automating deploys from releases

`release.yml` can send a `repository_dispatch` event to your deploy
repository after images are published. It is off by default. To turn it on,
set the repository variable `DEPLOY_DISPATCH_REPO` (`<your-org>/<your-deploy-repo>`)
and the secret `DEPLOY_DISPATCH_TOKEN`: a fine-grained personal access token
scoped to that one repository with "Contents: read and write" (required by the
dispatch API), stored only in this repository's Actions secrets. A fork
running the workflow has neither, so the job is skipped.
