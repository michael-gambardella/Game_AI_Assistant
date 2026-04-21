import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { comparePassword } from '../../../utils/passwordUtils';
import { setAuthCookies, setAuthCookiesWithSession } from '../../../utils/session';
import {
  checkAccountLocked,
  trackFailedLoginAttempt,
  resetFailedLoginAttempts,
} from '../../../utils/accountLockout';
import { withRequestSizeLimit } from '../../../middleware/requestSizeLimit';

// Simple in-memory rate limiting for Next.js (no Express dependency)
const loginAttempts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now > record.resetTime) {
    // Reset or create new record
    loginAttempts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  return { allowed: true };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Simple rate limiting (get IP from headers)
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
             (req.headers['x-real-ip'] as string) || 
             req.socket.remoteAddress || 
             'unknown';
  
  const rateLimitCheck = checkRateLimit(ip);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      message: 'Too many login attempts. Please try again later.',
      retryAfter: rateLimitCheck.retryAfter,
    });
  }

  const { identifier, password } = req.body; // identifier can be username or email

  // Validate required fields
  if (!identifier) {
    return res.status(400).json({ 
      message: 'Username or email is required' 
    });
  }

  try {
    // Connect to database

    // Find user by username or email
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { email: identifier }
      ]
    });

    if (!user) {
      // Return generic error to prevent user enumeration
      // Still increment rate limit counter
      const rateLimitRecord = loginAttempts.get(ip);
      if (rateLimitRecord) {
        rateLimitRecord.count++;
      }
      return res.status(401).json({ 
        message: 'Invalid username/email or password' 
      });
    }

    // Check if account is locked BEFORE checking password
    const lockStatus = checkAccountLocked(user);
    if (lockStatus.isLocked) {
      // Return generic error to prevent user enumeration
      // Still increment rate limit counter
      const rateLimitRecord = loginAttempts.get(ip);
      if (rateLimitRecord) {
        rateLimitRecord.count++;
      }
      return res.status(403).json({
        message: lockStatus.message || 'Account is locked. Please check your email for unlock instructions.',
        accountLocked: true,
        lockedUntil: lockStatus.lockedUntil,
        requiresUnlock: lockStatus.requiresUnlock,
      });
    }

    // Check if user has a password (new user) or not (legacy user)
    if (!user.password) {
      // Legacy user - no password required for now
      // Return special flag to indicate password setup is needed
      const { password: _, ...userResponse } = user.toObject();
      
      // Set authentication cookies even for legacy users
      if (user.userId && user.username) {
        await setAuthCookiesWithSession(req, res, user.userId, user.username, user.email);
      }
      
      return res.status(200).json({
        message: 'Signed in successfully',
        user: userResponse,
        requiresPasswordSetup: true,
        isLegacyUser: true
      });
    }

    // New user with password - validate password
    if (!password) {
      return res.status(400).json({ 
        message: 'Password is required' 
      });
    }

    // Compare provided password with stored hash
    const isPasswordValid = await comparePassword(password, user.password);
    
    if (!isPasswordValid) {
      // Track failed login attempt (this may lock the account)
      await trackFailedLoginAttempt(user, ip);
      
      // Return generic error to prevent user enumeration
      // Check if account was just locked
      const updatedUser = await User.findById(user._id);
      if (updatedUser && updatedUser.isLocked) {
        const lockStatus = checkAccountLocked(updatedUser);
        return res.status(403).json({
          message: lockStatus.message || 'Account has been locked due to multiple failed login attempts. Please check your email for unlock instructions.',
          accountLocked: true,
          lockedUntil: lockStatus.lockedUntil,
          requiresUnlock: lockStatus.requiresUnlock,
        });
      }
      
      return res.status(401).json({ 
        message: 'Invalid username/email or password' 
      });
    }

    // Successful login - reset failed attempts
    await resetFailedLoginAttempts(user);

    // Successful authentication - set secure cookies with JWT tokens
    if (!user.userId || !user.username) {
      return res.status(500).json({
        message: 'User data is incomplete. Please contact support.'
      });
    }

    // Set authentication cookies (HTTP-only, secure) and create session record
    await setAuthCookiesWithSession(req, res, user.userId, user.username, user.email);

    // Debug: Log cookie headers in development
    // Commented out for production
    // if (process.env.NODE_ENV === 'development') {
    //   const setCookieHeaders = res.getHeader('Set-Cookie');
    //   const headerCount = Array.isArray(setCookieHeaders) ? setCookieHeaders.length : setCookieHeaders ? 1 : 0;
    //   console.log('[SignIn] Set-Cookie headers count:', headerCount);
    //   if (Array.isArray(setCookieHeaders)) {
    //     console.log('[SignIn] Cookie names:', setCookieHeaders.map(h => {
    //       const match = h.match(/^([^=]+)=/);
    //       return match ? match[1] : 'unknown';
    //     }));
    //   }
    // }

    // Successful authentication
    const { password: _, ...userResponse } = user.toObject();

    return res.status(200).json({
      message: 'Signed in successfully',
      user: userResponse,
      requiresPasswordSetup: false,
      isLegacyUser: false
    });

  } catch (error) {
    console.error('Error in signin API:', error);
    
    return res.status(500).json({
      message: 'Error signing in. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Apply request size limiting middleware to prevent DoS attacks
export default withRequestSizeLimit(withWingmanDB(handler));
