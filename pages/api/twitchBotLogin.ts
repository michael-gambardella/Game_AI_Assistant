import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthenticatedUser } from '../../middleware/auth';
import { createOAuthState, bindOAuthStateToBrowser } from '../../utils/oauthState';
import { withDatabase } from '../../utils/withDatabase';
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

  // The account being linked is the signed-in user. There used to be a ?username= fallback
  // "for expired sessions", which let anyone link their Twitch to someone else's account;
  // the client now refreshes the session before starting this flow instead.
  const signedIn = await getAuthenticatedUser(req);
  const username: string | null = signedIn?.username ?? null;
  if (username) {
    logger.info('Username obtained from session', { username });
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

  // Signed, expiring state naming the account to link (verified in twitchBotCallback).
  // The old "timestamp:username:random" state was trusted as-is, so anyone could craft one.
  const state = createOAuthState(username, 'twitch-bot');
  bindOAuthStateToBrowser(res, 'twitch-bot', state);

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
