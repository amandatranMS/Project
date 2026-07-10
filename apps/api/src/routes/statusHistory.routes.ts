import { Router } from 'express';
import { statusHistoryController as c } from '../controllers/statusHistory.controller.js';

const router = Router();
router.get('/', c.list);
router.post('/', c.create);
export default router;
