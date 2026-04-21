import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../utils/session';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import { logger } from '../../utils/logger';

/**
 * API endpoint to unlink a Twitch account from a user's Video Game Wingman account
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get username from session
    const session = await getSession(req);
    if (!session || !session.username) {
      return res.status(401).json({ 
        success: false,
        message: 'You must be logged in to unlink your Twitch account' 
      });
    }

    const username = session.username;

    // Connect to database

    // Find user and check if they have a linked Twitch account
    const user = await User.findOne({ username }).select('username twitchUsername twitchId').lean() as {
      username: string;
      twitchUsername?: string;
      twitchId?: string;
    } | null;
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    if (!user.twitchUsername || !user.twitchId) {
      return res.status(400).json({ 
        success: false,
        message: 'No Twitch account is currently linked' 
      });
    }

    // Unlink the Twitch account
    await User.findOneAndUpdate(
      { username },
      {
        $unset: {
          twitchUsername: '',
          twitchId: ''
        }
      }
    );

    logger.info('Twitch account unlinked', {
      username,
      twitchUsername: user.twitchUsername,
      twitchId: user.twitchId
    });

    return res.status(200).json({ 
      success: true,
      message: 'Twitch account unlinked successfully' 
    });

  } catch (error) {
    logger.error('Error unlinking Twitch account', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return res.status(500).json({ 
      success: false,
      message: 'An error occurred while unlinking your Twitch account' 
    });
  }
}

export default withDatabase(handler);
