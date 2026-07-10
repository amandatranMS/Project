import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';
import { errorHandler } from './lib/errorHandler.js';
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

  app.get('/api/health', (_req, res) => {
    sendOk(res, { status: 'ok', service: 'msx-milestone-assistant-api', mock: true });
  });

  app.use('/api', apiRoutes);

  app.use(errorHandler);

  return app;
}
