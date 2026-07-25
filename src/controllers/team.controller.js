import teamService from '../services/team.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendCreated, sendSuccess } from '../utils/ApiResponse.js';

export const listMembers = asyncHandler(async (req, res) => {
  const members = await teamService.listMembers(req.user._id);

  return sendSuccess(res, {
    message: 'Team members',
    data: { members, roles: teamService.getRoles() },
  });
});

export const listRoles = asyncHandler(async (_req, res) =>
  sendSuccess(res, { message: 'Available roles', data: { roles: teamService.getRoles() } }),
);

export const inviteMember = asyncHandler(async (req, res) => {
  const member = await teamService.inviteMember(req.user, req.body);
  return sendCreated(res, { message: `Invitation sent to ${member.email}`, data: { member } });
});

export const updateMemberRole = asyncHandler(async (req, res) => {
  const member = await teamService.updateMemberRole(req.user._id, req.params.id, req.body.role);
  return sendSuccess(res, { message: `Role updated to ${member.role}`, data: { member } });
});

export const removeMember = asyncHandler(async (req, res) => {
  const result = await teamService.removeMember(req.user._id, req.params.id);
  return sendSuccess(res, { message: result.message, data: { id: result.id } });
});

export default { listMembers, listRoles, inviteMember, updateMemberRole, removeMember };
