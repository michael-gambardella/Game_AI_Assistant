import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { hashPassword, validatePassword } from '../../../utils/passwordUtils';
import { containsOffensiveContent } from '../../../utils/contentModeration';
import { handleContentViolation } from '../../../utils/violationHandler';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { userId, username, password } = req.body;

  if (!userId || !username) {
    return res.status(400).json({ message: 'User ID and username are required' });
  }

  try {

    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has early access
    const hasEarlyAccess = user.subscription?.earlyAccessGranted || user.hasProAccess;
    if (!hasEarlyAccess) {
      return res.status(403).json({ message: 'User does not have early access' });
    }

    // Validate username
    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ message: 'Username must be between 3 and 32 characters' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ message: 'Username can only contain letters, numbers, underscores, and hyphens' });
    }

    // Check if username is already taken
    const existingUser = await User.findOne({ username });
    if (existingUser && existingUser.userId !== userId) {
      return res.status(409).json({ message: 'Username is already taken' });
    }

    // Check for offensive content in username
    const contentCheck = await containsOffensiveContent(username, userId);
    if (contentCheck.isOffensive) {
      const violationResult = await handleContentViolation(username, contentCheck.offendingWords);
      let errorMessage = 'Username contains offensive content. Please try a different username.';
      if (violationResult.action === 'warning') {
        errorMessage = `Username contains inappropriate content: "${contentCheck.offendingWords.join(', ')}". Warning ${violationResult.count}/3. Please choose a different username.`;
      } else if (violationResult.action === 'banned') {
        const banDate = new Date(violationResult.expiresAt).toLocaleDateString();
        errorMessage = `Username contains inappropriate content. You are temporarily banned until ${banDate}. Please try again later.`;
      } else if (violationResult.action === 'permanent_ban') {
        errorMessage = `Username contains inappropriate content. You are permanently banned from using this application.`;
      }
      return res.status(400).json({
        message: errorMessage,
        offendingWords: contentCheck.offendingWords,
        violationResult
      });
    }

    // Update user with username
    user.username = username;

    // If password is provided, validate and hash it
    if (password) {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({ message: passwordValidation.message });
      }

      user.password = await hashPassword(password);
      user.requiresPasswordSetup = false;
    }

    await user.save();

    return res.status(200).json({
      message: 'Early access setup completed successfully',
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        hasProAccess: user.hasProAccess,
        subscription: user.subscription,
        requiresPasswordSetup: !user.password,
      },
    });
  } catch (error) {
    console.error('Error in early access setup:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export default withWingmanDB(handler);
