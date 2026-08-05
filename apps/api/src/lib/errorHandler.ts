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

  // Map common Prisma failures to clear, actionable envelope errors so operational
  // problems don't hide behind a generic 500 (e.g. an unreachable database, which
  // otherwise surfaced only as "Something went wrong on the server.").
  const prismaErr = err as { name?: string; code?: string; meta?: { target?: unknown } };
  if (prismaErr?.name === 'PrismaClientInitializationError') {
    console.error('Database unreachable:', err);
    return sendError(
      res,
      503,
      'The database is currently unreachable. Check the API database connection (network/firewall) and try again.',
    );
  }
  if (prismaErr?.code === 'P2002') {
    const target = Array.isArray(prismaErr.meta?.target)
      ? prismaErr.meta.target.join(', ')
      : prismaErr.meta?.target;
    return sendError(res, 409, `A record with the same ${target ?? 'unique value'} already exists.`);
  }

  console.error('Unhandled error:', err);
  return sendError(res, 500, 'Something went wrong on the server.');
}
