# Reference deployment: Azure Container Apps

Reference Bicep for running Quiz.me on Azure Container Apps. It is
documentation: this repository never runs it, and every name, domain, and ID
is a parameter or a `<placeholder>`. Copy this folder into your own private
deployment repository and follow [docs/deploy.md](../../docs/deploy.md).

| File | Creates |
|------|---------|
| `main.bicep` | Everything below, wired together. `bootstrap=true` creates only the foundation. |
| `modules/monitoring.bicep` | Log Analytics workspace, 30-day retention |
| `modules/network.bicep` | VNet with a Container Apps subnet (Key Vault service endpoint) and a PostgreSQL-delegated subnet, private DNS zone |
| `modules/identity.bicep` | User-assigned managed identity (one for web, one for the extractor) |
| `modules/keyvault.bicep` | Key Vault in RBAC mode, purge protection, soft delete, firewall that allows only the Container Apps subnet, audit logs to Log Analytics |
| `modules/registry.bicep` | Optional ACR (admin user off) with AcrPull for both identities |
| `modules/environment.bicep` | VNet-integrated Container Apps environment, Consumption profile |
| `modules/postgres.bicep` | PostgreSQL 16 Flexible Server B1ms, private access only, TLS required (1.2+), `quizme` database |
| `modules/apps.bicep` | `web` (external HTTPS, 0 to 3 replicas) and `extractor` (internal ingress, 0 to 3 replicas, 1 vCPU / 2 GiB), secrets as Key Vault references |
| `modules/alerts.bicep` | Action group, alerts on web 5xx responses and extractor restarts |

## Commands

```sh
RG=<your-resource-group>

# 1. Foundation only.
az deployment group create -g "$RG" -f main.bicep -p main.example.bicepparam -p bootstrap=true

# 2. Seed Key Vault secrets (see docs/deploy.md for the list).

# 3. Database and apps.
az deployment group create -g "$RG" -f main.bicep -p main.example.bicepparam

# 4. Create the database roles (docs/data-model.md), then roll the web app.

# Day-2 image updates: verify the signature, then point the apps at the sha tag.
az containerapp update -g "$RG" -n quizme-<env>-extractor --image ghcr.io/limequizz/quizme-extractor:<git-sha>
az containerapp update -g "$RG" -n quizme-<env>-web --image ghcr.io/limequizz/quizme-web:<git-sha>
```

Validate locally with `bicep lint main.bicep` and `bicep build main.bicep`.

## Differences from the Helm chart

Container Apps does not offer a read-only root filesystem or tmpfs volumes.
The extractor's scratch directory is an `EmptyDir` volume local to the
replica; files are still deleted in a `finally` block after every
extraction. Container Apps also has no NetworkPolicy; the extractor is
isolated by internal-only ingress and the shared secret instead.
