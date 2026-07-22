import { Router } from 'express';
import { opportunitiesController as c } from '../controllers/opportunities.controller.js';

const router = Router();
router.get('/', c.list);
router.get('/:id', c.get);
router.get('/:id/context', c.context);
router.post('/', c.create);
router.post('/:id/announce', c.announce);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);
export default router;
