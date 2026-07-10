import { Router } from 'express';
import { opportunitiesController as c } from '../controllers/opportunities.controller.js';

const router = Router();
router.get('/', c.list);
router.get('/:id', c.get);
router.get('/:id/context', c.context);
router.post('/', c.create);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);
export default router;
