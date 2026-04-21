import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { verifyCrossDomainAuthToken } from '../../../utils/jwt';
import { setAuthCookiesWithDomain, setAuthCookies } from '../../../utils/session';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { token, userId, email } = req.body;

  try {
    // Connect to database

    let decoded;
    let user;

    // Try to verify token first
    try {
      decoded = verifyCrossDomainAuthToken(token);
      
      // Token is valid - verify user exists
      // Note: User model doesn't have isApproved field directly,
      // so we check it separately after finding the user
      user = await User.findOne({ 
        userId: decoded.userId, 
        email: decoded.email,
      });

      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Check if user is approved
      // Use isApproved from token if available, otherwise check user's access status
      const isApproved = decoded.isApproved !== undefined 
        ? decoded.isApproved 
        : user.subscription?.earlyAccessGranted || user.hasProAccess;

      if (!isApproved) {
        return res.status(403).json({ message: 'User is not approved' });
      }

    } catch (error) {
      // Token expired or invalid - fall back to userId/email verification
      if (userId && email) {
        // Verify user exists
        user = await User.findOne({ 
          userId, 
          email: email.trim().toLowerCase(),
        });

        if (!user) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check if user is approved
        const isApproved = user.subscription?.earlyAccessGranted || user.hasProAccess;
        if (!isApproved) {
          return res.status(403).json({ message: 'User is not approved' });
        }

      } else {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
    }

    // Ensure we have a user at this point
    if (!user || !user.userId || !user.username) {
      return res.status(500).json({ message: 'User data is incomplete' });
    }

    // Set HTTP-only cookie for main app domain
    // Use shared domain cookie for cross-domain authentication
    const domain = process.env.NODE_ENV === 'production' 
      ? '.videogamewingman.com' 
      : undefined; // Don't set domain in development (localhost)

    if (domain) {
      // Use cross-domain cookie setting
      setAuthCookiesWithDomain(res, user.userId, user.username, user.email, domain);
    } else {
      // In development, use regular cookie setting (no domain)
      setAuthCookies(res, user.userId, user.username, user.email);
    }

    return res.json({ 
      success: true, 
      user: { 
        userId: user.userId, 
        email: user.email,
        username: user.username
      } 
    });

  } catch (error) {
    console.error('Token exchange error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export default withWingmanDB(handler);
