import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import Question from '../../models/Question';

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

    const user = await User.findOne({ username }).select('streak conversationCount');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate questions asked today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const questionsToday = await Question.countDocuments({
      username,
      timestamp: {
        $gte: today,
        $lt: tomorrow
      }
    });

    // Get total questions (use actual count from Question model for accuracy)
    const totalQuestions = await Question.countDocuments({ username });

    const streakStatus = await user.syncStreakStatus();

    return res.status(200).json({
      questionsToday,
      totalQuestions,
      currentStreak: streakStatus.currentStreak,
      longestStreak: streakStatus.longestStreak
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

export default withDatabase(handler);
