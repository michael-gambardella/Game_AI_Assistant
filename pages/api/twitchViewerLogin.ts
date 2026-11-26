import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthenticatedUser } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { createOAuthState, bindOAuthStateToBrowser } from '../../utils/oauthState';

/**
 * Viewer OAuth login endpoint for linking Twitch accounts
 * This is specifically for viewers who want to link their Twitch account
 * to their Video Game Wingman account for bot usage
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The account being linked is the signed-in user. There used to be a ?username= fallback
  // "for expired sessions", which let anyone link their Twitch to someone else's account;
  // the client now refreshes the session before starting this flow instead.
  const signedIn = await getAuthenticatedUser(req);
  const username: string | null = signedIn?.username ?? null;
  if (username) {
    logger.info('Username obtained from session for viewer OAuth', { username });
  }

  if (!username) {
    const domain = process.env.NODE_ENV === 'production'
      ? 'https://assistant.videogamewingman.com'
      : 'http://localhost:3000';
    const errorUrl = new URL('/twitch-viewer-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'login_required');
    return res.redirect(errorUrl.toString());
  }

  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || '';
  
  if (!clientId) {
    return res.status(500).json({ 
      error: 'Missing NEXT_PUBLIC_TWITCH_CLIENT_ID environment variable',
      instructions: 'Make sure NEXT_PUBLIC_TWITCH_CLIENT_ID is set in your .env file'
    });
  }

  const domain = process.env.NODE_ENV === 'production'
    ? 'https://assistant.videogamewingman.com'
    : 'http://localhost:3000';

  // Use dedicated callback route for viewer authorization
  let redirectUri = `${domain}/api/twitchViewerCallback`;

  // Ensure no trailing slash and no double slashes in the URI (except after "https://")
  redirectUri = redirectUri.replace(/\/$/, '').replace(/([^:]\/)\/+/g, "$1");

  // Encode the redirect URI
  const encodedRedirectUri = encodeURIComponent(redirectUri);

  const authUrl = process.env.TWITCH_AUTH_URL || 'https://id.twitch.tv/oauth2/authorize';
  
  // Viewer scopes needed for bot usage (minimal permissions)
  const scopes = [
    'user:read:email'
  ].join(' ');

  // Signed, expiring state tied to this browser by a cookie (verified in twitchViewerCallback).
  // Kept out of server memory so a restart or a second dyno mid-login doesn't break it.
  const state = createOAuthState(username, 'twitch-viewer');
  bindOAuthStateToBrowser(res, 'twitch-viewer', state);

  // Construct the Twitch OAuth2 authorization URL
  const encodedState = encodeURIComponent(state);
  const twitchAuthUrl = `${authUrl}?response_type=code&client_id=${clientId}&redirect_uri=${encodedRedirectUri}&scope=${encodeURIComponent(scopes)}&state=${encodedState}&force_verify=true`;

  logger.info('Redirecting to Twitch OAuth for viewer account linking', {
    username,
    redirectUri,
    stateLength: state.length,
    statePreview: state.substring(0, 50) + '...',
    encodedStateLength: encodedState.length
  });

  // Redirect to Twitch OAuth
  res.redirect(twitchAuthUrl);
}
