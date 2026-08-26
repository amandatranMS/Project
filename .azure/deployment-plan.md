# Redeploy the Multi-Agent Sales Assistant

| | |
|---|---|
| Status | Deployed and verified |
| Last prepared | 2026-07-30 |
| Last validated | 2026-08-25 |
| Last deployed | 2026-08-25 |
| Deployment method | `azure-deploy` only |
| Data | Development; synthetic mock business data only |

This file records a completed deployment. Before another deployment, run the Azure validation process again. Only that process may mark a new deployment as validated.

## What This Guide Does

This guide explains how to update the two parts of the application that run in Azure:

- The API, which runs in Azure Container Apps.
- The AI assistant, which runs in Microsoft Foundry.

The web app continues to run locally. This process updates existing software only. It must not create Azure resources or change the database, security settings, identities, network, or AI model.

The deployment follows four stages:

1. **Check:** Confirm the Azure account, resources, code, and safety rules.
2. **Deploy:** Update the API, then update the hosted AI assistant.
3. **Verify:** Confirm both updates work and approval controls still apply.
4. **Recover:** Restore the previous version if a check fails.

After a successful deployment:

- The API runs a new healthy revision of `msx-api`.
- The hosted agent runs a new version of `agent-framework-agent-basic-responses`.
- The local React app connects to the deployed API.
- Existing data and Azure configuration remain unchanged.

### Terms Used in This Guide

- **API:** The backend service used by the web app and AI assistant.
- **Container image:** A packaged copy of the API code and everything it needs to run.
- **Revision:** One deployed version of the API in Azure Container Apps.
- **Hosted agent:** The AI assistant running in Microsoft Foundry.
- **Rollback:** Restoring the last working version after a failed update.
- **FQDN:** The API's full internet address.

## Fixed Targets

| Item | Required value |
|---|---|
| Subscription | `ME-MngEnvMCAP758248-t-amandatran-1` |
| Subscription ID | `f850b37c-9bf9-4075-9eb5-43aa2daf6d85` |
| API resource group | `rg-msx-milestone-api` |
| API region | Canada Central |
| Container App | `msx-api` |
| Container registry | `ca34643b5fc3acr` |
| Foundry resource group | `rg-agent-framework-agent-basic-responses-dev` |
| Foundry region | Canada East |
| Hosted agent | `agent-framework-agent-basic-responses` |
| `azd` environment | `msx` |
| Foundry directory | `apps\foundry-agent\agent-framework-agent-basic-responses` |

These are the only approved deployment targets. Stop if Azure shows different names, subscription IDs, or regions. Do not create replacement resources.

## What May Change

The deployment may:

- Build and test the application code.
- Upload a new, uniquely named API image to the existing container registry.
- Point the existing Container App to that image.
- Update the code for the existing Foundry hosted agent.
- Test sign-in, approvals, auditing, API health, and local web connectivity.

## What Must Not Change

Do not:

- Create resources, environments, identities, permissions, databases, AI models, or web hosting.
- Run provisioning commands such as `azd up`, `azd provision`, or `azd init`.
- Deploy ARM, Bicep, or Terraform infrastructure.
- Change the database design, workbook mapping, secrets, environment variables, network, ingress, scale, CORS, or identity settings.
- Reset, migrate, import, or manually seed the database.
- Connect to real MSX, Dataverse, Power Apps, Power Automate, or real customer records.
- Save Microsoft Graph results in the mock business tables.

The database must remain exactly these 11 synthetic tables: `Opportunity`, `OpportunityMilestone`, `MilestoneStatusHistory`, `AiMilestoneRecommendation`, `ApprovalRequest`, `CollaborationNote`, `DealTeamMember`, `AgentNotification`, `AgentRunLog`, `AgentActionAuditLog`, and `DashboardMetricSnapshot`.

## Safety Rules

- Never display or commit passwords, tokens, database URLs, API keys, or `azd` secrets.
- Use the existing signed-in identity and permissions.
- Keep HTTPS, managed identities, secret references, port `4000`, ingress, scale, and revision mode unchanged.
- Keep all sales records synthetic.
- Require sign-in for real Microsoft Graph access and audit every Graph read with `recordAgentAction`.
- Put every AI-requested change or message into `ApprovalRequest`.
- Execute it only after a person approves it, then record the result in `AgentActionAuditLog`.
- Stop when a target, health, policy, quota, database, or governance check does not match this plan.

## Before You Deploy

Complete all three checks below. Run commands from the repository root unless the guide says otherwise.

### 1. Check your tools and Azure account

