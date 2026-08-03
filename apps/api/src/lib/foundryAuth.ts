import { DefaultAzureCredential, OnBehalfOfCredential, type TokenCredential } from '@azure/identity';
import { entraAuthEnabled } from './entraAuth.js';

/**
 * Identity for the *inbound* Azure AI Foundry model call — the Responses endpoint
 * invocation that Microsoft Purview Data Loss Prevention inspects.
 *
 * Purview DLP for Azure AI Foundry only *enforces* policies (and therefore only
 * raises alerts) when the request carries a delegated **user-context** token. An
 * app-only token — a managed identity or service principal obtained via
 * DefaultAzureCredential — is captured in Purview Audit / DSPM Activity Explorer,
 * but DLP policies are NOT evaluated against it, so no alert ever fires. To get
 * per-seller enforcement on the *deployed* app we exchange the signed-in user's
 * token for an Azure AI data-plane token via On-Behalf-Of and call Foundry as
 * that user.
 *
 * Requires (root .env), same as the Graph OBO flow:
 *   AAD_TENANT_ID, AAD_CLIENT_ID  — the login app registration
 *   AAD_CLIENT_SECRET             — a client secret on that app registration
 * plus, on that app registration, an admin-consented delegated permission for the
 * Azure AI data plane (Azure Machine Learning / Cognitive Services
 * `user_impersonation`) and, per signed-in user, an "Azure AI User" data-plane
 * role assignment on the Foundry account.
 *
 * When no user is present (local dev / anonymous) or OBO isn't configured, callers
 * fall back to the app-only token so the demo keeps working — but DLP will only
 * audit, never enforce, those turns. (Note: run locally, DefaultAzureCredential
 * resolves to the developer's `az login` *user* token, which DLP does enforce.)
 */

// Ordered by preference. The Foundry Responses endpoint accepts an ai.azure.com
// data-plane token; cognitiveservices.azure.com is the fallback audience. We try
// each until one is issued, so whichever delegated permission was consented wins.
export const FOUNDRY_SCOPES = [
  'https://ai.azure.com/.default',
  'https://cognitiveservices.azure.com/.default',
];

const tenantId = process.env.AAD_TENANT_ID;
const clientId = process.env.AAD_CLIENT_ID;
const clientSecret = process.env.AAD_CLIENT_SECRET;

/** True once On-Behalf-Of can run (same prerequisites as the Graph OBO flow). */
export const foundryUserContextEnabled = Boolean(entraAuthEnabled && clientSecret);

// One app-only credential instance, reused across turns.
const appCredential = new DefaultAzureCredential();

/** Try each Foundry scope in turn; return the first token a credential issues. */
async function tokenFromCredential(credential: TokenCredential, label: string): Promise<string> {
  let lastErr: unknown;
  for (const scope of FOUNDRY_SCOPES) {
    try {
      const t = await credential.getToken(scope);
      if (t?.token) return t.token;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Could not acquire a Foundry ${label} token: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
}

/** App-only token (managed identity in the cloud, `az login` locally). */
export function getFoundryAppToken(): Promise<string> {
  return tokenFromCredential(appCredential, 'app');
}

/**
 * Exchange the signed-in user's bearer (audience = this app) for an Azure AI
 * data-plane token via On-Behalf-Of, so the Foundry call runs as that user and
 * Purview DLP enforces. Throws if OBO isn't configured or the exchange fails —
 * the caller decides whether to surface that or fall back to app-only.
 */
export function getFoundryUserToken(userAssertion: string): Promise<string> {
  if (!foundryUserContextEnabled) {
    throw new Error(
      'Foundry user-context (OBO) is not configured. Set AAD_CLIENT_SECRET and grant the ' +
        'delegated Azure AI permission with admin consent.',
    );
  }
  const credential = new OnBehalfOfCredential({
    tenantId: tenantId!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    userAssertionToken: userAssertion,
  });
  return tokenFromCredential(credential, 'user');
}
