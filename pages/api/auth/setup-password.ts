import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { hashPassword, validatePassword, comparePassword } from '../../../utils/passwordUtils';
import { getSession } from '../../../utils/session';

/**
 * Sets or changes the signed-in user's password.
 *
 * - No password yet: sets one (e.g. an early-access user who skipped setup).
 * - Password already set: `currentPassword` must be supplied and correct.
 *
 * Identity comes from the auth cookie only. This route used to accept a userId + username
 * in the request and set a password on any passwordless account - i.e. anyone could
 * claim one. Users without a session (legacy accounts) set a password through the emailed
 * reset code instead (/forgot-password).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session?.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const { newPassword, currentPassword } = req.body;

  if (typeof newPassword !== 'string' || !newPassword) {
    return res.status(400).json({ message: 'New password is required' });
  }
  if (currentPassword !== undefined && typeof currentPassword !== 'string') {
    return res.status(400).json({ message: 'Invalid current password' });
  }

  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    return res.status(400).json({ message: passwordValidation.message });
  }

  try {
    const user = await User.findOne({ userId: session.userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required to change your password' });
      }
      const matches = await comparePassword(currentPassword, user.password);
      if (!matches) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }
    }

    const hadPassword = !!user.password;
    user.password = await hashPassword(newPassword);
    user.requiresPasswordSetup = false;
    await user.save();

    return res.status(200).json({
      message: hadPassword
        ? 'Your password has been changed.'
        : 'Password has been set successfully. Your account is now secured.',
      user: { userId: user.userId, username: user.username, email: user.email },
    });
  } catch (error) {
    console.error('Error in setup-password API:', error);
    return res.status(500).json({ message: 'Error setting up password. Please try again.' });
  }
}

export default withWingmanDB(handler);
