import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }


    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get usage status using the method from User model
    const usageStatus = user.getUsageStatus();

    return res.status(200).json({
      usageStatus,
      hasProAccess: user.hasActiveProAccess()
    });
  } catch (error) {
    console.error('Error fetching usage status:', error);
    return res.status(500).json({
      message: 'Error fetching usage status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