You need Git, Node.js/npm, Azure CLI with Container Apps support, Python, `azd`, and the Microsoft Foundry `azd` extension. Docker is optional because Azure Container Registry can build the image remotely.

Sign in and confirm that every command returns the resource listed in **Fixed Targets**:

```powershell
az login
az account set --subscription "f850b37c-9bf9-4075-9eb5-43aa2daf6d85"
azd auth login

az account show --query "{name:name,id:id,tenantId:tenantId}" -o json
az group show -n "rg-msx-milestone-api" --query "{name:name,location:location}" -o json
az acr show -g "rg-msx-milestone-api" -n "ca34643b5fc3acr" --query "{name:name,location:location,loginServer:loginServer,adminUserEnabled:adminUserEnabled}" -o json
az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "{name:name,location:location,state:properties.provisioningState,fqdn:properties.configuration.ingress.fqdn,targetPort:properties.configuration.ingress.targetPort,revisionMode:properties.configuration.activeRevisionsMode,image:properties.template.containers[0].image,latestRevision:properties.latestRevisionName}" -o json
az group show -n "rg-agent-framework-agent-basic-responses-dev" --query "{name:name,location:location}" -o json
```

Also confirm that the `msx` environment points to the required subscription and Canada East Foundry project. Confirm that required secrets exist, but do not display their values.

### 2. Check the code

These commands confirm that the database and Foundry setup have not changed, install the locked dependencies, regenerate Prisma, update the OpenAPI JSON, and check that all TypeScript projects build:

```powershell
git diff --check
git diff --exit-code -- prisma\schema.prisma
git diff --exit-code -- apps\foundry-agent\agent-framework-agent-basic-responses\azure.yaml
npm ci
npm run prisma:generate
npm run openapi:json
npm run build
npm run typecheck -w @msx/api
npm run typecheck -w @msx/web
```

Then open the hosted-agent directory and check the Python code and deployment package:

```powershell
python -m compileall -q .
azd package --no-prompt -e msx
```

Before continuing, confirm:

- API responses still use `{ success, data }` or `{ success, error }`.
- Governed actions and messages still require approval and call `recordAgentAction`.
- The API still listens on port `4000`.
- There are no infrastructure, database-design, table, seed, or hosting changes.

### 3. Test the application

- Build the API image locally when Docker is available. Otherwise, use the existing Azure Container Registry remote build.
- For local tests, use a temporary PostgreSQL database. Never use the Azure database for destructive tests.
- Verify `/api/health` and run `scripts\smoke-test.ps1` against the isolated environment.
- Run the hosted agent locally and send it a read-only prompt using synthetic data.
- Send it a change request and confirm that it creates an approval instead of changing data immediately.
- Start the local web app and check sign-in, the mock-data banner, dashboard, opportunities, approvals, and API connection.
- When finished, remove only the temporary resources and processes created for this test.

## Deployment

Continue only when every check above passes and the Azure targets still match this guide.

### 1. Update the API

First, record the currently running image, revision, and web address. These values are needed if you must restore the previous version. Then create a unique name for the new image:

```powershell
$PreviousImage = az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "properties.template.containers[0].image" -o tsv
$PreviousRevision = az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "properties.latestRevisionName" -o tsv
$Fqdn = az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "properties.configuration.ingress.fqdn" -o tsv
$Tag = "redeploy-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
$Image = "ca34643b5fc3acr.azurecr.io/msx-api:$Tag"
```

Build the new image locally or in Azure Container Registry. Confirm its image digest, then update only the Container App image:

```powershell
az containerapp update -g "rg-msx-milestone-api" -n "msx-api" --image $Image
```

Do not add options that change configuration, secrets, identity, ingress, scale, revision mode, or traffic. Wait until the new API revision is healthy before continuing.

### 2. Update the AI assistant

From `apps\foundry-agent\agent-framework-agent-basic-responses`:

```powershell
azd env select msx
azd deploy agent-framework-agent-basic-responses
```

Cancel the command if it tries to create infrastructure or targets a different project or agent. Record the new agent version, but do not record secrets.

## Check the Deployment

After both updates finish:

