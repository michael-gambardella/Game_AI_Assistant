import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { SnoozeReminderResponse } from '../../../types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SnoozeReminderResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ 
        success: false,
        error: 'Username is required' 
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
        breakIntervalMinutes: 45,
        totalSessionTime: 0,
        breakCount: 0,
        healthTipsEnabled: true
      };
    }

    // Set snooze time (15 minutes from now)
    const snoozeUntil = new Date(Date.now() + 15 * 60 * 1000);
    user.healthMonitoring.lastBreakReminder = snoozeUntil;
    
    // Save the user
    await user.save();

    return res.status(200).json({
      success: true,
      snoozeUntil,
      message: 'Reminder snoozed for 15 minutes'
    });

  } catch (error) {
    console.error('Error snoozing reminder:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
}

export default withDatabase(handler);
