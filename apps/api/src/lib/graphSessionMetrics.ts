/**
 * In-memory, PII-free observability for on-behalf-of (Graph) session-handle
 * resolution. This is the shared signal behind two safeguards that keep the
 * "read my Outlook / Teams" feature from silently breaking again:
 *
 *   1. LOUD ALARM — `assertion()` in graph.service.ts logs a warning whenever a
 *      governed read/live-send falls back to the service principal because the
 *      signed-in user's handle never arrived or did not resolve. That is the
 *      exact signature of the "a signed-in Microsoft user is required" outage,
 *      so it is never silent again.
 *
 *   2. WATCHDOG SIGNAL — `GET /api/diagnostics/session-metrics` exposes these
 *      counters plus a small ring of recent outcomes so an external canary can
 *      confirm the hosted agent STILL forwards the handle in streaming mode
 *      (the streaming path is what regressed).
 *
 * Only counts, timestamps, caller kind, and 10-char handle PREFIXES are kept —
 * never tokens, emails, or full handles — so the snapshot is safe to expose.
 */

export interface ResolveOutcome {
  /** ISO timestamp the outcome was recorded. */
  at: string;
  /** Was an `x-msx-session` header present on the request? */
  present: boolean;
  /** Did that header decrypt/resolve to a signed-in user? */
  resolved: boolean;
  /** How the caller authenticated: 'user' | 'service' | 'none'. */
  callerKind: string;
  /** First 10 chars of the handle (non-sensitive ciphertext prefix) or '-' when absent. */
  prefix: string;
}

const MAX_RING = 25;

const counters = {
  /** Handle arrived AND resolved to a user — the healthy path. */
  handlePresentResolved: 0,
  /** Handle arrived but did NOT resolve — bad/expired handle or key drift. */
  handlePresentUnresolved: 0,
  /** No handle at all — the streaming-drop signature when the caller is the agent. */
  handleAbsent: 0,
};

let lastResolvedAt: string | null = null;
let lastServiceFallbackAt: string | null = null;
const ring: ResolveOutcome[] = [];

/** Record one on-behalf-of resolution attempt (called from resolveActingUser). */
export function recordResolveOutcome(o: {
  present: boolean;
  resolved: boolean;
  callerKind: string;
  prefix?: string;
}): void {
  const entry: ResolveOutcome = {
    at: new Date().toISOString(),
    present: o.present,
    resolved: o.resolved,
    callerKind: o.callerKind,
    prefix: o.prefix && o.prefix.length ? o.prefix.slice(0, 10) : '-',
  };
  if (!o.present) counters.handleAbsent += 1;
  else if (o.resolved) counters.handlePresentResolved += 1;
  else counters.handlePresentUnresolved += 1;
  if (o.resolved) lastResolvedAt = entry.at;
  ring.push(entry);
  if (ring.length > MAX_RING) ring.shift();
}

/** Note that a governed action had to fall back to the service principal. */
export function recordServiceFallback(): void {
  lastServiceFallbackAt = new Date().toISOString();
}

/** Point-in-time snapshot for the diagnostics endpoint (safe to expose). */
export function metricsSnapshot() {
  return {
    counters: { ...counters },
    lastResolvedAt,
    lastServiceFallbackAt,
    recent: [...ring].reverse(), // newest first
    now: new Date().toISOString(),
  };
}
