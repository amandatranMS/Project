import { randomUUID } from 'node:crypto';

/**
 * Short-lived, in-memory map of a random sessionId → the signed-in user's
 * bearer token (usable as an On-Behalf-Of assertion for Microsoft Graph).
 *
 * Why: the Foundry hosted agent calls back into this API with the SERVICE key,
 * so it has no user identity. When a foundry chat turn starts, we stash the
 * user's token here and hand the agent only an opaque sessionId. The agent
 * echoes that id back on its tool calls (header `x-msx-session`), and we resolve
 * it to the user's token to act "on behalf of" them — the raw token never
 * leaves the API.
 *
 * Tokens are short-lived by nature; entries expire after TTL_MS.
 */

interface UserSession {
  bearer: string;
  email?: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const sessions = new Map<string, UserSession>();

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id);
}

/** Store a user's bearer token and return an opaque handle. */
export function createUserSession(bearer: string, email?: string): string {
  sweep();
  const id = randomUUID();
  sessions.set(id, { bearer, email, expiresAt: Date.now() + TTL_MS });
  return id;
}

/** Resolve a handle back to the user's token, or null if unknown/expired. */
export function getUserSession(id: string): { bearer: string; email?: string } | null {
  sweep();
  const s = sessions.get(id);
  if (!s || s.expiresAt <= Date.now()) return null;
  return { bearer: s.bearer, email: s.email };
}
