import { OnBehalfOfCredential } from '@azure/identity';
import { entraAuthEnabled } from './entraAuth.js';
import { HttpError } from './httpError.js';

/**
 * Microsoft Graph access via the On-Behalf-Of (OBO) flow — Phase 2.
 *
 * The web app signs the user in and calls our API with an access token whose
 * audience is THIS app. Here we exchange that token (the "user assertion") for a
 * Microsoft Graph token, using the app's client secret, so Graph calls run AS
 * the signed-in user (delegated). Nothing is app-only; a user must be present.
 *
 * Requires (in the root .env):
 *   AAD_TENANT_ID, AAD_CLIENT_ID  — same as the login app registration
 *   AAD_CLIENT_SECRET             — a client secret on that app registration
 * plus admin-consented delegated Graph scopes: User.Read, User.Read.All,
 * Mail.Read, Mail.Send, Chat.ReadWrite, ChatMessage.Send.
 */

const tenantId = process.env.AAD_TENANT_ID;
const clientId = process.env.AAD_CLIENT_ID;
const clientSecret = process.env.AAD_CLIENT_SECRET;

/** True once the secret is configured (login can work without it; Graph can't). */
export const graphEnabled = Boolean(entraAuthEnabled && clientSecret);

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Graph/OBO failure carrying an HTTP status for the error handler. */
export class GraphError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'GraphError';
  }
}

async function getGraphToken(userAssertion: string): Promise<string> {
  if (!graphEnabled) {
    throw new GraphError(
      501,
      'Microsoft Graph is not configured. Set AAD_CLIENT_SECRET and grant the delegated Graph scopes with admin consent.',
    );
  }
  const credential = new OnBehalfOfCredential({
    tenantId: tenantId!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    userAssertionToken: userAssertion,
  });
  try {
    const token = await credential.getToken(GRAPH_SCOPE);
    if (!token?.token) throw new GraphError(502, 'Could not obtain a Microsoft Graph token.');
    return token.token;
  } catch (err) {
    if (err instanceof GraphError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // Common cause: delegated scopes not consented (AADSTS65001).
    throw new GraphError(502, `On-Behalf-Of token exchange failed: ${msg}`);
  }
}

/** GET a Microsoft Graph resource as the signed-in user. Returns parsed JSON. */
export async function graphGet<T>(userAssertion: string, path: string): Promise<T> {
  const token = await getGraphToken(userAssertion);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new GraphError(res.status, detail || `Microsoft Graph request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

/** POST to Microsoft Graph as the signed-in user. Returns parsed JSON or null. */
export async function graphPost<T>(userAssertion: string, path: string, body: unknown): Promise<T | null> {
  const token = await getGraphToken(userAssertion);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      detail = errBody?.error?.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new GraphError(res.status, detail || `Microsoft Graph request failed (${res.status}).`);
  }
  // sendMail and similar return 202/204 with no body.
  if (res.status === 202 || res.status === 204) return null;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}
