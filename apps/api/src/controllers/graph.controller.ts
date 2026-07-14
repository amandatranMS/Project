import type { Request } from 'express';
import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { getUserSession } from '../lib/userSessions.js';
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
 * Resolve the user to act AS. Either the caller is a signed-in user (web app),
 * or it's the hosted agent calling with the service key + an `x-msx-session`
 * handle that maps back to a signed-in user's token.
 */
function resolveActingUser(req: Request): AuthUser {
  if (req.user?.kind === 'user' && req.user.bearer) return req.user;
  const sessionId = req.header('x-msx-session');
  if (sessionId) {
    const s = getUserSession(sessionId);
    if (s) return { kind: 'user', bearer: s.bearer, email: s.email };
  }
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

  messages: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    sendOk(res, await graphService.messages(user, topParam(req.query.top)));
  }),

  chats: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    sendOk(res, await graphService.chats(user, topParam(req.query.top)));
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
