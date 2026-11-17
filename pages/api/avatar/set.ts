import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '../../../middleware/auth';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Identity comes from the signed-in session, never the request (middleware/auth.ts)
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const { username } = authUser;
    const { avatarUrl } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    if (!avatarUrl) {
      return res.status(400).json({ error: 'Avatar URL is required' });
    }


    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify the avatar URL is in the user's history
    const avatarHistory = user.avatarHistory || [];
    const isValidAvatar = avatarHistory.some((avatar: { url: string; uploadedAt: Date }) => avatar.url === avatarUrl);

    if (!isValidAvatar) {
      return res.status(400).json({ error: 'Avatar URL not found in your recent avatars' });
    }

    // Set as current avatar
    user.avatarUrl = avatarUrl;
    await user.save();

    return res.status(200).json({
      success: true,
      avatarUrl: user.avatarUrl
    });
  } catch (error) {
    console.error('Error setting avatar:', error);
    return res.status(500).json({
      error: 'Failed to set avatar',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
