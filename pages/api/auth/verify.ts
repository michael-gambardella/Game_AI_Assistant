import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { verifyAccessToken } from '../../../utils/jwt';
import { getTokenFromCookies, ACCESS_TOKEN_COOKIE } from '../../../utils/session';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Get auth token from cookie using the existing utility
    const authToken = getTokenFromCookies(req.headers.cookie, ACCESS_TOKEN_COOKIE);

    // If no token, user is not authenticated
    if (!authToken) {
      return res.status(401).json({
        authenticated: false,
        message: 'No authentication token found'
      });
    }

    // Verify token (now includes blacklist check)
    let decoded: any;
    try {
      decoded = await verifyAccessToken(authToken);
    } catch (error) {
      // Token is invalid, expired, or revoked
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(401).json({
        authenticated: false,
        message: errorMessage.includes('revoked') 
          ? 'Token has been revoked' 
          : 'Invalid or expired token'
      });
    }

    // Connect to database if needed

    // Find user by userId from token
    const user = await User.findOne({ userId: decoded.userId }).lean() as any;

    if (!user) {
      return res.status(401).json({
        authenticated: false,
        message: 'User not found'
      });
    }

    // Check if user is approved (for early access)
    // User model doesn't have direct isApproved field, check via subscription/access
    const isApproved = user.subscription?.earlyAccessGranted || user.hasProAccess;

    if (!isApproved) {
      return res.status(403).json({
        authenticated: false,
        message: 'User not approved for early access'
      });
    }

    // User is authenticated
    return res.status(200).json({
      authenticated: true,
      user: {
        userId: user.userId,
        email: user.email,
        username: user.username,
        hasProAccess: user.hasProAccess || false,
        isApproved: isApproved
      }
    });

  } catch (error) {
    console.error('Error in verify API:', error);
    return res.status(500).json({
      authenticated: false,
      message: 'Error verifying authentication',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
