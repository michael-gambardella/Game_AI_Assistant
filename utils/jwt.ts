import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');

// Token expiration times
export const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
export const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days

// Token payload interface
export interface TokenPayload {
  userId: string;
  username: string;
  email?: string;
  iat?: number;
  exp?: number;
}

/**
 * Generate an access token (short-lived)
 */
export const generateAccessToken = (payload: Omit<TokenPayload, 'iat' | 'exp'>): string => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign(
    {
      userId: payload.userId,
      username: payload.username,
      email: payload.email,
    },
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: 'videogamewingman',
      audience: 'videogamewingman-users',
    }
  );
};

/**
 * Generate a refresh token (long-lived)
 */
export const generateRefreshToken = (payload: Omit<TokenPayload, 'iat' | 'exp'>): string => {
  if (!JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET is not configured');
  }

  return jwt.sign(
    {
      userId: payload.userId,
      username: payload.username,
      email: payload.email,
      type: 'refresh',
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: REFRESH_TOKEN_EXPIRY,
      issuer: 'videogamewingman',
      audience: 'videogamewingman-users',
    }
  );
};

/**
 * Verify an access token
 * Checks token signature, expiration, and blacklist
 */
export const verifyAccessToken = async (token: string): Promise<TokenPayload> => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  try {
    // First verify token signature and expiration
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'videogamewingman',
      audience: 'videogamewingman-users',
    }) as TokenPayload;

    // Check if token is blacklisted
    const { isTokenBlacklisted } = await import('./tokenBlacklist');
    const blacklisted = await isTokenBlacklisted(token);
    
    if (blacklisted) {
      throw new Error('Token has been revoked');
    }

    return decoded;
  } catch (error) {
    if (error instanceof Error && error.message === 'Token has been revoked') {
      throw error; // Re-throw blacklist errors
    } else if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
};

/**
 * Verify a refresh token
 * Checks token signature, expiration, type, and blacklist
 */
export const verifyRefreshToken = async (token: string): Promise<TokenPayload> => {
  if (!JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET is not configured');
  }

  try {
    // First verify token signature and expiration
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
      issuer: 'videogamewingman',
      audience: 'videogamewingman-users',
    }) as TokenPayload & { type?: string };

    // Verify it's a refresh token
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if token is blacklisted
    const { isTokenBlacklisted } = await import('./tokenBlacklist');
    const blacklisted = await isTokenBlacklisted(token);
    
    if (blacklisted) {
      throw new Error('Refresh token has been revoked');
    }

    return decoded;
  } catch (error) {
    if (error instanceof Error && error.message === 'Refresh token has been revoked') {
      throw error; // Re-throw blacklist errors
    } else if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    }
    throw error;
  }
};

/**
 * Extract token from Authorization header
 */
export const extractTokenFromHeader = (authHeader: string | undefined): string | null => {
  if (!authHeader) {
    return null;
  }

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
};

/**
 * Get token expiration time in milliseconds
 */
export const getTokenExpirationTime = (token: string): number | null => {
  try {
    const decoded = jwt.decode(token) as TokenPayload;
    if (decoded && decoded.exp) {
      return decoded.exp * 1000; // Convert to milliseconds
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Verify a cross-domain authentication token (from splash page).
 *
 * Only genuine splash sign-in tokens are accepted: they're signed with the shared JWT_SECRET
 * and carry type 'cross-domain-auth' / source 'splash-page'. Checking those claims matters -
 * our own access tokens are signed with the same secret, and without it any access token
 * (even one revoked at logout) could be exchanged for a fresh session.
 */
export const verifyCrossDomainAuthToken = (
  token: string
): TokenPayload & { isApproved?: boolean; type: string; source: string; exp?: number } => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    decoded.type !== 'cross-domain-auth' ||
    decoded.source !== 'splash-page' ||
    typeof decoded.userId !== 'string' ||
    typeof decoded.email !== 'string'
  ) {
    throw new Error('Invalid token');
  }

  return decoded;
};