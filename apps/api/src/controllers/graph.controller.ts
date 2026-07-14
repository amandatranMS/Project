import type { Request } from 'express';
import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { graphService } from '../services/graph.service.js';

/** Ensure the caller is a signed-in Microsoft user (not the service key). */
function requireUser(req: Request) {
  if (!req.user || req.user.kind !== 'user') {
    throw new HttpError(401, 'Sign in with your Microsoft account to use Teams / Outlook / hierarchy.');
  }
  return req.user;
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
};
