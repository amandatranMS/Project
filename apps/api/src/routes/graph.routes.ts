import { Router } from 'express';
import { graphController as c } from '../controllers/graph.controller.js';

/**
 * Microsoft Graph (Phase 2) — reads and sends on behalf of the signed-in user.
 * Reads (/me, /hierarchy, /manager) require a real signed-in user. Outlook/Teams
 * reads and sends also accept the hosted agent (service key) when it presents a
 * valid user session handle (x-msx-session), so the agent can act as the user.
 */
const router = Router();
router.get('/me', c.me);
router.get('/hierarchy', c.hierarchy);
router.get('/manager', c.manager);
router.get('/outlook/messages', c.messages);
router.get('/teams/chats', c.chats);
router.get('/teams/messages', c.teamsMessages);
router.post('/outlook/send', c.sendMail);
router.post('/teams/notify', c.notifyTeams);
export default router;
