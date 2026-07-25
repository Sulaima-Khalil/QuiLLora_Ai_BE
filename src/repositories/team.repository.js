import { TeamMember } from '../models/index.js';

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

export const findAllByWorkspace = (workspaceOwner) =>
  TeamMember.find({ workspaceOwner }).sort({ createdAt: 1 }).exec();

export const findByIdForWorkspace = (id, workspaceOwner) =>
  TeamMember.findOne({ _id: id, workspaceOwner }).exec();

export const findByEmailForWorkspace = (email, workspaceOwner) =>
  TeamMember.findOne({ workspaceOwner, email: normalizeEmail(email) }).exec();

export const create = (payload) => TeamMember.create(payload);

export const updateForWorkspace = (id, workspaceOwner, update) =>
  TeamMember.findOneAndUpdate({ _id: id, workspaceOwner }, update, {
    new: true,
    runValidators: true,
  }).exec();

export const deleteForWorkspace = (id, workspaceOwner) =>
  TeamMember.findOneAndDelete({ _id: id, workspaceOwner }).exec();

export const countByWorkspace = (workspaceOwner) =>
  TeamMember.countDocuments({ workspaceOwner }).exec();

export const deleteAllByWorkspace = (workspaceOwner) =>
  TeamMember.deleteMany({ workspaceOwner }).exec();

/**
 * Workspaces the given user belongs to, used to resolve the caller's role
 * when they are acting inside someone else's workspace.
 */
export const findMembershipsForUser = (userId, email) =>
  TeamMember.find({ $or: [{ user: userId }, { email: normalizeEmail(email) }] }).exec();

/** Links a newly registered user to any invites already addressed to them. */
export const claimInvitesForUser = (userId, email, status) =>
  TeamMember.updateMany(
    { email: normalizeEmail(email), user: null },
    { $set: { user: userId, status, joinedAt: new Date() } },
  ).exec();

export default {
  findAllByWorkspace,
  findByIdForWorkspace,
  findByEmailForWorkspace,
  create,
  updateForWorkspace,
  deleteForWorkspace,
  countByWorkspace,
  deleteAllByWorkspace,
  findMembershipsForUser,
  claimInvitesForUser,
};
