import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const fromHeader = req.header('x-correlation-id');
  const id = fromHeader && /^[a-zA-Z0-9-]{8,64}$/.test(fromHeader) ? fromHeader : crypto.randomUUID();
  req.correlationId = id;
  res.setHeader('x-correlation-id', id);
  next();
}
