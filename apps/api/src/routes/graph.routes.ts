import { Router } from 'express';
import { graphController as c } from '../controllers/graph.controller.js';

/**
 * Microsoft Graph (Phase 2) — reads on behalf of the signed-in user.
 * All routes require a user bearer token; the service key is rejected.
 */
const router = Router();
router.get('/me', c.me);
router.get('/hierarchy', c.hierarchy);
router.get('/outlook/messages', c.messages);
router.get('/teams/chats', c.chats);
export default router;
