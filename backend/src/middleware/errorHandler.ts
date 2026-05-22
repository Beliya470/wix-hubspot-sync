import { NextFunction, Request, Response } from 'express';
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
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: 'internal_server_error' });
}
