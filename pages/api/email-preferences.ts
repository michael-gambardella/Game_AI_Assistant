import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { username, weeklyDigestEnabled } = req.body;

    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username is required' 
      });
    }

    if (typeof weeklyDigestEnabled !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        error: 'weeklyDigestEnabled must be a boolean' 
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

    // Initialize weeklyDigest if it doesn't exist
    if (!user.weeklyDigest) {
      user.weeklyDigest = {
        enabled: true
      };
    }

    // Update email preference
    user.weeklyDigest.enabled = weeklyDigestEnabled;

    // Save user
    await user.save();

    return res.status(200).json({ 
      success: true, 
      message: 'Email preferences updated successfully',
      weeklyDigestEnabled: user.weeklyDigest.enabled
    });

  } catch (error) {
    console.error('Error updating email preferences:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}

export default withDatabase(handler);
