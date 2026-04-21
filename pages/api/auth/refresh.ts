import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRefreshToken } from '../../../utils/jwt';
import { getTokenFromCookies, REFRESH_TOKEN_COOKIE, setAuthCookiesWithSession } from '../../../utils/session';
import { blacklistToken } from '../../../utils/tokenBlacklist';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Get refresh token from cookies
    const refreshToken = getTokenFromCookies(req.headers.cookie, REFRESH_TOKEN_COOKIE);

    if (!refreshToken) {
      return res.status(401).json({
        message: 'Refresh token not found',
      });
    }

    // Verify refresh token (now includes blacklist check)
    const decoded = await verifyRefreshToken(refreshToken);

    // Connect to database to verify user still exists

    // Check if the session associated with this refresh token is still active
    // Note: If session doesn't exist in DB, we allow refresh (backward compatibility)
    // This check is OPTIONAL and should not block valid refresh tokens
    try {
      const { hashToken } = await import('../../../utils/tokenBlacklist');
      const Session = (await import('../../../models/Session')).default;
      const refreshTokenHash = hashToken(refreshToken);
      
      const session = await Session.findOne({
        refreshTokenHash,
        userId: decoded.userId,
      }).lean() as any;

      // If session exists and is inactive, block refresh
      // This ensures that revoked sessions or logged-out sessions cannot be refreshed
      // Users must sign in again to create a new active session
      if (session && 
          typeof session === 'object' && 
          'isActive' in session && 
          session.isActive === false) {
        // Session was explicitly revoked or user logged out
        // Block refresh and require re-authentication
        return res.status(401).json({
          message: 'Session has been revoked. Please sign in again.',
        });
      }
      
      // If session doesn't exist, is active, or doesn't have isActive property, allow refresh
      // This ensures backward compatibility with old sessions and new sessions
      if (process.env.NODE_ENV === 'development' && session) {
        console.log('[Refresh] Allowing refresh - session active or missing isActive', {
          sessionId: session.sessionId,
          isActive: session.isActive,
          hasIsActive: 'isActive' in session,
        });
      }
    } catch (sessionError) {
      // If session check fails for ANY reason, allow refresh to proceed (fail open)
      // This ensures backward compatibility and availability
      // Session management is an enhancement, not a requirement for authentication
      if (process.env.NODE_ENV === 'development') {
        console.error('[Refresh] Session check error (allowing refresh):', sessionError);
      }
      // Continue with refresh - don't block authentication
    }

    const user = await User.findOne({ userId: decoded.userId });

    if (!user) {
      return res.status(401).json({
        message: 'User not found',
      });
    }

    // Token rotation: Blacklist the old refresh token before issuing new ones
    // This prevents refresh token reuse (security best practice)
    await blacklistToken(
      refreshToken,
      user.userId,
      user.username,
      'refresh',
      'token_rotation'
    );

    // Generate new tokens and update session record
    await setAuthCookiesWithSession(req, res, user.userId, user.username, user.email);

    return res.status(200).json({
      message: 'Token refreshed successfully',
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    // Only log unexpected errors, not expected token validation failures
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isExpectedError = 
      errorMessage.includes('expired') ||
      errorMessage.includes('revoked') ||
      errorMessage.includes('Invalid refresh token') ||
      errorMessage.includes('Invalid token type');

    if (!isExpectedError) {
      console.error('Error in refresh API:', error);
    }

    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        return res.status(401).json({
          message: 'Refresh token expired. Please sign in again.',
        });
      }
      
      if (error.message.includes('revoked')) {
        return res.status(401).json({
          message: 'Refresh token has been revoked. Please sign in again.',
        });
      }
    }

    return res.status(401).json({
      message: 'Invalid refresh token',
      details: errorMessage
    });
  }
}

export default withWingmanDB(handler);
