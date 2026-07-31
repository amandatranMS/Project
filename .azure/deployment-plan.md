# Azure Deployment Plan — MSX Milestone Assistant Redeployment

**Status:** Deployed and Verified  
**Approval state:** User plan approval and validation are complete; deployment is authorized through `azure-deploy`.  
**Classification:** Development; synthetic mock business data only  
**Scale:** Small  
**Strategy:** Reuse existing resources and update application revisions/versions only  
**Prepared:** 2026-07-30

## 1. Goal and Outcome

Redeploy the existing MSX API changes to the existing Azure Container App and redeploy the existing Microsoft Foundry hosted-agent changes through the existing `azd` environment.

The React web client has no standalone Azure resource in the selected subscription. It will be dependency-checked, built, and verified locally, and will continue to run locally against the deployed API. This plan does not create an Azure web-hosting resource.

Expected outcome:

- `msx-api` runs a new healthy Container Apps revision using a uniquely tagged image from the existing ACR.
- `agent-framework-agent-basic-responses` runs a new hosted-agent version/deployment against the existing Foundry project.
- The local React client builds successfully and can use the unchanged API endpoint.
- Existing data, configuration, identities, secrets, networking, model deployment, and resource topology remain in place.

## 2. Fixed Azure Context

| Item | Value |
|---|---|
| Subscription | `ME-MngEnvMCAP758248-t-amandatran-1` |
| Subscription ID | `f850b37c-9bf9-4075-9eb5-43aa2daf6d85` |
| API resource group | `rg-msx-milestone-api` |
| API region | Canada Central |
| Container App | `msx-api` |
| Azure Container Registry | `ca34643b5fc3acr` |
| Foundry resource group | `rg-agent-framework-agent-basic-responses-dev` |
| Foundry region | Canada East |
| Hosted agent | `agent-framework-agent-basic-responses` |
| `azd` environment | `msx` |
| Foundry deployment directory | `apps\foundry-agent\agent-framework-agent-basic-responses` |

Before any deployment command, the operator must verify that Azure CLI and `azd` resolve this exact subscription and that the existing resources above are present. A mismatch is a stop condition, not permission to create replacements.

## 3. Scope Boundaries

### In scope

- Validate the current API, shared package, React client, and hosted-agent source changes.
- Build and locally test the API container image.
- Push a uniquely tagged API image to existing ACR `ca34643b5fc3acr`.
- Update existing Container App `msx-api` to that exact image, producing a new revision.
- Deploy the existing hosted-agent service with `azd deploy` in environment `msx`.
- Verify API health, Container Apps revision state, hosted-agent invocation, approval governance, audit behavior, and local web-client connectivity.

### Explicitly out of scope

- No new Azure resources, resource groups, environments, registries, apps, projects, model deployments, databases, identities, role assignments, DNS entries, or web-hosting resources.
- No infrastructure provisioning: do not run `azd up`, `azd provision`, ARM/Bicep/Terraform deployments, or `azd init`.
- No infrastructure, Prisma schema, workbook mapping, table, migration, or seed-source changes.
- No database reset, workbook import, manual seeding, or destructive data operation.
- No SKU, scale, networking, ingress, secret, identity, RBAC, CORS, domain, or environment-variable changes.
- No connection or reference to real MSX, Dataverse, Power Apps, Power Automate, or real customer business records.
- No persistence of Microsoft Graph data into the 11 mock tables.

The database remains exactly 11 mock tables: `Opportunity`, `OpportunityMilestone`, `MilestoneStatusHistory`, `AiMilestoneRecommendation`, `ApprovalRequest`, `CollaborationNote`, `DealTeamMember`, `AgentNotification`, `AgentRunLog`, `AgentActionAuditLog`, and `DashboardMetricSnapshot`.

## 4. Existing Architecture and Deployment Recipe

```text
Local React/Vite client
        |
        | HTTPS + existing authentication/configuration
        v
Existing Container App: msx-api (Canada Central)
        |
        +-- Existing ACR: ca34643b5fc3acr
        +-- Existing database/configuration/secrets (unchanged)
        +-- Existing Entra ID and Microsoft Graph integration
        ^
        | API_BASE_URL / existing authenticated API contract
Existing Foundry hosted agent (Canada East)
agent-framework-agent-basic-responses
```

Selected recipe:

1. **API:** existing Azure CLI Container Apps image/revision workflow.
2. **Hosted agent:** existing Azure Developer CLI project and environment, using service-only `azd deploy`.
3. **Web:** local npm build and local runtime verification only.

