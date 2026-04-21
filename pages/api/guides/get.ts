import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }


    const user = await User.findOne({ username }).select('guides');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Return guides array (empty array if none exist)
    const guides = user.guides || [];

    // Sort by savedAt date (most recent first)
    const sortedGuides = [...guides].sort((a: any, b: any) => {
      const dateA = new Date(a.savedAt).getTime();
      const dateB = new Date(b.savedAt).getTime();
      return dateB - dateA; // Descending order (newest first)
    });

    return res.status(200).json({
      success: true,
      guides: sortedGuides,
      totalGuides: sortedGuides.length
    });
  } catch (error) {
    console.error('Error fetching guides:', error);
    return res.status(500).json({
      message: 'Error fetching guides',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
