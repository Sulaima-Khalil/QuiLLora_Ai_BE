import { Router } from 'express';
import teamController from '../../controllers/team.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { emailLimiter } from '../../middlewares/rateLimit.middleware.js';
import {
  inviteMemberSchema,
  memberIdSchema,
  updateRoleSchema,
} from '../../validators/team.validator.js';

const router = Router();

router.use(authenticate);

router.get('/roles', teamController.listRoles);

router.get('/', teamController.listMembers);
// Invites send email, so they carry the stricter limiter.
router.post('/', emailLimiter, validate(inviteMemberSchema), teamController.inviteMember);

router.patch('/:id/role', validate(updateRoleSchema), teamController.updateMemberRole);
router.delete('/:id', validate(memberIdSchema), teamController.removeMember);

export default router;
