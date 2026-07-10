import { Router } from 'express';
import { approvalRequestsController as c } from '../controllers/approvalRequests.controller.js';

const router = Router();
router.get('/', c.list);
router.get('/:id', c.get);
router.post('/', c.create);
router.patch('/:id', c.update);
router.patch('/:id/approve', c.approve);
router.patch('/:id/reject', c.reject);
router.patch('/:id/needs-changes', c.needsChanges);
export default router;
