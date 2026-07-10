import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './httpError.js';
import { sendError } from './responses.js';

/** Turns a ZodError into a single plain-language message. */
function zodMessage(err: ZodError): string {
  return err.errors
    .map((e) => {
      const path = e.path.join('.');
      return path ? `${path}: ${e.message}` : e.message;
    })
    .join('; ');
}

// Express error-handling middleware. Always responds with the error envelope.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return sendError(res, 400, `Validation failed — ${zodMessage(err)}`);
  }
  if (err instanceof HttpError) {
    return sendError(res, err.status, err.message);
  }
  console.error('Unhandled error:', err);
  return sendError(res, 500, 'Something went wrong on the server.');
}