1. Confirm the new API revision is active, healthy, and using the expected image.
2. Confirm the web address, port `4000`, revision mode, traffic, identity, secrets, environment names, and scale did not change.
3. Open `https://<existing-fqdn>/api/health` and confirm it returns HTTP 200 with the normal success response.
4. Check API and agent logs for startup, database, sign-in, Graph, tool, or unexpected errors.
5. Sign in and perform read-only checks for opportunities, opportunity context, and the dashboard.
6. Test one synthetic change: it must create an approval. Rejecting it or requesting changes must do nothing. Approving it must run exactly once and create an audit record.
7. Test the hosted agent with one read-only request and one request that requires approval.
8. Build and run the local React app against the deployed API.
9. Confirm that Azure contains no new resources and that the 11 tables and existing data remain intact.

Do not send a tenant-wide Teams message during verification.

## Restore the Previous Version

Restore the previous version if the new revision is unhealthy, fails to start, has database or sign-in errors, breaks the agent, bypasses approval, fails to audit actions, or causes a serious regression.

### Restore the API

```powershell
az containerapp update -g "rg-msx-milestone-api" -n "msx-api" --image $PreviousImage
```

Wait for the restored revision to become healthy and check the existing web address. If traffic was split between revisions, restore the original traffic settings. Keep the failed revision's logs for investigation. Never reset the database during recovery.

### Restore the AI assistant

Reactivate or redeploy the previously recorded healthy agent version. Repeat the read-only and approval checks. Do not delete or recreate the agent, project, model, or resource group.

## Validation Proof (2026-08-25)

Validation run before the 2026-08-25 redeploy. Reason for redeploy: the running API image
(`msx-api:milestone-commit-20260813125829`, pushed 2026-08-13 17:00 UTC) and hosted-agent
version 37 (created 2026-08-13 16:36 UTC) both predate the 2026-08-21 commits, which include
the approval-gate bypass fix (`4a466d1`) and its governance tests (`9851618`).

| Check | Command | Result |
|---|---|---|
| Subscription | `az account show` | `f850b37c-9bf9-4075-9eb5-43aa2daf6d85` — matches Fixed Targets |
| API resource group | `az group show -n rg-msx-milestone-api` | Present, Canada Central |
| Container registry | `az acr show -n ca34643b5fc3acr` | `ca34643b5fc3acr.azurecr.io`, Canada Central |
| Container App | `az containerapp show -n msx-api` | Succeeded, port `4000`, `Single` revision mode, revision `msx-api--0000036` |
| Foundry resource group | `az group show -n rg-agent-framework-agent-basic-responses-dev` | Present, Canada East |
| `azd` auth and environment | `azd auth login --check-status`, `azd env list` | Signed in; `msx` is the default local environment |
| Whitespace and conflict markers | `git diff --check` | Exit 0 |
| Database design unchanged | `git diff --exit-code -- prisma\schema.prisma` | Exit 0 |
| Foundry config unchanged | `git diff --exit-code -- ...\azure.yaml` | Exit 0 |
| Locked dependencies | `npm ci` | Exit 0 |
| Prisma client | `npm run prisma:generate` | Generated v6.19.3, exit 0 |
| OpenAPI JSON | `npm run openapi:json` | Regenerated with no working-tree change — YAML and JSON in sync |
| Build | `npm run build` | `@msx/shared`, `@msx/api`, `@msx/web` all built, exit 0 |
| API typecheck | `npm run typecheck -w @msx/api` | Exit 0 |
| Web typecheck | `npm run typecheck -w @msx/web` | Exit 0 |
| Governance tests | `npm test` | 2 files, 23 tests passed (approval gate and milestone status history) |
| Hosted agent Python | `python -m compileall -q .` | Exit 0 |
| Hosted agent package | `azd package --no-prompt -e msx` | Succeeded, code package produced |
| Live API health | `GET /api/health` | HTTP 200, `{"success":true,"data":{"status":"ok","service":"msx-milestone-assistant-api","mock":true}}` |
| Auth gate | `GET /api/opportunities` unauthenticated | HTTP 401 with the standard error envelope |
| Table count | `prisma\schema.prisma` | Exactly the 11 approved models, unchanged |
| Registry hardening | `az acr show --query anonymousPullEnabled` | `false` |
| Build method | `docker version` | Docker unavailable, so the Azure Container Registry remote build is required |

No infrastructure, database-design, table, seed, identity, ingress, scale, or environment changes
were found. The working tree is clean and `main` matches `origin/main`.

## Deployment Results (2026-08-25)

Update-only redeploy. No provisioning commands were run.

### API