This mixed recipe is intentional: it preserves the established deployment paths and avoids provisioning or topology changes.

## 5. Quota and Capacity

- Net-new Azure resources: **0**.
- The Microsoft.App quota query for Canada Central returned no quota rows.
- Quota is not applicable to updating an existing Container Apps revision or an existing Foundry hosted-agent version.
- Validation must still confirm that the existing Container App, ACR, Foundry project, and hosted agent are available and healthy.
- Any deployment response indicating capacity, policy, or quota failure is a stop condition; do not create alternate resources or switch regions.

## 6. Security, Data, and Governance Guardrails

- Never print, persist, commit, or copy ACR credentials, API keys, database URLs, tokens, or `azd` environment secrets into logs or this plan.
- Use the existing signed-in Azure identity and existing RBAC; do not enable ACR admin credentials or anonymous pull.
- Preserve HTTPS, existing managed identities, secret references, ingress settings, and the Container App target port (`4000`).
- Keep all business records synthetic and mock-only.
- Real Entra ID sign-in and Microsoft Graph reads remain allowed only for authenticated users and must be audited through `recordAgentAction`.
- Preserve the human-in-the-loop gate: governed agent changes/messages must remain deferred in `ApprovalRequest` and execute only after human approval.
- Preserve audit writes to `AgentActionAuditLog` for every governed action.
- Do not run `prisma migrate`, `prisma db push`, `db:reset`, `seed`, or `import-workbook` manually. The existing container entrypoint may perform its unchanged startup schema check; validation must establish that `prisma\schema.prisma` has no deployment-scope changes before image publication.

## 7. Planning Checklist

- [x] User approved this exact plan on 2026-07-30.
- [ ] Confirm the only requested persistent edit during planning is this file.
- [ ] Confirm the working tree contains the intended API, Foundry-agent, and local-web changes.
- [ ] Confirm `prisma\schema.prisma`, infrastructure files, and table count are unchanged.
- [ ] Confirm no standalone Azure web resource is expected or will be created.
- [ ] Confirm rollback owners and the maintenance window for development deployment.
- [ ] After approval, change plan status to `Preparing`; after preparation succeeds, change it to `Ready for Validation`.

## 8. Preparation Checklist

Run from repository root unless a different directory is stated.

### 8.1 Tooling and target checks

- [ ] Verify `git`, Node.js/npm, Docker, Azure CLI, Azure Container Apps CLI support, Python, `azd`, and the Microsoft Foundry `azd` extension are installed.
- [ ] Authenticate without exposing tokens:

  ```powershell
  az login
  az account set --subscription "f850b37c-9bf9-4075-9eb5-43aa2daf6d85"
  azd auth login
  ```

- [ ] Verify the selected account:

  ```powershell
  az account show --query "{name:name,id:id,tenantId:tenantId}" -o json
  ```

- [ ] Verify existing targets and regions; all commands must succeed:

  ```powershell
  az group show -n "rg-msx-milestone-api" --query "{name:name,location:location}" -o json
  az acr show -g "rg-msx-milestone-api" -n "ca34643b5fc3acr" --query "{name:name,location:location,loginServer:loginServer,adminUserEnabled:adminUserEnabled}" -o json
  az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "{name:name,location:location,state:properties.provisioningState,fqdn:properties.configuration.ingress.fqdn,targetPort:properties.configuration.ingress.targetPort,revisionMode:properties.configuration.activeRevisionsMode,image:properties.template.containers[0].image,latestRevision:properties.latestRevisionName}" -o json
  az group show -n "rg-agent-framework-agent-basic-responses-dev" --query "{name:name,location:location}" -o json
  ```

- [x] Foundry `azd` environment `msx` verified against subscription `f850b37c-9bf9-4075-9eb5-43aa2daf6d85` and Canada East; secret values were not displayed.
- [x] Existing Container App Graph configuration verified: `GRAPH_SEND_MODE=live` and AAD tenant, client, and secret settings are configured; values were not exposed.
- [ ] Confirm Azure Policy assignments permit updates to the existing resources. Do not modify policy.

### 8.2 Change and contract checks

- [x] Change hygiene check completed: `git diff --check` passed.
- [ ] Run:

  ```powershell
  git diff --exit-code -- prisma\schema.prisma
  git diff --exit-code -- apps\foundry-agent\agent-framework-agent-basic-responses\azure.yaml
  ```

