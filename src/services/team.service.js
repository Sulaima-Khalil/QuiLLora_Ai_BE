import { MEMBER_STATUS, TEAM_ROLE, TEAM_ROLES } from '../constants/index.js';
import { teamRepository, userRepository } from '../repositories/index.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { serializeTeamMember } from '../utils/serializers.js';
import { stripTags } from '../helpers/sanitizeHtml.helper.js';
import mailer from '../emails/mailer.js';

/**
 * Workspace membership — the backend for teamStore.js.
 *
 * Each user owns exactly one workspace, identified by their own id, so no
 * separate Workspace collection is needed.
 */

export const listMembers = async (ownerId) => {
  const members = await teamRepository.findAllByWorkspace(ownerId);
  return members.map((member) => serializeTeamMember(member));
};

export const getRoles = () => [...TEAM_ROLES];

/**
 * Invites someone to the workspace.
 *
 * When no name is supplied the frontend derived one from the email; that
 * behaviour is preserved here so the Team page looks unchanged.
 */
export const inviteMember = async (owner, { name, email, role }) => {
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (!cleanEmail) throw ApiError.badRequest('An email address is required to send an invite');

  const cleanName = stripTags(name) || cleanEmail.split('@')[0].replace(/[._]/g, ' ');

  if (cleanEmail === owner.email) {
    throw ApiError.badRequest('You are already the owner of this workspace');
  }

  const existing = await teamRepository.findByEmailForWorkspace(cleanEmail, owner._id);
  if (existing) throw ApiError.conflict('That person is already a member of this workspace');

  // Link the row to an existing account immediately, so the invite lands as
  // an active membership rather than waiting for a registration that already happened.
  const invitedUser = await userRepository.findByEmail(cleanEmail);

  const member = await teamRepository.create({
    workspaceOwner: owner._id,
    user: invitedUser?._id ?? null,
    name: invitedUser?.name ?? cleanName,
    email: cleanEmail,
    role: role ?? TEAM_ROLE.EDITOR,
    status: invitedUser ? MEMBER_STATUS.ACTIVE : MEMBER_STATUS.INVITED,
    invitedBy: owner._id,
  });

  await mailer
    .sendTeamInviteEmail({
      to: cleanEmail,
      name: member.name,
      inviterName: owner.name,
      workspaceName: `${owner.name}'s workspace`,
      role: member.role,
    })
    .catch((error) => logger.warn(`Invite email failed for ${cleanEmail}: ${error.message}`));

  return serializeTeamMember(member);
};

export const updateMemberRole = async (ownerId, memberId, role) => {
  if (!TEAM_ROLES.includes(role)) {
    throw ApiError.badRequest(`Role must be one of: ${TEAM_ROLES.join(', ')}`);
  }

  const member = await teamRepository.updateForWorkspace(memberId, ownerId, { role });
  if (!member) throw ApiError.notFound('Team member not found');

  return serializeTeamMember(member);
};

export const removeMember = async (ownerId, memberId) => {
  const member = await teamRepository.deleteForWorkspace(memberId, ownerId);
  if (!member) throw ApiError.notFound('Team member not found');

  return { message: 'Team member removed', id: String(memberId) };
};

/**
 * The caller's role inside `workspaceOwnerId`.
 * Owners are implicitly Admin and hold no membership row of their own.
 */
export const resolveRole = async (userId, email, workspaceOwnerId) => {
  if (String(userId) === String(workspaceOwnerId)) return TEAM_ROLE.ADMIN;

  const memberships = await teamRepository.findMembershipsForUser(userId, email);
  const membership = memberships.find(
    (member) => String(member.workspaceOwner) === String(workspaceOwnerId),
  );

  return membership?.role ?? null;
};

export default { listMembers, getRoles, inviteMember, updateMemberRole, removeMember, resolveRole };
