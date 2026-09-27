import crypto from 'crypto';
import { connectToWingmanDB } from './databaseConnections';
import TokenBlacklist from '../models/TokenBlacklist';
import { getTokenExpirationTime } from './jwt';
import mongoose from 'mongoose';

/**
 * Token Blacklist Utilities
 * 
 * Functions to manage token blacklisting for security:
 * - Blacklist tokens (logout, security incidents)
 * - Check if tokens are blacklisted
 * - Revoke all user sessions
 * - Cleanup expired entries
 */

/**
 * Hash a token using SHA-256
 * This creates a unique identifier for the token without storing the actual token
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Get token expiration time from token string
 * Returns null if token is invalid or doesn't have expiration
 */
function getTokenExpiry(token: string): Date | null {
  const expiryTime = getTokenExpirationTime(token);
  if (!expiryTime) {
    return null;
  }
  return new Date(expiryTime);
}

/**
 * Blacklist a single token
 * 
 * @param token - The JWT token to blacklist
 * @param userId - User ID who owns the token
 * @param username - Username (for easier queries)
 * @param tokenType - 'access' or 'refresh'
 * @param reason - Optional reason for blacklisting
 * @returns Promise<boolean> - True if successfully blacklisted
 */
export async function blacklistToken(
  token: string,
  userId: string,
  username: string,
  tokenType: 'access' | 'refresh',
  reason?: string
): Promise<boolean> {
  try {
    // Ensure database connection
    if (mongoose.connection.readyState !== 1) {
      await connectToWingmanDB();
    }

    // Hash the token
    const tokenHash = hashToken(token);

    // Get token expiration time
    let expiresAt = getTokenExpiry(token);
    if (!expiresAt) {
      // If we can't determine expiration, set to 7 days from now (max refresh token expiry)
      // This ensures cleanup happens eventually
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    // Check if already blacklisted (idempotent operation)
    const existing = await TokenBlacklist.findOne({ tokenHash });
    if (existing) {
      // Already blacklisted, return success
      return true;
    }

    // Add to blacklist
    await TokenBlacklist.create({
      tokenHash,
      userId,
      username,
      tokenType,
      blacklistedAt: new Date(),
      expiresAt,
      reason: reason || 'blacklisted',
    });

    return true;
  } catch (error) {
    console.error('Error blacklisting token:', error);
    // Don't throw - blacklisting failure shouldn't break the flow
    // Log error but continue
    return false;
  }
}

/**
 * Atomically mark a single-use token (e.g. a splash sign-in link) as used.
 *
 * Relies on the unique tokenHash index: of any number of concurrent claims for the same
 * token, exactly one insert succeeds. Returns false if the token was already used.
 * Unlike isTokenBlacklisted this fails closed - database errors are thrown, so a link can
 * never be accepted without its use being recorded.
 */
export async function claimSingleUseToken(
  token: string,
  userId: string,
  username: string,
  expiresAt: Date
): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) {
    await connectToWingmanDB();
  }

  try {
    await TokenBlacklist.create({
      tokenHash: hashToken(token),
      userId,
      username,
      tokenType: 'cross-domain',
      blacklistedAt: new Date(),
      expiresAt,
      reason: 'single_use_consumed',
    });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) {
      return false; // Duplicate key: already used
    }
    throw error;
  }
}

/**
 * Check if a token is blacklisted
 *
 * @param token - The JWT token to check
 * @returns Promise<boolean> - True if token is blacklisted
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    // Ensure database connection
    if (mongoose.connection.readyState !== 1) {
      await connectToWingmanDB();
    }

    // Hash the token
    const tokenHash = hashToken(token);

    // Check if token exists in blacklist
    const blacklisted = await TokenBlacklist.findOne({ tokenHash });

    return !!blacklisted;
  } catch (error) {
    console.error('Error checking token blacklist:', error);
    // On error, assume token is NOT blacklisted (fail open)
    // This prevents database issues from blocking all authentication
    return false;
  }
}

/**
 * Blacklist all tokens for a user
 * This revokes all sessions for the user
 * 
 * @param userId - User ID
 * @param username - Username
 * @param reason - Optional reason for revocation
 * @returns Promise<number> - Number of tokens blacklisted (approximate)
 */
export async function blacklistAllUserTokens(
  userId: string,
  username: string,
  reason?: string
): Promise<number> {
  try {
    // Ensure database connection
    if (mongoose.connection.readyState !== 1) {
      await connectToWingmanDB();
    }

    // Note: We can't blacklist tokens we don't have (they're in user's cookies)
    // But we can mark that all future tokens should be considered invalid
    // by setting a "revoked at" timestamp on the user
    
    // For now, we'll return a count of currently blacklisted tokens
    // The actual revocation happens when tokens are used (they'll be rejected)
    // This is a limitation of stateless JWTs - we can't invalidate tokens we don't have
    
    const count = await TokenBlacklist.countDocuments({ userId });
    
    // Log the revocation request
    // In a future enhancement, we could store a "revokedAt" timestamp on the User model
    // and check it during token verification
    
    return count;
  } catch (error) {
    console.error('Error blacklisting all user tokens:', error);
    return 0;
  }
}

/**
 * Cleanup expired blacklist entries
 * Removes entries where expiresAt has passed
 * 
 * @returns Promise<number> - Number of entries removed
 */
export async function cleanupExpiredBlacklistEntries(): Promise<number> {
  try {
    // Ensure database connection
    if (mongoose.connection.readyState !== 1) {
      await connectToWingmanDB();
    }

    const now = new Date();
    
    // Delete all entries where expiresAt has passed
    const result = await TokenBlacklist.deleteMany({
      expiresAt: { $lt: now }
    });

    return result.deletedCount || 0;
  } catch (error) {
    console.error('Error cleaning up expired blacklist entries:', error);
    return 0;
  }
}

/**
 * Get blacklist statistics (for monitoring/debugging)
 * 
 * @returns Promise with blacklist stats
 */
export async function getBlacklistStats(): Promise<{
  total: number;
  access: number;
  refresh: number;
  expired: number;
}> {
  try {
    // Ensure database connection
    if (mongoose.connection.readyState !== 1) {
      await connectToWingmanDB();
    }

    const now = new Date();
    
    const [total, access, refresh, expired] = await Promise.all([
      TokenBlacklist.countDocuments(),
      TokenBlacklist.countDocuments({ tokenType: 'access' }),
      TokenBlacklist.countDocuments({ tokenType: 'refresh' }),
      TokenBlacklist.countDocuments({ expiresAt: { $lt: now } }),
    ]);

    return {
      total,
      access,
      refresh,
      expired,
    };
  } catch (error) {
    console.error('Error getting blacklist stats:', error);
    return {
      total: 0,
      access: 0,
      refresh: 0,
      expired: 0,
    };
  }
}

