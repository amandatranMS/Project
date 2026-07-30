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
const GRAPH_MAX_ATTEMPTS = 4;
const GRAPH_RETRY_BASE_MS = 500;
const GRAPH_MAX_RETRY_DELAY_MS = 30_000;

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

export interface GraphSession {
  get<T>(pathOrUrl: string): Promise<T>;
  getAll<T>(path: string): Promise<T[]>;
  post<T>(pathOrUrl: string, body: unknown): Promise<T | null>;
}

function graphUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('/')) return `${GRAPH_BASE}${pathOrUrl}`;
  if (pathOrUrl.startsWith(`${GRAPH_BASE}/`)) return pathOrUrl;
  throw new GraphError(400, 'Microsoft Graph pagination returned an unexpected URL.');
}

async function graphRequest<T>(
  token: string,
  pathOrUrl: string,
  init?: { method: 'POST'; body: unknown },
): Promise<T | null> {
  const url = graphUrl(pathOrUrl);
  for (let attempt = 1; attempt <= GRAPH_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init ? JSON.stringify(init.body ?? {}) : undefined,
    });
    if (!res.ok) {
      const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (retryable && attempt < GRAPH_MAX_ATTEMPTS) {
        const retryAfter = res.headers.get('Retry-After');
        const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
        const dateDelay = retryAfter && !Number.isFinite(seconds)
          ? Date.parse(retryAfter) - Date.now()
          : Number.NaN;
        const requestedDelay = Number.isFinite(seconds)
          ? Math.max(0, seconds * 1_000)
          : Number.isFinite(dateDelay)
            ? Math.max(0, dateDelay)
            : GRAPH_RETRY_BASE_MS * 2 ** (attempt - 1);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(requestedDelay, GRAPH_MAX_RETRY_DELAY_MS)),
        );
        continue;
      }

      let detail = '';
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = body?.error?.message ?? '';
      } catch {
        /* non-JSON error body */
      }
      throw new GraphError(res.status, detail || `Microsoft Graph request failed (${res.status}).`);
    }
    if (res.status === 202 || res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }
  throw new GraphError(502, 'Microsoft Graph request exhausted its retry attempts.');
}

/** Reuses one OBO token across a multi-call Graph operation such as a tenant broadcast. */
export async function createGraphSession(userAssertion: string): Promise<GraphSession> {
  const token = await getGraphToken(userAssertion);
  return {
    async get<T>(pathOrUrl: string) {
      const data = await graphRequest<T>(token, pathOrUrl);
      if (data === null) throw new GraphError(502, 'Microsoft Graph returned an empty response.');
      return data;
    },
    async getAll<T>(path: string) {
      const values: T[] = [];
      let next: string | undefined = path;
      while (next) {
        const page: { value?: T[]; '@odata.nextLink'?: string } = await graphRequest(token, next)
          .then((data) => data ?? {});
        values.push(...(page.value ?? []));
        next = page['@odata.nextLink'];
      }
      return values;
    },
    post<T>(pathOrUrl: string, body: unknown) {
      return graphRequest<T>(token, pathOrUrl, { method: 'POST', body });
    },
  };
}

/** GET a Microsoft Graph resource as the signed-in user. Returns parsed JSON. */
export async function graphGet<T>(userAssertion: string, path: string): Promise<T> {
  return (await createGraphSession(userAssertion)).get<T>(path);
}

/** POST to Microsoft Graph as the signed-in user. Returns parsed JSON or null. */
export async function graphPost<T>(userAssertion: string, path: string, body: unknown): Promise<T | null> {
  return (await createGraphSession(userAssertion)).post<T>(path, body);
}
