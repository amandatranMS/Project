import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler.js';
import { opportunitiesRouter } from './routes/opportunities.js';
import { milestonesRouter } from './routes/milestones.js';
import { collaborationRouter } from './routes/collaboration.js';
import { agentRouter } from './routes/agent.js';
import { notificationsRouter } from './routes/notifications.js';
import { dashboardRouter } from './routes/dashboard.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.WEB_ORIGIN?.split(',') ?? '*',
    }),
  );
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'msx-milestone-assistant-api', mock: true });
  });

  app.use('/api/opportunities', opportunitiesRouter);
  app.use('/api/milestones', milestonesRouter);
  app.use('/api/collaboration', collaborationRouter);
  app.use('/api/agent', agentRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);

  app.use(errorHandler);

  return app;
}
