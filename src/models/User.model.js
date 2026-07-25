import mongoose from 'mongoose';
import {
  AUTH_PROVIDER,
  DEFAULT_TONE,
  OAUTH_PROVIDERS,
  TONES,
} from '../constants/index.js';
import { hashPassword, verifyPassword } from '../helpers/password.helper.js';

const { Schema, model } = mongoose;

/**
 * Editorial preferences — mirrors DEFAULT_SETTINGS in pages/Setting.jsx.
 * Embedded rather than a separate collection: settings are always read with
 * the user and never queried independently.
 */
const settingsSchema = new Schema(
  {
    tone: { type: String, enum: TONES, default: DEFAULT_TONE },
    creativeInference: { type: Boolean, default: true },
    autoCitations: { type: Boolean, default: false },
    twoFactor: { type: Boolean, default: false },
    editorialUpdates: { type: Boolean, default: true },
    analyticsReports: { type: Boolean, default: false },
  },
  { _id: false },
);

/** A linked OAuth identity. A user may link both Google and GitHub. */
const oauthAccountSchema = new Schema(
  {
    provider: { type: String, enum: OAUTH_PROVIDERS, required: true },
    providerAccountId: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name must be at most 80 characters'],
    },

    username: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username must be at most 30 characters'],
      match: [/^[a-z0-9_.]+$/, 'Username may contain only letters, numbers, dots and underscores'],
      // `sparse` so the many users without a username do not collide on null.
      index: { unique: true, sparse: true },
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },

    /**
     * Absent for OAuth-only accounts. `select: false` keeps the hash out of
     * every query result unless explicitly requested.
     */
    password: {
      type: String,
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },

    // ---- Profile (profileStore.js) ----
    role: {
      type: String,
      trim: true,
      maxlength: 120,
      default: 'Writer',
    },
    bio: { type: String, trim: true, maxlength: 500, default: '' },
    country: { type: String, trim: true, maxlength: 60, default: '' },
    avatar: { type: String, default: '' },

    // ---- Account state ----
    isEmailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    newsletterOptIn: { type: Boolean, default: false },
    lastLoginAt: { type: Date },

    authProvider: {
      type: String,
      enum: Object.values(AUTH_PROVIDER),
      default: AUTH_PROVIDER.LOCAL,
    },
    oauthAccounts: { type: [oauthAccountSchema], default: [] },

    // ---- Single-use token digests (never the raw tokens) ----
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    /**
     * Digest of the 6-digit code emailed alongside the reset link, for the
     * "type the code" recovery flow. Kept separate from `passwordResetToken`
     * so the link keeps its full 256 bits of entropy.
     */
    passwordResetCode: { type: String, select: false },

    /**
     * Failed attempts against the current code. A 6-digit space is small
     * enough to brute-force, so the code is burned after a few misses rather
     * than relying on rate limiting alone.
     */
    passwordResetCodeAttempts: { type: Number, default: 0, select: false },

    /** Timestamp of the last password change, surfaced in the security UI. */
    passwordChangedAt: { type: Date, select: false },

    /**
     * Incremented on every password change and embedded in each access token.
     * A token carrying a stale version is rejected, which invalidates existing
     * sessions immediately.
     *
     * A counter rather than a `passwordChangedAt` comparison: JWT `iat` has
     * one-second resolution, so a token minted in the same second as the
     * change would otherwise survive it.
     */
    tokenVersion: { type: Number, default: 0 },

    // ---- Saved articles (collectionsStore.js `bookmarks`) ----
    bookmarks: [{ type: Schema.Types.ObjectId, ref: 'Article', index: true }],

    settings: { type: settingsSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

userSchema.index({ createdAt: -1 });

/** Initials used by the frontend avatars (`getInitials` in profileStore.js). */
userSchema.virtual('initials').get(function getInitials() {
  if (!this.name) return '';
  const words = this.name.trim().split(/\s+/);
  return words.length === 1
    ? words[0][0].toUpperCase()
    : (words[0][0] + words[1][0]).toUpperCase();
});

/** True when the account can authenticate with a password. */
userSchema.virtual('hasPassword').get(function hasPassword() {
  return Boolean(this.password);
});

/**
 * Hash on write. Guarding on `isModified` prevents double-hashing when an
 * unrelated field is saved.
 */
// Mongoose 9 removed callback-style middleware: an async hook signals
// completion by resolving, and errors by throwing.
userSchema.pre('save', async function hashPasswordOnSave() {
  if (!this.isModified('password') || !this.password) return;

  this.password = await hashPassword(this.password);

  // A changed password retires every token minted against the old one.
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
    this.tokenVersion += 1;
  }
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return verifyPassword(candidate, this.password);
};

/**
 * True when a token's embedded version is older than the account's current
 * one — i.e. the password changed after the token was issued.
 *
 * Tokens predating this field carry no `tv` claim; they are treated as
 * version 0, so they remain valid until the first password change.
 */
userSchema.methods.isTokenVersionStale = function isTokenVersionStale(tokenVersion) {
  return (tokenVersion ?? 0) !== this.tokenVersion;
};

export const User = model('User', userSchema);

export default User;
