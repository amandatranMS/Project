import { Router } from 'express';
import { agentActionAuditLogsController as c } from '../controllers/agentActionAuditLogs.controller.js';

const router = Router();
router.get('/', c.list);
router.post('/', c.create);
export default router;
