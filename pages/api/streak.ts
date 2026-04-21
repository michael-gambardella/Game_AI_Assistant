import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username } = req.query;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {

    const user = await User.findOne({ username }).select('streak');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const streakStatus = await user.syncStreakStatus();

    return res.status(200).json({
      currentStreak: streakStatus.currentStreak,
      longestStreak: streakStatus.longestStreak,
      lastActivityDate: streakStatus.lastActivityDate
    });
  } catch (error) {
    console.error('Error fetching streak:', error);
    return res.status(500).json({ error: 'Failed to fetch streak' });
  }
}

export default withDatabase(handler);
