import { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import { requireAdminUser } from '../../middleware/auth';
import User from '../../models/User';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Admin-only debugging tool: returns a user's full subscription record (Stripe IDs etc.)
  const admin = await requireAdminUser(req, res);
  if (!admin) return;

  try {
    const { username } = req.query;

    // String only - an object would be treated as a MongoDB query operator
    if (typeof username !== 'string' || !username) {
      return res.status(400).json({ message: 'Username is required' });
    }


    // Find the user
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      username: user.username,
      hasProAccess: user.hasProAccess,
      subscription: user.subscription,
      userId: user.userId
    });

  } catch (error) {
    console.error('Error fetching user subscription:', error);
    return res.status(500).json({ 
      message: 'Failed to fetch user subscription',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
