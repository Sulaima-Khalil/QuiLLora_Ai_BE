import mongoose from 'mongoose';
import { MEMBER_STATUS, MEMBER_STATUSES, TEAM_ROLE, TEAM_ROLES } from '../constants/index.js';

const { Schema, model } = mongoose;

/**
 * A member of a workspace — mirrors teamStore.js.
 *
 * `workspaceOwner` is the user who owns the workspace, so every account gets
 * its own team without needing a separate Workspace collection.
 */
const teamMemberSchema = new Schema(
  {
    workspaceOwner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Set once the invitee registers; null while the invite is outstanding. */
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    name: {
      type: String,
      required: [true, 'Member name is required'],
      trim: true,
      maxlength: [80, 'Member name must be at most 80 characters'],
    },

    email: {
      type: String,
      required: [true, 'Member email is required'],
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },

    role: { type: String, enum: TEAM_ROLES, default: TEAM_ROLE.EDITOR },

    status: { type: String, enum: MEMBER_STATUSES, default: MEMBER_STATUS.INVITED },

    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    /** Drives the "Jan 2024" label on the Team page. */
    joinedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// A person can hold only one role per workspace.
teamMemberSchema.index({ workspaceOwner: 1, email: 1 }, { unique: true });

teamMemberSchema.virtual('initials').get(function initials() {
  if (!this.name) return '';
  const words = this.name.trim().split(/\s+/);
  return words.length === 1
    ? words[0][0].toUpperCase()
    : (words[0][0] + words[1][0]).toUpperCase();
});

export const TeamMember = model('TeamMember', teamMemberSchema);

export default TeamMember;
