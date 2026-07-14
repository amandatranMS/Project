import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

/**
 * MSAL (Microsoft Entra ID) configuration for the web app — Option B real login.
 *
 * Values come from Vite env vars, set once the Phase 0 app registration exists:
 *   VITE_AAD_CLIENT_ID   — application (client) id
 *   VITE_AAD_TENANT_ID   — directory (tenant) id of your Foundry tenant
 *   VITE_AAD_REDIRECT_URI (optional) — defaults to the current origin
 *   VITE_API_SCOPE       — the API scope you exposed, e.g. api://<clientId>/access_as_user
 *
 * If VITE_AAD_CLIENT_ID / VITE_AAD_TENANT_ID are absent, login is disabled and
 * the app renders directly (local dev), so nothing breaks before Phase 0.
 */

const clientId = import.meta.env.VITE_AAD_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_AAD_TENANT_ID as string | undefined;
const redirectUri =
  (import.meta.env.VITE_AAD_REDIRECT_URI as string | undefined) ?? window.location.origin;
const apiScope = import.meta.env.VITE_API_SCOPE as string | undefined;

/** True once the app registration values are configured. */
export const authEnabled = Boolean(clientId && tenantId);

const configuration: Configuration = {
  auth: {
    clientId: clientId ?? '',
    authority: `https://login.microsoftonline.com/${tenantId ?? 'common'}`,
    redirectUri,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
};

/** The singleton MSAL instance (only created when auth is enabled). */
export const msalInstance = authEnabled ? new PublicClientApplication(configuration) : null;

/** Scopes requested at sign-in: basic profile + our API. */
export const loginRequest = {
  scopes: ['User.Read', ...(apiScope ? [apiScope] : [])],
};

/** Scopes used to silently get an access token for calling our own API. */
export const apiTokenRequest = {
  scopes: apiScope ? [apiScope] : ['User.Read'],
};

/**
 * Delegated Microsoft Graph scopes the user consents to (once) so the API can
 * act on their behalf via On-Behalf-Of. These are all user-consentable — no
 * admin needed. (Org hierarchy also needs User.Read.All, which IS admin-only.)
 */
export const graphConsentRequest = {
  scopes: [
    'User.Read',
    'Mail.Read',
    'Mail.Send',
    'Chat.Read',
  ],
};
