import { Router } from 'express';
import { milestonesController as c } from '../controllers/milestones.controller.js';

const router = Router();
router.get('/', c.list);
router.get('/:id', c.get);
router.get('/:id/handoff-readiness', c.handoffReadiness);
router.post('/', c.create);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);
export default router;
