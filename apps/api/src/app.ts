import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';
import { errorHandler } from './lib/errorHandler.js';
import { authenticate } from './lib/entraAuth.js';
import { requestContextMiddleware } from './lib/requestContext.js';
import { sendOk } from './lib/responses.js';

/** Builds and configures the Express application. */
export function createApp() {
  const app = express();

  // Trust the dev proxy / tunnel / ingress so req.ip reflects the real client
  // IP (used as source_ip in the Defender/Purview user-security context).
  app.set('trust proxy', true);

  app.use(
    cors({
      origin: process.env.WEB_ORIGIN?.split(',') ?? '*',
    }),
  );
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    sendOk(res, { status: 'ok', service: 'msx-milestone-assistant-api', mock: true });
  });

  app.use('/api', authenticate, requestContextMiddleware, apiRoutes);

  app.use(errorHandler);

  return app;
}
