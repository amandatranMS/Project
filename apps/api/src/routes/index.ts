import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { searchController } from '../controllers/search.controller.js';
import opportunities from './opportunities.routes.js';
import milestones from './milestones.routes.js';
import statusHistory from './statusHistory.routes.js';
import recommendations from './recommendations.routes.js';
import approvalRequests from './approvalRequests.routes.js';
import collaborationNotes from './collaborationNotes.routes.js';
import dealTeamMembers from './dealTeamMembers.routes.js';
import agentNotifications from './agentNotifications.routes.js';
import agentRunLogs from './agentRunLogs.routes.js';
import agentActionAuditLogs from './agentActionAuditLogs.routes.js';
import chat from './chat.routes.js';
import graph from './graph.routes.js';

/** Aggregates every route group under /api. */
const api = Router();

// Current authenticated principal (from the Entra bearer token, or the service
// key). Foundation for Phase 2 (Graph: Teams / Outlook / org hierarchy).
api.get('/me', (req, res) => {
  if (!req.user || req.user.kind !== 'user') {
    return res.status(401).json({ success: false, error: 'No signed-in user.' });
  }
  const { kind, oid, name, email } = req.user;
  res.json({ success: true, data: { kind, oid, name, email } });
});

api.use('/opportunities', opportunities);
api.use('/milestones', milestones);
api.use('/status-history', statusHistory);
api.use('/recommendations', recommendations);
api.use('/approval-requests', approvalRequests);
api.use('/collaboration-notes', collaborationNotes);
api.use('/deal-team-members', dealTeamMembers);
api.use('/agent-notifications', agentNotifications);
api.use('/agent-run-logs', agentRunLogs);
api.use('/agent-action-audit-logs', agentActionAuditLogs);
api.use('/chat', chat);
api.use('/graph', graph);

// Universal "look up ANY field" search across the global business records.
api.get('/search', searchController.search);

// Dashboard (two base paths per the spec).
api.get('/dashboard/summary', dashboardController.summary);
api.get('/dashboard-metric-snapshots', dashboardController.listSnapshots);
api.post('/dashboard-metric-snapshots', dashboardController.createSnapshot);

export default api;
