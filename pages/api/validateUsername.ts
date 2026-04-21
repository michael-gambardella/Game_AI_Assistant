import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Check if username exists in the database
    const user = await User.findOne({ username: username.trim() });
    
    if (!user) {
      return res.status(404).json({ 
        error: 'Username not found',
        exists: false 
      });
    }

    return res.status(200).json({ 
      message: 'Username exists',
      exists: true,
      username: user.username
    });
  } catch (error) {
    console.error('Error validating username:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withDatabase(handler);
