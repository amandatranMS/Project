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
  /** Client IP for the current request — source_ip in the Defender/Purview user context. */
  sourceIp?: string;
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

/**
 * Microsoft Defender for Cloud / Purview end-user context for AI model calls.
 *
 * Attaching this `user_security_context` to a direct Azure OpenAI request lets
 * Defender for AI attribute its security alerts to the real signed-in seller
 * (instead of the app's identity) and satisfies Purview's requirement that Data
 * Security policies only apply to calls that "explicitly include user context".
 * Returns undefined when no signed-in user is present (agent/service or local
 * dev), in which case the call is sent without the block.
 *
 * NOTE: only the *direct* engine (aiClient.ts) carries this body param — the
 * hosted-agent Responses path can't. The hosted agent instead gets Purview DLP
 * enforcement from the delegated user token it is invoked with (On-Behalf-Of; see
 * `lib/foundryAuth.ts`), not from this context block.
 */
export function getUserSecurityContext(): Record<string, string> | undefined {
  const ctx = getRequestContext();
  const user = ctx?.user;
  if (user?.kind !== 'user' || !user.oid) return undefined;

  const context: Record<string, string> = {
    application_name: process.env.DEFENDER_AI_APP_NAME || 'Multi-Agent Sales Assistant',
    end_user_id: user.oid,
  };
  if (user.tenantId) context.end_user_tenant_id = user.tenantId;
  if (ctx?.sourceIp) context.source_ip = ctx.sourceIp;
  return context;
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
  runWithRequestContext({ user: req.user, sourceIp: req.ip }, () => next());
}
