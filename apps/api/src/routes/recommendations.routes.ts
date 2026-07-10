import { Router } from 'express';
import { recommendationsController as c } from '../controllers/recommendations.controller.js';

const router = Router();
router.get('/', c.list);
router.get('/:id', c.get);
router.post('/', c.create);
router.patch('/:id', c.update);
export default router;
