import type { Request, Response, NextFunction } from 'express';

/**
 * Consistent JSON response envelope used by every endpoint:
 *   success: { "success": true,  "data": ... }
 *   error:   { "success": false, "error": "Plain language error message" }
 */
export function sendOk<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function sendError(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps an async handler so thrown errors reach the error middleware. */
export function asyncHandler(fn: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
