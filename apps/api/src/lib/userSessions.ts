import {
  randomUUID,
  randomBytes,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

/**
 * Turns the signed-in user's bearer token (usable as an On-Behalf-Of assertion
 * for Microsoft Graph) into an opaque `x-msx-session` handle the hosted Foundry
 * agent can echo back on its tool callbacks.
 *
 * Why: the Foundry hosted agent calls back into this API with the SERVICE key,
 * so it has no user identity. When a foundry chat turn starts, we mint a handle
 * from the user's token and hand the agent only that handle. The agent echoes it
 * back (header `x-msx-session`), and we resolve it to the user's token to act
 * "on behalf of" them.
 *
 * ── Stateless by design (the important part) ──────────────────────────────────
 * The handle is a SELF-CONTAINED, encrypted token: the user's bearer is sealed
 * inside it with AES-256-GCM under a key derived from a secret shared by every
 * API instance (`MSX_SESSION_SECRET`, or `AAD_CLIENT_SECRET` as a fallback —
 * both are already identical across the local and cloud API). This means ANY
 * API instance can resolve a handle minted by ANY other instance, with no shared
 * memory or database.
 *
 * That removes the old failure mode: the web app could mint a handle on the
 * LOCAL API while the hosted agent resolved it on the CLOUD API — different
 * processes, different in-memory maps, so the read fell back to the service
 * principal and was rejected ("a signed-in Microsoft user is required"). With a
 * stateless handle, Outlook/Teams reads work whether the web app talks to the
 * local API or the cloud API — no DLP-vs-reads tradeoff.
 *
 * The raw bearer is NEVER exposed in the clear: the agent (and the model prompt
 * it rides in) only ever sees ciphertext, authenticated by the GCM tag. Handles
 * carry their own expiry and are rejected once stale.
 *
 * A tiny in-memory map is kept ONLY as a fallback for the degenerate case where
 * no shared secret is configured (pure local dev, single process).
 */

const TTL_MS = 15 * 60 * 1000; // 15 minutes — a turn re-mints, so this is generous.
// Stateless handle prefix + format tag. IMPORTANT: it must contain ONLY characters
// the hosted agent's extractor regex accepts. That regex (msx_session.py) captures
// `MSX_SESSION_ID=([A-Za-z0-9_\-]+)` and deliberately EXCLUDES '.', so the handle
// must not contain a dot or the agent truncates it (e.g. "msx2.<body>" -> "msx2")
// and the read fails with "a signed-in Microsoft user is required". We therefore
// use a fixed 4-char prefix with NO separator, followed by a base64url payload
// (base64url itself only uses [A-Za-z0-9_-], all regex-safe).
const HANDLE_PREFIX = 'msx2';
const ALG = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard nonce length.
const TAG_LEN = 16; // GCM auth tag length.

interface SessionClaims {
  /** bearer token */ b: string;
  /** email */ e?: string | null;
  /** expiry (epoch ms) */ x: number;
  /** Entra oid of the user the handle was minted for */ o?: string | null;
}

/**
 * Derive a stable 32-byte AES key from the shared secret. Prefers an explicit
 * `MSX_SESSION_SECRET` (set identically on every API instance); falls back to
 * `AAD_CLIENT_SECRET`, which the local and cloud API already share. Returns null
 * when neither is configured, so callers can fall back to the in-memory map.
 */
let cachedKey: { source: string; key: Buffer } | null = null;
function deriveKey(): Buffer | null {
  const secret = process.env.MSX_SESSION_SECRET || process.env.AAD_CLIENT_SECRET;
  if (!secret) return null;
  if (cachedKey && cachedKey.source === secret) return cachedKey.key;
  // HKDF-SHA256 with a fixed salt + info label binds the key to this purpose so
  // it can never collide with any other use of the same secret.
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('msx.user-session'),
      Buffer.from('msx.user-session.v2'),
      32,
    ),
  );
  cachedKey = { source: secret, key };
  return key;
}

function seal(key: Buffer, claims: SessionClaims): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(claims), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // pack iv | tag | ciphertext, then base64url so it is safe in an HTTP header AND
  // in the agent's MSX_SESSION_ID extractor regex. No '.' separator — see HANDLE_PREFIX.
  const packed = Buffer.concat([iv, tag, ct]);
  return `${HANDLE_PREFIX}${packed.toString('base64url')}`;
}

function open(key: Buffer, handle: string): SessionClaims | null {
  if (!handle.startsWith(HANDLE_PREFIX)) return null;
  let packed: Buffer;
  try {
    packed = Buffer.from(handle.slice(HANDLE_PREFIX.length), 'base64url');
  } catch {
    return null;
  }
  if (packed.length <= IV_LEN + TAG_LEN) return null;
  const iv = packed.subarray(0, IV_LEN);
  const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = packed.subarray(IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const claims = JSON.parse(pt.toString('utf8')) as SessionClaims;
    if (typeof claims.b !== 'string' || typeof claims.x !== 'number') return null;
    return claims;
  } catch {
    // Wrong key (secrets differ across instances) or tampered handle → fail closed.
    return null;
  }
}

// ── Fallback in-memory map (only when no shared secret is configured) ─────────
interface UserSession {
  bearer: string;
  email?: string;
  oid?: string;
  expiresAt: number;
}
const sessions = new Map<string, UserSession>();
function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id);
}

/**
 * Store a user's bearer token and return an opaque handle.
 *
 * The `oid` rides along so a tool callback can be attributed to the user who
 * started the turn. Without it the API would have to infer the owner from
 * timing, which mis-attributes rows whenever two people chat at once.
 */
export function createUserSession(bearer: string, email?: string, oid?: string): string {
  const key = deriveKey();
  if (key) {
    return seal(key, { b: bearer, e: email ?? null, x: Date.now() + TTL_MS, o: oid ?? null });
  }
  // No shared secret configured → single-process in-memory handle.
  sweep();
  const id = randomUUID();
  sessions.set(id, { bearer, email, oid, expiresAt: Date.now() + TTL_MS });
  return id;
}

/** Resolve a handle back to the user's token, or null if unknown/expired. */
export function getUserSession(id: string): { bearer: string; email?: string; oid?: string } | null {
  // Stateless encrypted handle (the normal path).
  if (id.startsWith(HANDLE_PREFIX)) {
    const key = deriveKey();
    if (!key) return null;
    const claims = open(key, id);
    if (!claims) return null;
    if (Date.now() > claims.x) return null; // expired
    return { bearer: claims.b, email: claims.e ?? undefined, oid: claims.o ?? undefined };
  }
  // Legacy in-memory handle (back-compat during rollout / no-secret dev).
  sweep();
  const s = sessions.get(id);
  if (!s || s.expiresAt <= Date.now()) return null;
  return { bearer: s.bearer, email: s.email, oid: s.oid };
}
