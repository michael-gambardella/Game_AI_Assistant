import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { SaveTimerStateRequest } from '../../../types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; error?: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    const { username, remainingSeconds, breakIntervalMinutes }: SaveTimerStateRequest = req.body;

    if (!username || remainingSeconds === undefined) {
      return res.status(400).json({ 
        success: false,
        error: 'Username and remainingSeconds are required' 
      });
    }

    // Connect to database

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Initialize health monitoring if it doesn't exist
    if (!user.healthMonitoring) {
      user.healthMonitoring = {
        breakReminderEnabled: true,
        breakIntervalMinutes: breakIntervalMinutes || 45,
        totalSessionTime: 0,
        breakCount: 0,
        healthTipsEnabled: true,
        lastSessionStart: new Date(),
        isOnBreak: false
      };
    }

    // Save timer state to user's health monitoring
    // If remainingSeconds is 0, clear the timer state
    if (remainingSeconds <= 0) {
      user.healthMonitoring.timerState = undefined;
    } else {
      // Store as remaining seconds and timestamp for validation
      user.healthMonitoring.timerState = {
        remainingSeconds: Math.max(0, remainingSeconds),
        savedAt: new Date(),
        breakIntervalMinutes: breakIntervalMinutes || user.healthMonitoring.breakIntervalMinutes || 45
      };
    }

    await user.save();

    return res.status(200).json({
      success: true
    });

  } catch (error) {
    console.error('Error saving timer state:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
}

export default withDatabase(handler);