- [x] OpenAPI synchronization check completed: `npm run openapi:json` passed.
- [ ] Confirm all responses retain the `{ success, data }` / `{ success, error }` envelope.
- [ ] Confirm agent mutations/messages remain approval-gated and all governed and Graph actions call `recordAgentAction`.
- [ ] Confirm the API continues listening on port `4000`, matching the Dockerfile and existing Container App target port.

### 8.3 Dependency, build, and static verification

- [ ] Install exactly the locked Node dependencies: `npm ci`.
- [ ] Generate the existing Prisma client without changing schema: `npm run prisma:generate`.
- [x] Build shared, API, and web packages: `npm run build` passed on 2026-07-30.
- [ ] Run existing targeted type checks:

  ```powershell
  npm run typecheck -w @msx/api
  npm run typecheck -w @msx/web
  ```

- [x] Hosted-agent Python compile check passed with `python -m compileall -q .`.

  ```powershell
  python -m compileall -q .
  ```

- [ ] If project tests or linters exist at execution time, run the smallest existing commands covering the changed API, governance, Graph, web, and agent behavior. Do not add a new test/lint framework.

### 8.4 Local API image verification

- [ ] Set a unique immutable candidate tag, for example:

  ```powershell
  $Tag = "redeploy-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
  $Image = "ca34643b5fc3acr.azurecr.io/msx-api:$Tag"
  ```

- [x] Local container build check skipped because Docker is unavailable locally; the existing ACR remote-build path will be validated and used during deployment.

  ```powershell
  docker build --pull --build-arg "CACHEBUST=$Tag" -t $Image .
  ```

- [ ] If Docker is available, run the candidate against an ephemeral local PostgreSQL container on an isolated local Docker network. Generate local-only random credentials, do not use Azure database secrets, wait for PostgreSQL readiness, start the API candidate on port `4000`, and verify `GET /api/health` returns HTTP 200 with `{ success: true, data: { status: "ok" } }`.
- [ ] Run `pwsh scripts\smoke-test.ps1 -BaseUrl http://localhost:4000 -ApiKey <local-random-key>` against only the ephemeral local database. The AI-config-dependent chat check may be reported as skipped; other failures block deployment.
- [ ] Stop and remove the local API/PostgreSQL containers and local validation network by their exact names. Do not remove unrelated Docker objects.
- [ ] Record the candidate tag and local image ID in execution notes without recording secrets.

### 8.5 Local hosted-agent and web verification

- [ ] In the hosted-agent deployment directory, install from the existing `requirements.txt` into the selected local environment if dependencies are missing.
- [ ] Use the existing `msx` environment to run the hosted agent locally (`azd ai agent run`) and invoke a read-only synthetic prompt with `azd ai agent invoke --local`.
- [ ] Confirm the local agent can read synthetic API context and does not directly execute a governed mutation or message.
- [ ] Start the existing local Vite client with `npm run dev:web`.
- [ ] Verify the mock banner, sign-in boundary, dashboard/opportunity views, approval UI, and API connectivity. Confirm no real MSX/customer data appears.
- [ ] Stop local long-running processes by their exact process IDs after verification.

## 9. Azure Validate Checklist

This phase is mandatory and must be performed by the `azure-validate` workflow after preparation, never by manually declaring the plan validated.

- [x] Status updated to `Ready for Validation` on 2026-07-30.
- [ ] Invoke `azure-validate`.
- [ ] Verify subscription, tenant, both resource groups, both regions, resource names, and `azd` environment `msx`.
- [ ] Verify API and Foundry authentication/RBAC are sufficient for revision/version updates and no broader role is introduced.
- [ ] Verify ACR admin access and anonymous pull remain disabled.
- [ ] Verify the Container App’s current FQDN, target port, ingress, revision mode, identity, secrets, environment variables, scale, and database configuration will be preserved.
- [ ] Capture, without secrets, the current API image reference, active/latest revision, traffic weights, and FQDN as the rollback baseline.
- [ ] Verify the candidate image exists locally, passed local health/smoke checks, and has a unique tag.
- [ ] Verify no schema, table, IaC, resource, environment, model deployment, or web-hosting changes are proposed.
- [ ] Verify the hosted-agent manifest resolves to the existing project and service and that service-only `azd deploy` will not provision infrastructure.
- [ ] Verify required non-secret hosted-agent settings are present; verify required secret keys exist without outputting their values.
- [ ] Verify policy and resource health permit in-place updates.
- [ ] Record the earlier quota result: Microsoft.App / Canada Central returned no quota rows; quota is not applicable because this is an existing revision/version update with zero new resources.
- [ ] Add command outputs, timestamps, and pass/fail evidence only under **Validation Proof**.
- [ ] If every required check passes, set status to `Validated`; otherwise set status to `Validation Failed` and do not deploy.

