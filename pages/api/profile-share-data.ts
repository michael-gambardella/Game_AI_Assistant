import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';
import { getTodaysChallenge, getTodayDateString } from '../../utils/challengeSelector';
import { Achievement } from '../../types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }


    const user = await User.findOne({ username }).select(
      'username avatarUrl achievements progress streak challengeProgress challengeStreak gameTracking'
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Extract favorite genres from personalized data
    const favoriteGenres =
      user.progress?.personalized?.preferenceProfile?.dominantGenres || [];

    // Get achievements
    const achievements = user.achievements || [];

    // Get streak
    const streak = user.streak?.currentStreak || 0;

    // Get current challenge
    let currentChallenge = undefined;
    const todayString = getTodayDateString();
    const todaysChallenge = getTodaysChallenge();

    // Check if user has progress for today's challenge
    if (
      user.challengeProgress &&
      user.challengeProgress.date === todayString &&
      user.challengeProgress.challengeId === todaysChallenge.id
    ) {
      currentChallenge = {
        title: todaysChallenge.title,
        description: todaysChallenge.description,
        icon: todaysChallenge.icon,
        completed: user.challengeProgress.completed || false,
        progress: user.challengeProgress.progress,
        target: user.challengeProgress.target,
      };
    } else {
      // Show today's challenge even if not started
      currentChallenge = {
        title: todaysChallenge.title,
        description: todaysChallenge.description,
        icon: todaysChallenge.icon,
        completed: false,
        progress: 0,
        target: todaysChallenge.criteria.type === 'count' 
          ? (todaysChallenge.criteria.value as number) 
          : 1,
      };
    }

    // Get game tracking data
    const gameTracking = user.gameTracking || {
      wishlist: [],
      currentlyPlaying: []
    };

    // Return profile data for sharing
    const profileData = {
      username: user.username,
      avatarUrl: user.avatarUrl || null,
      favoriteGenres,
      achievements: achievements.map((a: Achievement) => ({
        name: a.name,
        dateEarned: a.dateEarned ? new Date(a.dateEarned) : undefined,
      })),
      streak,
      currentChallenge,
      gameTracking,
    };

    return res.status(200).json(profileData);
  } catch (error) {
    console.error('Error fetching profile share data:', error);
    return res.status(500).json({
      message: 'Error fetching profile share data',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withWingmanDB(handler);
