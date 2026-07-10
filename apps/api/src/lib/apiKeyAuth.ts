import type { Request, Response, NextFunction } from 'express';

/**
 * Optional API-key gate for the /api routes.
 *
 * - If the API_KEY environment variable is NOT set, the gate is disabled (handy
 *   for local development where the web app talks to the API directly).
 * - If API_KEY is set, every request must send a matching `x-api-key` header.
 *   This lets you safely expose the mock API over a public tunnel (e.g. to a
 *   Copilot Studio agent) without leaving it wide open.
 *
 * The /api/health route is registered before this middleware, so it stays open.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_KEY;
  if (!expected) return next(); // gate disabled

  const provided = req.header('x-api-key');
  if (provided && provided === expected) return next();

  return res.status(401).json({ success: false, error: 'Unauthorized — missing or invalid API key.' });
}
