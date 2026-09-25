import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';
import { getSession } from '../../utils/session';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Identity comes from the auth cookie, never the request body - otherwise anyone could
  // read another user's lists (including private spoiler-safe progress notes).
  const session = await getSession(req);
  if (!session?.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const user = await User.findOne({ userId: session.userId }).select('gameTracking');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Return game tracking data (default to empty arrays if not set)
    const gameTracking = user.gameTracking || {
      wishlist: [],
      currentlyPlaying: []
    };

    return res.status(200).json({
      success: true,
      gameTracking
    });
  } catch (error) {
    console.error('Error fetching game tracking:', error);
    return res.status(500).json({
      message: 'Error fetching game tracking',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
