import { Router } from 'express';
import { opportunitiesController as c } from '../controllers/opportunities.controller.js';

const router = Router();
router.get('/', c.list);
router.get('/next-tpid', c.nextTpid); // must precede '/:id' so it isn't captured as an id
router.get('/:id', c.get);
router.get('/:id/context', c.context);
router.get('/:id/handoff-readiness', c.handoffReadiness);
router.get('/:id/esif-estimate', c.esifEstimate);
router.post('/', c.create);
router.post('/:id/announce', c.announce);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);
export default router;
