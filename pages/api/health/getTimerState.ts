import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import User from '../../../models/User';

interface TimerState {
  remainingSeconds: number;
  savedAt: number;
  breakIntervalMinutes: number;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ 
    timerState: TimerState | null; 
    error?: string 
  }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      timerState: null,
      error: 'Method not allowed' 
    });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ 
        timerState: null,
        error: 'Username is required' 
      });
    }

    // Connect to database

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ 
        timerState: null,
        error: 'User not found' 
      });
    }

    // Check if user has timer state saved
    if (!user.healthMonitoring?.timerState) {
      return res.status(200).json({
        timerState: null
      });
    }

    const timerState = user.healthMonitoring.timerState;
    const now = Date.now();
    const savedAt = new Date(timerState.savedAt).getTime();
    const timeSinceSave = now - savedAt;
    const twentyFourHours = 24 * 60 * 60 * 1000;

    // Check if timer state is expired (24+ hours old)
    if (timeSinceSave >= twentyFourHours) {
      // Clear expired timer state
      user.healthMonitoring.timerState = undefined;
      await user.save();
      return res.status(200).json({
        timerState: null
      });
    }

    // Return valid timer state
    return res.status(200).json({
      timerState: {
        remainingSeconds: timerState.remainingSeconds,
        savedAt: savedAt,
        breakIntervalMinutes: timerState.breakIntervalMinutes
      }
    });

  } catch (error) {
    console.error('Error getting timer state:', error);
    return res.status(500).json({ 
      timerState: null,
      error: 'Internal server error' 
    });
  }
}

export default withDatabase(handler);
