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
 *  2. **Service** — the existing `x-api-key` header, used by the Python/Foundry
 *     agent for machine-to-machine calls. Preserved unchanged.
 *
 * Config (set once Phase 0 app registration is done):
 *   AAD_TENANT_ID  — directory (tenant) id of your Foundry tenant
 *   AAD_CLIENT_ID  — application (client) id of the registered app
 *   API_KEY        — optional shared secret for the agent (unchanged)
 *
 * If neither AAD_TENANT_ID/AAD_CLIENT_ID nor API_KEY are set, the gate is
 * disabled (local dev), so the app keeps running until Phase 0 is complete.
 */

export interface AuthUser {
  /** How the caller authenticated. */
  kind: 'user' | 'service';
  /** Entra object id (stable per user). */
  oid?: string;
  /** Display name from the token, if present. */
  name?: string;
  /** UPN / email from the token, if present. */
  email?: string;
  /** Raw bearer token — needed for the Graph On-Behalf-Of flow in Phase 2. */
  bearer?: string;
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

// Accept BOTH issuer forms for this tenant. Depending on the app registration's
// `accessTokenAcceptedVersion`, Entra issues either v2 access tokens
// (iss = login.microsoftonline.com/<tid>/v2.0) or v1 access tokens
// (iss = sts.windows.net/<tid>/). The signing keys are shared, so we accept
// either issuer and let the JWKS/signature + audience checks do the real work.
const issuers = [
  `https://login.microsoftonline.com/${tenantId}/v2.0`,
  `https://sts.windows.net/${tenantId}/`,
];
// A v1/v2 access token for a custom API carries aud = the client id (or api://<clientId>).
const audiences = [clientId ?? '', `api://${clientId ?? ''}`];

const jwks = entraAuthEnabled
  ? createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    )
  : null;

async function verifyBearer(token: string): Promise<AuthUser> {
  if (!jwks) throw new Error('Entra auth is not configured.');
  const { payload } = await jwtVerify(token, jwks, {
    issuer: issuers,
    audience: audiences,
  });
  return {
    kind: 'user',
    oid: typeof payload.oid === 'string' ? payload.oid : undefined,
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

  // 1. Service principal via shared key (agent / machine-to-machine).
  if (apiKey) {
    const provided = req.header('x-api-key');
    if (provided && provided === apiKey) {
      req.user = { kind: 'service' };
      return next();
    }
  }

  // 2. User principal via Entra bearer token.
  const authz = req.header('authorization');
  if (entraAuthEnabled && authz?.toLowerCase().startsWith('bearer ')) {
    const token = authz.slice(7).trim();
    verifyBearer(token)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch((err) => {
        // TEMP diagnostic: why did verification fail?
        try {
          const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf8'));
          console.error('[auth] bearer verify FAILED:', (err as Error)?.message);
          console.error('[auth] token claims: iss=%s aud=%s appid=%s scp=%s exp=%s(%s) now=%s',
            claims.iss, JSON.stringify(claims.aud), claims.appid ?? claims.azp, claims.scp,
            claims.exp, new Date((claims.exp ?? 0) * 1000).toISOString(), new Date().toISOString());
          console.error('[auth] API expects: iss=%s audiences=%s', JSON.stringify(issuers), JSON.stringify(audiences));
        } catch (e) {
          console.error('[auth] bearer verify FAILED and token undecodable:', (err as Error)?.message);
        }
        res.status(401).json({ success: false, error: 'Unauthorized — invalid or expired token.' });
      });
    return;
  }

  // 3. Nothing configured → open for local development.
  if (!apiKey && !entraAuthEnabled) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'Unauthorized — sign in or provide an API key.' });
}
