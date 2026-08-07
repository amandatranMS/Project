import type { Request } from 'express';
import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { getUserSession } from '../lib/userSessions.js';
import { recordResolveOutcome } from '../lib/graphSessionMetrics.js';
import { graphService } from '../services/graph.service.js';
import { sendMailSchema, notifyTeamsSchema } from '../validators/schemas.js';

/** Ensure the caller is a signed-in Microsoft user (not the service key). */
function requireUser(req: Request) {
  if (!req.user || req.user.kind !== 'user') {
    throw new HttpError(401, 'Sign in with your Microsoft account to use Teams / Outlook / hierarchy.');
  }
  return req.user;
}

/**
 * Resolve the principal for an on-behalf-of Graph action (read or send). A
 * signed-in user (web app) or a user session handle acts as that user. The
 * service principal (the hosted agent's x-api-key) is allowed too: for reads it
 * still needs a valid session handle to resolve a user (Graph OBO has no user
 * otherwise); for sends the service layer only lets it perform SIMULATED sends,
 * with live delivery still requiring a real user.
 */
function resolveActingUser(req: Request): AuthUser {
  if (req.user?.kind === 'user' && req.user.bearer) return req.user;
  const sessionId = req.header('x-msx-session');
  const callerKind = req.user?.kind ?? 'none';
  // Record every on-behalf-of resolution so the watchdog can confirm the hosted
  // agent still forwards the handle (present) and the loud alarm can spot the
  // service-fallback outage signature. PII-free: only present/resolved/prefix.
  if (sessionId) {
    const s = getUserSession(sessionId);
    recordResolveOutcome({ present: true, resolved: Boolean(s), callerKind, prefix: sessionId });
    if (s) return { kind: 'user', bearer: s.bearer, email: s.email };
  } else {
    recordResolveOutcome({ present: false, resolved: false, callerKind });
  }
  if (req.user?.kind === 'service') return { kind: 'service' };
  throw new HttpError(401, 'Sign in (or provide a valid session handle) to act as a user.');
}

/** Parse a positive ?top= (1..50), default 10. */
function topParam(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 10;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

export const graphController = {
  me: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    sendOk(res, await graphService.me(user));
  }),

  hierarchy: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    sendOk(res, await graphService.hierarchy(user));
  }),

  /**
   * The signed-in user's manager (for the Lost-to-Competitor pop-up, which names
   * the recipient). Degrades gracefully: returns { manager: null } when there is
   * no signed-in Microsoft user, so the UI can still show a generic warning.
   */
  manager: asyncHandler(async (req, res) => {
    if (!req.user || req.user.kind !== 'user' || !req.user.bearer) {
      return sendOk(res, { manager: null });
    }
    sendOk(res, { manager: await graphService.manager(req.user) });
  }),

  messages: asyncHandler(async (req, res) => {
    const user = resolveActingUser(req);
    sendOk(res, await graphService.messages(user, topParam(req.query.top)));
  }),

  chats: asyncHandler(async (req, res) => {
    const user = resolveActingUser(req);
    sendOk(res, await graphService.chats(user, topParam(req.query.top)));
  }),

  /** Recent Teams chats WITH their recent messages (content, not just metadata). */
  teamsMessages: asyncHandler(async (req, res) => {
    const user = resolveActingUser(req);
    const perChat = Math.min(20, Math.max(1, topParam(req.query.perChat)));
    sendOk(res, await graphService.teamsMessages(user, topParam(req.query.top), perChat));
  }),

  sendMail: asyncHandler(async (req, res) => {
    const user = resolveActingUser(req);
    const input = sendMailSchema.parse(req.body);
    sendOk(res, await graphService.sendMail(user, input));
  }),

  notifyTeams: asyncHandler(async (req, res) => {
    const user = resolveActingUser(req);
    const input = notifyTeamsSchema.parse(req.body);
    sendOk(res, await graphService.notifyTeams(user, input));
  }),
};
