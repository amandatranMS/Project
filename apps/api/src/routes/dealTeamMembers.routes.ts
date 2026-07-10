import { Router } from 'express';
import { dealTeamMembersController as c } from '../controllers/dealTeamMembers.controller.js';

const router = Router();
router.get('/', c.list);
router.post('/', c.create);
export default router;
