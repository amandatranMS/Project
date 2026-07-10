import { Router } from 'express';
import { chatController as c } from '../controllers/chat.controller.js';

const router = Router();
router.post('/', c.send);
export default router;
