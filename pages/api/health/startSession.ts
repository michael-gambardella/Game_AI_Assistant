import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '../../../middleware/auth';
import { withDatabase } from '../../../utils/withDatabase';
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
    const { sessionStartTime } = req.body;

    if (!username || !sessionStartTime) {
      return res.status(400).json({ 
        error: 'Username and sessionStartTime are required' 
      });
    }

    // Connect to database

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Initialize health monitoring if it doesn't exist
    if (!user.healthMonitoring) {
      user.healthMonitoring = {
        breakReminderEnabled: true,
        breakIntervalMinutes: 45,
        totalSessionTime: 0,
        breakCount: 0,
        healthTipsEnabled: true,
        lastSessionStart: new Date(),
        isOnBreak: false
      };
    }

    // Update session start time
    user.healthMonitoring.lastSessionStart = new Date(sessionStartTime);
    user.healthMonitoring.isOnBreak = false; // Reset break status when starting new session
    user.healthMonitoring.breakStartTime = undefined;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Session started successfully',
      sessionStartTime: user.healthMonitoring.lastSessionStart
    });

  } catch (error) {
    console.error('Error starting session:', error);
    return res.status(500).json({ 
      error: 'Internal server error' 
    });
  }
}

export default withDatabase(handler);
