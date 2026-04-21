import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { unlockAccount } from '../../../utils/accountLockout';
import { requireAuth } from '../../../middleware/auth';

/**
 * API endpoint for admins to unlock user accounts
 * POST /api/auth/admin-unlock-account
 * Body: { userId: string } or { username: string } or { email: string }
 * 
 * Note: This endpoint requires authentication. You may want to add admin role checking.
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Require authentication (admin should be logged in)
    const authResult = await requireAuth(req, res);
    if (!authResult.authenticated) {
      return res.status(401).json({
        message: 'Authentication required',
      });
    }

    const { userId, username, email } = req.body;

    // Validate input
    if (!userId && !username && !email) {
      return res.status(400).json({
        message: 'Either userId, username, or email is required',
      });
    }

    // Connect to database

    // Find user
    const query: any = {};
    if (userId) query.userId = userId;
    if (username) query.username = username;
    if (email) query.email = email;

    const user = await User.findOne(query);

    if (!user) {
      return res.status(404).json({
        message: 'User not found',
      });
    }

    // Check if account is actually locked
    if (!user.isLocked) {
      return res.status(400).json({
        message: 'Account is not locked',
      });
    }

    // Unlock the account
    await unlockAccount(user, 'admin_unlock');

    // Log admin unlock
    console.log(
      `[SECURITY] Account unlocked by admin: userId=${user.userId}, ` +
        `username=${user.username}, unlockedBy=${authResult.username}`
    );

    return res.status(200).json({
      message: 'Account unlocked successfully',
      success: true,
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Error in admin-unlock-account API:', error);

    return res.status(500).json({
      message: 'Error unlocking account. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withWingmanDB(handler);
