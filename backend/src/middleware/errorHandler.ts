import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    logger.warn({ status: err.status, msg: err.message, path: req.path }, 'http error');
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    // Input validation failures are 4xx, not 5xx. Surface the offending
    // field paths so the caller can correct them without guessing.
    const fields = err.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
      code: issue.code,
    }));
    logger.warn({ fields, path: req.path }, 'validation error');
    res.status(400).json({ error: 'validation_error', details: { fields } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: 'internal_server_error' });
}
