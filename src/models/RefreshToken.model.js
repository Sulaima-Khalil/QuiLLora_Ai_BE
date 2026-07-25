import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Server-side record of an issued refresh token, enabling revocation —
 * a stateless JWT alone cannot be invalidated before it expires.
 *
 * Only the SHA-256 digest is stored, so a database leak does not yield usable
 * tokens.
 */
const refreshTokenSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    tokenHash: { type: String, required: true, unique: true },

    expiresAt: { type: Date, required: true },

    revokedAt: { type: Date, default: null },

    /**
     * Set when this token is rotated. If a revoked token is presented again,
     * that indicates theft and the service revokes the whole family.
     */
    replacedByTokenHash: { type: String, default: null },

    userAgent: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true },
);

// MongoDB reaps expired documents automatically; the cron job below is a
// belt-and-braces sweep for revoked-but-unexpired rows.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

refreshTokenSchema.index({ user: 1, revokedAt: 1 });

refreshTokenSchema.virtual('isActive').get(function isActive() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
});

export const RefreshToken = model('RefreshToken', refreshTokenSchema);

export default RefreshToken;
