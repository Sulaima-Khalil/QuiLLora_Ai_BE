import { z } from 'zod';
import { TEAM_ROLES } from '../constants/index.js';
import { email, idParam } from './common.validator.js';

/** Team schemas — mirrors teamStore.js and pages/Team.jsx. */

export const inviteMemberSchema = {
  body: z.object({
    // Optional: the Team page derives a display name from the email when the
    // inviter leaves it blank.
    name: z.string().trim().max(80).optional(),
    email,
    role: z.enum(TEAM_ROLES).optional(),
  }),
};

export const updateRoleSchema = {
  params: idParam,
  body: z.object({ role: z.enum(TEAM_ROLES) }),
};

export const memberIdSchema = { params: idParam };

export default { inviteMemberSchema, updateRoleSchema, memberIdSchema };
