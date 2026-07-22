import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from './entraAuth.js';

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
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Entra `oid` of the signed-in user for the current request, or undefined for
 * the service principal (agent) / unauthenticated local dev. Used to stamp the
 * owner on rows created during the request.
 */
export function currentOwnerId(): string | undefined {
  const user = getRequestContext()?.user;
  return user?.kind === 'user' ? user.oid : undefined;
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
 *  - service principal (agent) or user without an oid -> shared/system rows only
 *    (never another user's private rows)
 *  - no principal (auth disabled / local dev) -> undefined (no restriction)
 */
export function ownerScopeWhere(user: AuthUser | undefined): OwnerScopeWhere {
  if (!user) return undefined;
  if (user.kind === 'user' && user.oid) {
    return { OR: [{ ownerId: user.oid }, { ownerId: null }] };
  }
  return { ownerId: null };
}

/** Express middleware: runs the rest of the request inside the request context. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  runWithRequestContext({ user: req.user }, () => next());
}
