import { Router } from 'express';
import { agentNotificationsController as c } from '../controllers/agentNotifications.controller.js';

const router = Router();
router.get('/', c.list);
router.post('/', c.create);
router.patch('/:id', c.update);
export default router;
