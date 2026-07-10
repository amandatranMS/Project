import { Router } from 'express';
import { agentRunLogsController as c } from '../controllers/agentRunLogs.controller.js';

const router = Router();
router.get('/', c.list);
router.post('/', c.create);
export default router;
