import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../utils/session';
import connectToMongoDB from '../../utils/mongodb';
import User from '../../models/User';
import { logger } from '../../utils/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session?.username) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { steamId } = req.body;

  if (!steamId || typeof steamId !== 'string' || !/^\d+$/.test(steamId)) {
    return res.status(400).json({ error: 'Invalid Steam ID' });
  }

  try {
    await connectToMongoDB();
    await User.findOneAndUpdate(
      { username: session.username },
      { steamId },
      { new: true }
    );

    logger.info('Steam ID linked to user account', { username: session.username, steamId });
    res.status(200).json({ success: true, steamId });
  } catch (error) {
    logger.error('Failed to link Steam ID', {
      error: error instanceof Error ? error.message : String(error),
      username: session.username
    });
    res.status(500).json({ error: 'Failed to save Steam ID' });
  }
}
