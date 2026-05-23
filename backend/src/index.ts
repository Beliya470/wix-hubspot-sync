import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { config } from './config';
import { logger } from './logger';
import { closeDb } from './db';
import { requestContext } from './middleware/requestContext';
import { errorHandler, notFound } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { webhooksRouter } from './routes/webhooks';
import { syncRouter } from './routes/sync';
import { mappingsRouter } from './routes/mappings';
import { formsRouter } from './routes/forms';
import { installationsRouter } from './routes/installations';
import { wixAppRouter } from './routes/wixApp';

const app = express();

app.disable('x-powered-by');
app.use(helmet({
  // We serve OAuth redirects to HubSpot/Wix; their default CSP would block us.
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: config.allowedOrigins,
  credentials: true,
}));
app.use(requestContext);
app.use(pinoHttp({
  logger,
  customProps: (req) => ({ correlationId: req.correlationId }),
  // Avoid body logging by default. Pino redaction is a safety net, not a
  // licence to dump request bodies.
}));

// Webhook routes parse the raw body themselves for signature verification,
// so we mount JSON parsing AFTER them.
app.use('/webhooks', webhooksRouter);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'wix-hubspot-sync' });
});

app.use('/auth', authRouter);
app.use('/api/installations', installationsRouter);
app.use('/api/mappings', mappingsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/forms', formsRouter);
app.use('/api/wix', wixAppRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'backend listening');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutdown signal received');
  server.close((err) => {
    if (err) logger.error({ err }, 'error closing http server');
    closeDb().finally(() => process.exit(err ? 1 : 0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
