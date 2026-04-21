import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import {
  verifyUnlockToken,
  unlockAccount,
} from '../../../utils/accountLockout';

/**
 * API endpoint to unlock a user account using an unlock token
 * POST /api/auth/unlock-account
 * Body: { token: string }
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { token } = req.body;

  // Validate token
  if (!token || typeof token !== 'string') {
    return res.status(400).json({
      message: 'Unlock token is required',
    });
  }

  try {
    // Connect to database

    // Find user with matching unlock token
    const user = await User.findOne({
      unlockToken: token,
      isLocked: true,
    });

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired unlock token',
      });
    }

    // Verify token is valid and not expired
    if (!verifyUnlockToken(user, token)) {
      return res.status(400).json({
        message: 'Invalid or expired unlock token',
      });
    }

    // Unlock the account
    await unlockAccount(user, 'email_verification');

    // Log successful unlock
    console.log(
      `[SECURITY] Account unlocked via email: userId=${user.userId}, username=${user.username}`
    );

    return res.status(200).json({
      message: 'Account unlocked successfully. You can now log in.',
      success: true,
    });
  } catch (error) {
    console.error('Error in unlock-account API:', error);

    return res.status(500).json({
      message: 'Error unlocking account. Please try again or contact support.',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withWingmanDB(handler);
