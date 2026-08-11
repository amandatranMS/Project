import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';
import { errorHandler } from './lib/errorHandler.js';
import { authenticate } from './lib/entraAuth.js';
import { sendOk } from './lib/responses.js';

/** Builds and configures the Express application. */
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.WEB_ORIGIN?.split(',') ?? '*',
    }),
  );
  app.use(express.json());

  // TEMP diagnostic request logger (remove after debugging approve flow).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(
        `[REQ] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms) user=${req.user?.kind ?? 'none'}`,
      );
    });
    next();
  });

  app.get('/api/health', (_req, res) => {
    sendOk(res, { status: 'ok', service: 'msx-milestone-assistant-api', mock: true });
  });

  app.use('/api', authenticate, apiRoutes);

  app.use(errorHandler);

  return app;
}
