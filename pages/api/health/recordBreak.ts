import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { RecordBreakResponse } from '../../../types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RecordBreakResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      breakCount: 0,
      error: 'Method not allowed' 
    });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ 
        success: false,
        breakCount: 0,
        error: 'Username is required' 
      });
    }

    // Connect to database

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        breakCount: 0,
        error: 'User not found' 
      });
    }

    // Record the break
    user.recordBreak();
    
    // Save the user
    await user.save();

    return res.status(200).json({
      success: true,
      breakCount: user.healthMonitoring?.breakCount || 0,
      message: 'Break recorded successfully'
    });

  } catch (error) {
    console.error('Error recording break:', error);
    return res.status(500).json({ 
      success: false,
      breakCount: 0,
      error: 'Internal server error' 
    });
  }
}

export default withDatabase(handler);