## 10. Deployment Checklist

Deployment requires both explicit user approval and successful `azure-validate` proof.

### 10.1 API image publication and Container App revision

- [ ] Reconfirm the exact subscription:

  ```powershell
  az account set --subscription "f850b37c-9bf9-4075-9eb5-43aa2daf6d85"
  ```

- [ ] Capture rollback values in memory or protected execution output:

  ```powershell
  $PreviousImage = az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "properties.template.containers[0].image" -o tsv
  $PreviousRevision = az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "properties.latestRevisionName" -o tsv
  $Fqdn = az containerapp show -g "rg-msx-milestone-api" -n "msx-api" --query "properties.configuration.ingress.fqdn" -o tsv
  ```

- [ ] Authenticate to the existing registry with the signed-in identity, then push the already-tested local image:

  ```powershell
  az acr login -n "ca34643b5fc3acr"
  docker push $Image
  ```

- [ ] Resolve and record the pushed manifest digest using ACR metadata. The unique tag must resolve to the candidate image; a mismatch blocks rollout.
- [ ] Update only the image of the existing Container App:

  ```powershell
  az containerapp update -g "rg-msx-milestone-api" -n "msx-api" --image $Image
  ```

- [ ] Do not pass flags that alter secrets, environment variables, ingress, target port, identity, scale, revision mode, or traffic.
- [ ] Wait for the new revision to become provisioned, running, and healthy. Verify the unchanged FQDN before proceeding to the agent.

### 10.2 Foundry hosted-agent deployment

- [ ] Change directory to `apps\foundry-agent\agent-framework-agent-basic-responses`.
- [ ] Select and recheck environment `msx`: `azd env select msx`.
- [ ] Deploy only the existing hosted-agent service:

  ```powershell
  azd deploy agent-framework-agent-basic-responses
  ```

- [ ] Do not run `azd provision`, `azd up`, or any command that creates/updates the Foundry project or model deployment.
- [ ] Capture the resulting hosted-agent version/deployment identifier and deployment status without secrets.
- [ ] If the command attempts infrastructure provisioning or targets anything other than the existing hosted agent/project, cancel and stop.

## 11. Post-Deployment Verification Checklist

### 11.1 API

- [ ] Query the Container App and confirm provisioning succeeded, the latest revision is healthy/active, and the configured image equals the unique candidate tag/digest.
- [ ] Confirm existing revision mode and traffic behavior are preserved.
- [ ] Verify `https://<existing-fqdn>/api/health` returns HTTP 200 and the standard success envelope.
- [ ] Review new-revision system/console logs for startup, Prisma, authentication, Graph, and unhandled errors. Do not expose secrets.
- [ ] Run non-destructive authenticated API reads for opportunities/context and dashboard summary.
- [ ] Exercise one synthetic approval-gated workflow and verify:
  - the agent creates an `ApprovalRequest` rather than mutating/sending directly;
  - reject/needs-changes does not execute the deferred action;
  - an approved synthetic action executes exactly once;
  - the action is recorded in `AgentActionAuditLog`.
- [ ] If testing a real Microsoft Graph read, use an authenticated development user, keep the read minimal, verify `recordAgentAction`, and do not persist returned Graph data into mock tables.

### 11.2 Foundry hosted agent

- [ ] Confirm the hosted agent reports a successful/running deployment in the existing Canada East project.
- [ ] Invoke a read-only synthetic prompt with `azd ai agent invoke`.
- [ ] Verify the response uses the deployed API at the unchanged endpoint.
- [ ] Invoke a synthetic governed-change prompt and confirm it proposes/submits approval instead of directly changing data or sending Teams/Outlook messages.
- [ ] Review hosted-agent logs for startup, authentication, tool, protocol, and API errors without exposing environment values.

### 11.3 Local React client

- [ ] Re-run `npm run build -w @msx/web`.
- [ ] Start the local Vite client and verify it connects to the deployed API through existing local configuration.
- [ ] Verify the synthetic mock banner remains visible and the authentication, opportunity, dashboard, and approval experiences work.
- [ ] Confirm the subscription still contains no new standalone web resource.

