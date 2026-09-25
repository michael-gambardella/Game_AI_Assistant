import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';
import Question from '../../models/Question';
import { getSession } from '../../utils/session';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Identity comes from the auth cookie, never the request body - otherwise anyone could
  // fetch another user's email, subscription and account details by guessing a username.
  const session = await getSession(req);
  if (!session?.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    // Look up by the token's stable userId, not its username - usernames can be changed
    // after the token was issued.
    const user = await User.findOne({ userId: session.userId }).select('-__v');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Count actual Question documents for accurate conversation count
    const actualConversationCount = await Question.countDocuments({ username: user.username });

    // Return user data without sensitive information
    const userData = {
      user: {
        username: user.username,
        email: user.email,
        hasPassword: !!user.password, // Boolean only - never send the hash to the client
        conversationCount: actualConversationCount, // Use actual count instead of user.conversationCount
        hasProAccess: user.hasProAccess,
        achievements: user.achievements || [],
        challengeRewards: user.challengeRewards || [],
        progress: user.progress || {},
        subscription: user.subscription || null,
        healthMonitoring: user.healthMonitoring || null,
        gameTracking: user.gameTracking || { wishlist: [], currentlyPlaying: [] },
        weeklyDigest: user.weeklyDigest || { enabled: true },
        twitchUsername: user.twitchUsername || null,
        twitchId: user.twitchId || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    };

    return res.status(200).json(userData);
  } catch (error) {
    console.error('Error fetching account data:', error);
    return res.status(500).json({
      message: 'Error fetching account data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
