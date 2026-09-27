import mongoose, { Document, Schema } from 'mongoose';

/**
 * Token Blacklist Model
 * 
 * Stores invalidated JWT tokens to prevent their use even if they haven't expired.
 * This is critical for security incident response (logout, password change, etc.)
 * 
 * Tokens are identified by their SHA-256 hash for efficient lookup.
 */
export interface ITokenBlacklist extends Document {
  tokenHash: string; // SHA-256 hash of the token (unique, indexed)
  userId: string; // User ID who owns the token (indexed)
  username: string; // Username (for easier queries)
  tokenType: 'access' | 'refresh' | 'cross-domain'; // Type of token ('cross-domain' = used splash sign-in link)
  blacklistedAt: Date; // When token was blacklisted
  expiresAt: Date; // Natural expiration time (for cleanup)
  reason?: string; // Optional reason: 'logout', 'security_incident', 'password_change', etc.
  createdAt: Date;
}

const TokenBlacklistSchema = new Schema<ITokenBlacklist>(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true, // Fast lookup by token hash
    },
    userId: {
      type: String,
      required: true,
      index: true, // Fast queries for user's tokens
    },
    username: {
      type: String,
      required: true,
    },
    tokenType: {
      type: String,
      required: true,
      enum: ['access', 'refresh', 'cross-domain'],
    },
    blacklistedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound index for efficient user token queries
TokenBlacklistSchema.index({ userId: 1, tokenType: 1 });

// Index on expiresAt for efficient cleanup queries
// Note: We use manual cleanup instead of TTL index to have more control
TokenBlacklistSchema.index({ expiresAt: 1 });

const TokenBlacklist = mongoose.models.TokenBlacklist || mongoose.model<ITokenBlacklist>('TokenBlacklist', TokenBlacklistSchema);

export default TokenBlacklist;