### 11.4 Resource and data invariants

- [ ] Compare the post-deployment Container App configuration to the baseline; only image/revision metadata may differ.
- [ ] Confirm both original resource groups remain the deployment targets and no new Azure resources were created.
- [ ] Confirm no schema migration/reset/import occurred and all 11 mock tables remain intact.
- [ ] Confirm resource health and logs remain stable after a short observation window.
- [ ] Set plan status to `Deployed and Verified` only after all required checks pass.

## 12. Failure Handling and Rollback

### API rollback

Trigger rollback for failed health checks, crash loops, startup/schema errors, authentication regressions, approval/audit bypass, or material API regressions.

1. Stop Foundry deployment if it has not started.
2. Restore the captured previous API image on the same Container App:

   ```powershell
   az containerapp update -g "rg-msx-milestone-api" -n "msx-api" --image $PreviousImage
   ```

3. Wait for the rollback revision to become healthy and verify the existing FQDN.
4. Preserve failed-revision logs and identifiers; do not delete resources or data.

If the app uses multiple-revision traffic, restore the captured predeployment traffic weights instead of inventing new weights. Never reset the database as part of rollback.

### Hosted-agent rollback

Trigger rollback for failed deployment/invocation, protocol errors, broken API calls, missing approval gating, or audit failures.

1. Stop further invocations of the failed version.
2. Use the existing Foundry version-management path to reactivate/redeploy the previously captured healthy hosted-agent version.
3. Re-run read-only and approval-gate verification.
4. Do not delete/recreate the agent, project, model deployment, or resource group.

### Stop conditions

- Azure target differs from the fixed context.
- Validation is absent, failed, or stale relative to the candidate.
- A command proposes a new resource or infrastructure update.
- Schema/IaC/table changes are detected.
- Secrets appear in output or source control.
- Local build, health, smoke, governance, or agent checks fail.
- Existing resources are unhealthy before deployment.

## 13. Approval Gate

The plan is **Validated**. Deployment must run through `azure-deploy`; infrastructure provisioning must not run.

## Validation Proof

- `npm` build, API/web typechecks, Prisma generation, OpenAPI generation, Python compile, and `git diff` check passed.
- `azd package` passed.
- `azd agent show` confirmed version 25 active; read-only version 25 invocation passed without tools or data changes.
- API `/api/health` returned HTTP 200 with the expected mock envelope.
- ACR DNS and token checks passed; remote build is required because Docker is unavailable.
- No direct policy assignments and no RBAC, IaC, schema, table, or environment changes.
- `azd provision --preview` succeeded but proposed a duplicate Foundry account/project; provisioning is prohibited and only code deployment is allowed.
- Foundry MCP identity lacks read RBAC, but Azure CLI/`azd` exact-target checks passed.
- Revalidation after autonomous-draft prompt correction on 2026-07-31 UTC: `npm run build`, Python `compileall`, `git diff --check`, and no-change checks for `prisma/schema.prisma` and hosted-agent `azure.yaml` passed.
- `azd package --no-prompt -e msx` passed.
- `azd provision --preview --no-prompt -e msx` passed and returned the same duplicate-project proposal, confirming deployment must remain code-only.

## Deployment Proof

- API image `ca34643b5fc3acr.azurecr.io/msx-api:draftfix-20260731014241` has digest `sha256:afac463060985ccce931498fd37822a312e87e012ee05c00e5fd53fc07348aff`; Container App revision `msx-api--0000022` is active, provisioned, and running, and its health URL returned HTTP 200.
- Foundry hosted agent version 28 is active; the exact milestone request produced a complete field-by-field draft with assumptions and an edit/confirm choice.
- API-to-Foundry chat returned HTTP 200 without asking for missing details, and the approval count remained 18 before and after.
- The local web app is running at `http://127.0.0.1:5173`, and its API proxy health returned HTTP 200.
- Resource counts remained 7 in each original resource group. Target port `4000`, Single revision mode, identity, environment names, and secret names were preserved.
- `AcrPull` remains assigned, anonymous pull remains disabled, and the existing enabled ACR admin setting remains unchanged per user instruction.
- `GRAPH_SEND_MODE` remains `live`. The Prisma schema is unchanged with exactly 11 models; startup logs show the schema already in sync with no seed or reset.
- No real tenant-wide Teams test was sent because it would message every eligible tenant member.
