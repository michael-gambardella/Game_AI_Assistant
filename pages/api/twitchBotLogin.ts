import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../utils/session';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import { logger } from '../../utils/logger';

/**
 * Streamer OAuth login endpoint
 * This initiates OAuth flow for streamers who want to add the bot to their Twitch channel
 * Requires the streamer to be logged into Video Game Wingman
 * 
 * Accepts username as query parameter as fallback if session is expired
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let username: string | null = null;

  // Try to get username from session first
  try {
    const session = await getSession(req);
    if (session && session.username) {
      username = session.username;
      logger.info('Username obtained from session', { username });
    }
  } catch (error) {
    logger.warn('Session check failed, will try username parameter', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Fallback: Get username from query parameter (for cases where session expired but user is logged in on frontend)
  if (!username) {
    const usernameParam = req.query.username as string | undefined;
    if (usernameParam) {
      // Verify username exists in database
      try {
        const user = await User.findOne({ username: usernameParam }).select('username').lean();
        if (user) {
          username = usernameParam;
          logger.info('Username obtained from query parameter', { username });
        } else {
          logger.warn('Username from query parameter not found in database', { usernameParam });
        }
      } catch (error) {
        logger.error('Error verifying username from query parameter', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  if (!username) {
    // Redirect to landing page with error message
    const domain = process.env.NODE_ENV === 'production'
      ? 'https://assistant.videogamewingman.com'
      : 'http://localhost:3000';
    const errorUrl = new URL('/twitch-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'login_required');
    return res.redirect(errorUrl.toString());
  }

  const domain = process.env.NODE_ENV === 'production'
    ? 'https://assistant.videogamewingman.com'
    : 'http://localhost:3000';

  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || '';
  
  // Use a specific callback route for streamer authorization
  let redirectUri = `${domain}/api/twitchBotCallback`;

  // Ensure no trailing slash and no double slashes in the URI (except after "https://")
  redirectUri = redirectUri.replace(/\/$/, '').replace(/([^:]\/)\/+/g, "$1");

  // Encode the redirect URI
  const encodedRedirectUri = encodeURIComponent(redirectUri);

  const authUrl = process.env.TWITCH_AUTH_URL || 'https://id.twitch.tv/oauth2/authorize';
  
  // Streamer scopes needed for bot to join and moderate their channel
  const scopes = [
    'chat:read',
    'chat:edit',
    'channel:moderate',
    'user:read:email'
  ].join(' ');

  // Create state parameter to prevent CSRF and link to Video Game Wingman username
  // State format: timestamp:username:random
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const state = `${timestamp}:${username}:${random}`;
  
  // Store state in session/cookie for verification (optional, we can also verify via username in state)
  // For now, we'll verify via state parameter in callback

  // Construct the Twitch OAuth2 authorization URL
  const twitchAuthUrl = `${authUrl}?response_type=code&client_id=${clientId}&redirect_uri=${encodedRedirectUri}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;

  if (!clientId) {
    return res.status(500).json({ 
      error: 'Missing NEXT_PUBLIC_TWITCH_CLIENT_ID environment variable',
      instructions: 'Make sure NEXT_PUBLIC_TWITCH_CLIENT_ID is set in your .env file'
    });
  }

  // Redirect to Twitch OAuth
  res.redirect(twitchAuthUrl);
}

export default withDatabase(handler);
