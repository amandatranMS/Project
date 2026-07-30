import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Real Microsoft Entra ID (Azure AD) authentication for the /api routes — the
 * Option B replacement for the mock static-key gate.
 *
 * Two principal kinds are accepted so nothing that works today breaks:
 *
 *  1. **User** — a bearer JWT issued by Entra for the signed-in seller. The web
 *     app (MSAL) obtains it and sends `Authorization: Bearer <token>`. The raw
 *     token is stashed on `req.user.bearer` so Phase 2 can do an On-Behalf-Of
 *     exchange for Microsoft Graph (Teams / Outlook / org hierarchy).
 *
 *  2. **Service** — a machine-to-machine caller (the Python/Foundry agent). Two
 *     forms are accepted: an app-only Entra token (`Authorization: Bearer`,
 *     issued to the agent identity via client credentials / workload-identity
 *     federation) so Conditional Access can govern the agent, OR the legacy
 *     `x-api-key` header, kept as a fallback during rollout.
 *
 * Config (set once Phase 0 app registration is done):
 *   AAD_TENANT_ID         — directory (tenant) id of your Foundry tenant
 *   AAD_CLIENT_ID         — application (client) id of the registered app
 *   AGENT_ALLOWED_APP_IDS — optional CSV allowlist of app ids that may call as a
 *                           service via an Entra token (default: any valid app)
 *   API_KEY               — optional shared secret for the agent (unchanged)
 *
 * If neither AAD_TENANT_ID/AAD_CLIENT_ID nor API_KEY are set, the gate is
 * disabled (local dev), so the app keeps running until Phase 0 is complete.
 */

export interface AuthUser {
  /** How the caller authenticated. */
  kind: 'user' | 'service';
  /** Entra object id (stable per user). */
  oid?: string;
  /** Entra tenant id (tid claim) — end_user_tenant_id for Defender/Purview context. */
  tenantId?: string;
  /** Display name from the token, if present. */
  name?: string;
  /** UPN / email from the token, if present. */
  email?: string;
  /** Raw bearer token — needed for the Graph On-Behalf-Of flow in Phase 2. */
  bearer?: string;
  /** Calling application id (azp/appid) when a service authenticated via Entra. */
  appId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const tenantId = process.env.AAD_TENANT_ID;
const clientId = process.env.AAD_CLIENT_ID;

/** True once the app registration values are configured. */
export const entraAuthEnabled = Boolean(tenantId && clientId);

// Accept BOTH token versions. A custom "Expose an API" scope issues v1 access
// tokens (iss = https://sts.windows.net/<tenant>/) unless the app registration
// sets requestedAccessTokenVersion=2 (iss = .../v2.0). Allow either so the login
// works regardless of that manifest setting.
const issuer = [
  `https://login.microsoftonline.com/${tenantId}/v2.0`,
  `https://sts.windows.net/${tenantId}/`,
];
// A v2 token carries aud = the client id; a v1 token carries aud = api://<clientId>.
const audiences = [clientId ?? '', `api://${clientId ?? ''}`];

// Optional allowlist of application ids permitted to call as the agent via an
// app-only Entra token. Comma-separated. Leave unset to accept any app token
// that already passed issuer + audience verification.
const allowedAppIds = (process.env.AGENT_ALLOWED_APP_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const jwks = entraAuthEnabled
  ? createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    )
  : null;

async function verifyBearer(token: string): Promise<AuthUser> {
  if (!jwks) throw new Error('Entra auth is not configured.');
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: audiences,
  });

  // App-only (agent) token — issued via client credentials / workload-identity
  // federation, so there is no delegated user. Identify by idtyp === 'app', or an
  // app id (azp/appid) with no delegated scope (scp). Treated as a SERVICE call,
  // so Conditional Access on the agent identity governs these requests.
  const appId =
    (typeof payload.azp === 'string' && payload.azp) ||
    (typeof payload.appid === 'string' && payload.appid) ||
    undefined;
  const isAppOnly =
    payload.idtyp === 'app' || (appId !== undefined && typeof payload.scp !== 'string');
  if (isAppOnly) {
    if (allowedAppIds.length > 0 && (!appId || !allowedAppIds.includes(appId))) {
      throw new Error('Application is not authorized to call this API.');
    }
    return { kind: 'service', appId, bearer: token };
  }

  return {
    kind: 'user',
    oid: typeof payload.oid === 'string' ? payload.oid : undefined,
    tenantId: typeof payload.tid === 'string' ? payload.tid : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    email:
      (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
      (typeof payload.upn === 'string' && payload.upn) ||
      undefined,
    bearer: token,
  };
}

/**
 * Combined authentication middleware. Accepts a valid Entra bearer token OR the
 * service `x-api-key`. Falls open only when nothing is configured (local dev).
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.API_KEY;

  // 1. User principal via Entra bearer token. Checked FIRST so a real signed-in
  //    user always wins over the shared service key — the Vite dev proxy injects
  //    x-api-key on every /api call, so the browser sends both; the delegated
  //    user identity is more specific and is required for Graph (on-behalf-of).
  const authz = req.header('authorization');
  if (entraAuthEnabled && authz?.toLowerCase().startsWith('bearer ')) {
    const token = authz.slice(7).trim();
    verifyBearer(token)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch(() => {
        res.status(401).json({ success: false, error: 'Unauthorized — invalid or expired token.' });
      });
    return;
  }

  // 2. Service principal via shared key (agent / machine-to-machine).
  if (apiKey) {
    const provided = req.header('x-api-key');
    if (provided && provided === apiKey) {
      req.user = { kind: 'service' };
      return next();
    }
  }

  // 3. Nothing configured → open for local development.
  if (!apiKey && !entraAuthEnabled) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'Unauthorized — sign in or provide an API key.' });
}