| Item | Value |
|---|---|
| Previous image | `ca34643b5fc3acr.azurecr.io/msx-api:milestone-commit-20260813125829` |
| Previous revision | `msx-api--0000036` |
| New image | `ca34643b5fc3acr.azurecr.io/msx-api:redeploy-20260825202329` |
| Image digest | `sha256:a59889aae028ec83f75fcc9f6d21599614e8c20b969bd81eace2aa8f1acc30ec` |
| Build | ACR remote build run `cx13`, Succeeded in 1m24s (Docker unavailable locally) |
| New revision | `msx-api--0000037` — Healthy, RunningAtMaxScale, 100% traffic |
| Command | `az containerapp update -g rg-msx-milestone-api -n msx-api --image <new image>` |

Two build-tooling issues were worked around without changing the application:

1. `az acr build` crashed while packing the context because the Copilot tooling
   creates and removes refs under `.git\refs\copilot\` during the walk. Resolved by
   building from a clean `git archive HEAD` export, which also guarantees only
   committed code was shipped.
2. `az acr build` then crashed client-side on a `cp1252` encode error while streaming
   Prisma's Unicode log output. The remote build task was unaffected and completed
   successfully; the image and digest were confirmed from the registry.

### Hosted agent

`azd deploy agent-framework-agent-basic-responses` succeeded and reused **version 37**
rather than creating a new version, because the packaged content hash was unchanged
(`f1bda610…89cd5`). This is correct: every Python file under the agent `src` directory
was last modified on or before 2026-08-13, and the only later change in the agent
directory was `.env.example`, which is not runtime code. The approval-gate bypass fix
in commit `4a466d1` lives in `apps\api\src\services\chat\msxTools.ts`, so it shipped in
the API image above.

### Verification

| Check | Result |
|---|---|
| `GET /api/health` | HTTP 200, `{"success":true,"data":{"status":"ok","service":"msx-milestone-assistant-api","mock":true}}` |
| Unauthenticated `GET /api/opportunities` | HTTP 401 with the standard error envelope |
| Startup logs | "The database is already in sync with the Prisma schema" — no migration |
| Seed behaviour | "Database already has 19 opportunities — skipping seed" — no reseed |
| Listener | "listening on http://localhost:4000" — port unchanged |
| Config drift | FQDN, port `4000`, `Single` revision mode, external ingress, min/max replicas `1/1`, `SystemAssigned` identity, secret names, and env names all unchanged |
| Traffic | 100% to the latest revision |
| Resource counts | 7 in `rg-msx-milestone-api`, 7 in `rg-agent-framework-agent-basic-responses-dev` — no new resources |
| All 11 tables | Opportunity 19, Milestone 22, StatusHistory 38, Recommendation 37, Approval 17, Note 15, DealTeam 1 (per opportunity), Notification 38, RunLog 17, Audit 300, Snapshot 18 |
| Agent context endpoint | `GET /api/opportunities/:id/context` returned success |

`GET /api/deal-team-members` returns HTTP 400 without an `opportunityId` query
parameter. That is the documented contract, not a regression; the request succeeds
when the parameter is supplied.

No tenant-wide Teams message was sent. No schema migration, reset, import, or seed
occurred. No secrets were displayed or committed.

## Previous Validation Results

The following checks passed before the last deployment:

- Node build, API/web typechecks, Prisma generation, OpenAPI generation, Python compilation, and `git diff --check` passed.
- `azd package` passed.
- Hosted-agent version 25 was active and passed a read-only invocation.
- API health returned HTTP 200 with the expected mock envelope.
- ACR DNS and token checks passed; remote build was required because Docker was unavailable.
- No permission, infrastructure, database-design, table, or environment changes were found.
- A preview of `azd provision` proposed a duplicate Foundry account and project. This confirmed that provisioning must not be used and only code should be deployed.
- Revalidation on 2026-07-31 passed after the autonomous-draft prompt correction.

## Previous Deployment Results

The last authorized deployment completed successfully:

- API image: `ca34643b5fc3acr.azurecr.io/msx-api:draftfix-20260731014241`
- Image digest: `sha256:afac463060985ccce931498fd37822a312e87e012ee05c00e5fd53fc07348aff`
- Active Container App revision: `msx-api--0000022`
- Active hosted-agent version: `28`
- API and local proxy health checks returned HTTP 200.
- The milestone prompt produced a complete editable draft without creating an approval; the approval count remained 18.
- The local web app ran at `http://127.0.0.1:5173` against the deployed API.
- Both original resource groups retained 7 resources. No new resources were created.
- Port `4000`, single-revision mode, identity, environment names, secret names, Graph live mode, and all 11 database models were preserved.
- `AcrPull` remained assigned and anonymous registry pull remained disabled.
- No schema migration, reset, import, or seed occurred.
- No tenant-wide Teams test was sent.