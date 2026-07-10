import { Router } from 'express';
import { collaborationNotesController as c } from '../controllers/collaborationNotes.controller.js';

const router = Router();
router.get('/', c.list);
router.post('/', c.create);
export default router;
