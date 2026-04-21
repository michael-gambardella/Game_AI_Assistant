import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { syncUserData } from '../../../utils/proAccessUtil';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { userId, email } = req.body;

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  try {

    // Sync user data from splash page
    await syncUserData(userId, email);

    // Refetch the user after sync to ensure we have the latest data (Pro access, password setup, etc.)
    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({ message: 'User not found after sync' });
    }

    // Security: Verify email matches if provided
    if (email) {
      const normalizedEmail = email.trim().toLowerCase();
      const userEmail = user.email?.trim().toLowerCase();
      
      if (userEmail && userEmail !== normalizedEmail) {
        console.error('Email mismatch in splash-login:', {
          providedEmail: normalizedEmail,
          userEmail: userEmail,
          userId: userId
        });
        return res.status(403).json({ 
          message: 'Email does not match user account. Please use the correct link for your account.' 
        });
      }
    }

    // Check if user has early access
    const hasEarlyAccess = user.subscription?.earlyAccessGranted || user.hasProAccess;

    if (!hasEarlyAccess) {
      return res.status(403).json({ message: 'User does not have early access' });
    }

    // Return user data for automatic sign-in
    // Check requiresPasswordSetup from database field, or fallback to checking if password exists
    const needsPasswordSetup = user.requiresPasswordSetup !== undefined 
      ? user.requiresPasswordSetup 
      : !user.password;
    
    return res.status(200).json({
      message: 'Early access user authenticated successfully',
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        hasProAccess: user.hasProAccess,
        subscription: user.subscription,
        requiresPasswordSetup: needsPasswordSetup, // Flag if they need to set up password
        requiresUsernameSetup: !user.username || user.username === userId, // Flag if they need to set up username
      },
      isEarlyAccessUser: true,
    });
  } catch (error) {
    console.error('Error in splash login:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export default withWingmanDB(handler);
