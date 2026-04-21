import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }


    const user = await User.findOne({ username }).select('avatarUrl avatarHistory');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({
      currentAvatar: user.avatarUrl || null,
      recentAvatars: (user.avatarHistory || []).map((avatar: { url: string; uploadedAt: Date }) => ({
        url: avatar.url,
        uploadedAt: avatar.uploadedAt
      }))
    });
  } catch (error) {
    console.error('Error fetching recent avatars:', error);
    return res.status(500).json({
      error: 'Failed to fetch avatars',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
