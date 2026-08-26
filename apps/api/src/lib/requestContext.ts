import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from './entraAuth.js';
import { getUserSession } from './userSessions.js';

/**
 * Per-HTTP-request context. Set once (right after authentication) so any code in
 * the request's async call chain can learn WHO the caller is without threading
 * `req.user` through every function.
 *
 * Used for per-user scoping of the Approvals log and Agent Action Audit Log:
 * rows are stamped with the signed-in user's Entra `oid` on create, and reads
 * are filtered to "my rows + shared/system rows". Opportunities and milestones
 * are NOT scoped — they stay global for every user.
 */
export interface RequestContext {
  user?: AuthUser;
  /**
   * Entra oid recovered from the `x-msx-session` handle. The hosted agent calls
   * back with the SERVICE key and carries no user identity, so this is the only
   * way to attribute a tool callback to the person whose turn triggered it.
   */
  sessionOwnerId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Entra `oid` to stamp on rows created during this request, or undefined when we
 * genuinely cannot attribute them (unauthenticated local dev, or an agent call
 * with no usable session handle). Unowned rows read as shared/system, which is
 * the safe failure mode — better than guessing and attributing one user's
 * activity to another.
 */
export function currentOwnerId(): string | undefined {
  const ctx = getRequestContext();
  if (ctx?.user?.kind === 'user' && ctx.user.oid) return ctx.user.oid;
  return ctx?.sessionOwnerId;
}

/** Owner-scoped read filter fragment. */
export type OwnerScopeWhere =
  | { OR: [{ ownerId: string }, { ownerId: null }] }
  | { ownerId: null }
  | undefined;

/**
 * Build the Prisma `where` fragment that restricts owner-scoped rows to what the
 * given principal may see:
 *  - signed-in user  -> their own rows + shared/system rows (ownerId null)
 *  - agent carrying a valid session handle -> the rows of the user whose turn it
 *    is acting for, so the agent reads back exactly what that person can see
 *  - service principal (agent) with no handle -> shared/system rows only
 *    (never another user's private rows)
 *  - no principal (auth disabled / local dev) -> undefined (no restriction)
 */
export function ownerScopeWhere(user: AuthUser | undefined, sessionOwnerId?: string): OwnerScopeWhere {
  if (!user) return undefined;
  if (user.kind === 'user' && user.oid) {
    return { OR: [{ ownerId: user.oid }, { ownerId: null }] };
  }
  if (sessionOwnerId) {
    return { OR: [{ ownerId: sessionOwnerId }, { ownerId: null }] };
  }
  return { ownerId: null };
}

/**
 * Express middleware: runs the rest of the request inside the request context.
 *
 * When the caller is the agent's service principal we also unseal any
 * `x-msx-session` handle it echoed back, so rows it creates are attributed to
 * the user who started the turn rather than left unowned.
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  let sessionOwnerId: string | undefined;
  if (req.user?.kind !== 'user') {
    const handle = req.header('x-msx-session');
    if (handle) sessionOwnerId = getUserSession(handle)?.oid;
  }
  runWithRequestContext({ user: req.user, sessionOwnerId }, () => next());
}

/**
 * The read filter for the caller of the current request, including any identity
 * recovered from an agent session handle. Prefer this over calling
 * `ownerScopeWhere` directly so agent callbacks and browser calls scope alike.
 */
export function currentScopeWhere(user: AuthUser | undefined): OwnerScopeWhere {
  return ownerScopeWhere(user, getRequestContext()?.sessionOwnerId);
}

/**
 * May the current caller see or act on a row with this owner?
 *
 * Unowned rows (seeded/system) are shared, so everyone may touch them. A row
 * owned by someone else is off limits even to the agent, which otherwise holds a
 * service credential that would sail past a per-user filter.
 */
export function canAccessOwned(rowOwnerId: string | null | undefined, user: AuthUser | undefined): boolean {
  if (!user) return true; // auth disabled (local dev) — nothing to enforce
  if (!rowOwnerId) return true; // shared/system row
  if (user.kind === 'user' && user.oid) return rowOwnerId === user.oid;
  return rowOwnerId === getRequestContext()?.sessionOwnerId;
}
