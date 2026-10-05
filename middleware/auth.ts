import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyAccessToken, extractTokenFromHeader } from '../utils/jwt';
import { getTokenFromCookies, ACCESS_TOKEN_COOKIE } from '../utils/session';
import { connectToWingmanDB } from '../utils/databaseConnections';
import { validateAdminAccess } from '../utils/adminAccess';
import User from '../models/User';

export interface AuthenticatedRequest extends NextApiRequest {
  userId?: string;
  username?: string;
  userEmail?: string;
}

/**
 * Authentication middleware to protect API routes
 * Verifies JWT token from cookies or Authorization header
 */
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: NextApiResponse
): Promise<{ authenticated: boolean; userId?: string; username?: string; userEmail?: string }> => {
  try {
    // Try to get token from cookies first (preferred method)
    let token = getTokenFromCookies(req.headers.cookie, ACCESS_TOKEN_COOKIE);

    // Fallback to Authorization header if no cookie
    if (!token) {
      token = extractTokenFromHeader(req.headers.authorization);
    }

    if (!token) {
      // Log for debugging (only in development)
      // Commented out for production
      // if (process.env.NODE_ENV === 'development') {
      //   console.log('[Auth] No token found in cookies or headers');
      //   console.log('[Auth] Cookie header:', req.headers.cookie ? 'present' : 'missing');
      // }
      return { authenticated: false };
    }

    // Verify the token (now includes blacklist check)
    const decoded = await verifyAccessToken(token);

    // NOTE: Session check temporarily disabled in auth middleware to prevent blocking valid requests
    // Session validation is still performed in the refresh endpoint where it's most critical
    // This ensures revoked sessions can't refresh tokens, while not blocking normal API requests
    // 
    // TODO: Re-enable with better error handling if needed for immediate revocation
    // For now, revoked sessions will be invalidated on next token refresh (within 15 minutes)

    // Attach user info to request object
    req.userId = decoded.userId;
    req.username = decoded.username;
    req.userEmail = decoded.email;

    return {
      authenticated: true,
      userId: decoded.userId,
      username: decoded.username,
      userEmail: decoded.email,
    };
  } catch (error) {
    // Token is invalid or expired
    // Commented out for production
    // if (process.env.NODE_ENV === 'development') {
    //   console.log('[Auth] Token verification failed:', error instanceof Error ? error.message : 'Unknown error');
    // }
    return { authenticated: false };
  }
};

/**
 * Middleware wrapper to protect API route handlers
 * Usage: export default withAuth(handler)
 */
export const withAuth = (
  handler: (req: AuthenticatedRequest, res: NextApiResponse) => Promise<void>
) => {
  return async (req: AuthenticatedRequest, res: NextApiResponse) => {
    const authResult = await requireAuth(req, res);

    if (!authResult.authenticated) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please sign in to access this resource',
      });
    }

    return handler(req, res);
  };
};

/**
 * Optional authentication - doesn't fail if not authenticated
 * Useful for routes that work differently for authenticated vs anonymous users
 */
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: NextApiResponse
): Promise<{ authenticated: boolean; userId?: string; username?: string; userEmail?: string }> => {
  try {
    return await requireAuth(req, res);
  } catch {
    return { authenticated: false };
  }
};

export interface AuthenticatedUser {
  userId: string;
  username: string;
  email?: string;
}

/**
 * Resolves the signed-in user from the auth cookie (or Authorization: Bearer header),
 * with their *current* username loaded from the database by userId.
 *
 * Use this - never a username from the request body/query - to decide whose data a request
 * acts on. Much data is keyed by username, and the username inside a token can be stale
 * for up to 15 minutes after a rename made on another device.
 */
export const getAuthenticatedUser = async (
  req: NextApiRequest
): Promise<AuthenticatedUser | null> => {
  let token = getTokenFromCookies(req.headers.cookie, ACCESS_TOKEN_COOKIE);
  if (!token) {
    token = extractTokenFromHeader(req.headers.authorization);
  }
  if (!token) {
    return null;
  }

  let userId: string;
  try {
    ({ userId } = await verifyAccessToken(token));
  } catch {
    return null;
  }

  await connectToWingmanDB();
  const user = await User.findOne({ userId })
    .select('userId username email')
    .lean() as { userId: string; username: string; email?: string } | null;

  return user ? { userId: user.userId, username: user.username, email: user.email } : null;
};

/**
 * Like getAuthenticatedUser, but sends the 401 itself when there is no signed-in user.
 * Usage: const user = await requireUser(req, res); if (!user) return;
 * (The 'Authentication required' message is what the client's token-refresh logic keys on.)
 */
export const requireUser = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<AuthenticatedUser | null> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required', message: 'Authentication required' });
    return null;
  }
  return user;
};

/**
 * Requires a signed-in admin (ADMIN_USERNAME), judged from the session - never from a
 * username supplied in the request. Sends 401/403 itself and returns null when denied.
 */
export const requireAdminUser = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<AuthenticatedUser | null> => {
  const user = await requireUser(req, res);
  if (!user) {
    return null;
  }
  if (!validateAdminAccess(user.username).hasAccess) {
    res.status(403).json({ error: 'Access denied. Admin privileges required.', message: 'Access denied. Admin privileges required.' });
    return null;
  }
  return user;
};

