import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { verifyCrossDomainAuthToken } from '../../../utils/jwt';
import { setAuthCookiesWithDomain, setAuthCookies } from '../../../utils/session';
import { claimSingleUseToken } from '../../../utils/tokenBlacklist';
import { syncUserData } from '../../../utils/proAccessUtil';

/**
 * Exchanges a splash-page sign-in link token for session cookies.
 *
 * The signed token is the only accepted proof of identity. There is deliberately no
 * userId/email fallback: those aren't secrets, so accepting them would let anyone who
 * knew (or guessed) them sign in as that user. Each token works once; an expired or used
 * link sends the user to sign in normally or to request a new link from the splash page.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { token } = req.body;

  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ message: 'Token is required' });
  }

  let decoded;
  try {
    decoded = verifyCrossDomainAuthToken(token);
  } catch (error) {
    const expired = error instanceof Error && error.message === 'Token expired';
    return res.status(401).json({
      message: expired
        ? 'This sign-in link has expired. Please sign in, or request a new link.'
        : 'Invalid sign-in link.',
    });
  }

  try {
    // Refresh early-access/Pro status from the splash DB. userId-only (never pass the
    // email): syncUserData trusts its email argument. Best-effort - don't block sign-in.
    try {
      await syncUserData(decoded.userId);
    } catch (syncError) {
      console.error('exchange-token: syncUserData failed', syncError);
    }

    const user = await User.findOne({
      userId: decoded.userId,
      email: decoded.email,
    });

    if (!user || !user.userId || !user.username) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Approval can be revoked after a link is issued, so check the current record too
    const isApproved = decoded.isApproved !== false &&
      (user.subscription?.earlyAccessGranted || user.hasProAccess);

    if (!isApproved) {
      return res.status(403).json({ message: 'User is not approved' });
    }

    // Single use: record the token before issuing a session. Kept until the token's own
    // expiry, after which it can't verify anyway and cleanup removes the record.
    const expiresAt = decoded.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const claimed = await claimSingleUseToken(token, user.userId, user.username, expiresAt);
    if (!claimed) {
      return res.status(401).json({
        message: 'This sign-in link has already been used. Please sign in, or request a new link.',
      });
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

    const requiresPasswordSetup = user.requiresPasswordSetup !== undefined
      ? user.requiresPasswordSetup
      : !user.password;

    return res.json({
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        username: user.username,
        // Lets the client show the early-access setup modal (now that the user is signed in)
        requiresPasswordSetup,
        requiresUsernameSetup: user.username === user.userId,
      }
    });

  } catch (error) {
    console.error('Token exchange error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export default withWingmanDB(handler);
