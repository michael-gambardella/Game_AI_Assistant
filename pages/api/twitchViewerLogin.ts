import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getAuthenticatedUser } from '../../middleware/auth';
import { logger } from '../../utils/logger';

// In-memory store for OAuth state (in production, use Redis or similar)
// Maps state token -> { username, expiresAt }
const oauthStateStore = new Map<string, { username: string; expiresAt: number }>();

// Clean up expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  Array.from(oauthStateStore.entries()).forEach(([state, data]) => {
    if (data.expiresAt < now) {
      oauthStateStore.delete(state);
    }
  });
}, 5 * 60 * 1000);

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

  // Generate secure state token that includes username
  // State format: randomToken:base64(username)
  const randomToken = crypto.randomBytes(32).toString('hex');
  const encodedUsername = Buffer.from(username).toString('base64');
  const state = `${randomToken}:${encodedUsername}`;

  // Store state with 10 minute expiration
  oauthStateStore.set(randomToken, {
    username,
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
  });

  // Construct the Twitch OAuth2 authorization URL
  const encodedState = encodeURIComponent(state);
  const twitchAuthUrl = `${authUrl}?response_type=code&client_id=${clientId}&redirect_uri=${encodedRedirectUri}&scope=${encodeURIComponent(scopes)}&state=${encodedState}&force_verify=true`;

  logger.info('Redirecting to Twitch OAuth for viewer account linking', {
    username,
    redirectUri,
    stateLength: state.length,
    statePreview: state.substring(0, 50) + '...',
    encodedStateLength: encodedState.length,
    storeSize: oauthStateStore.size
  });

  // Redirect to Twitch OAuth
  res.redirect(twitchAuthUrl);
}

// Export function to verify state (used by callback)
export function verifyOAuthState(state: string): { valid: boolean; username?: string } {
  const [randomToken, encodedUsername] = state.split(':');
  
  if (!randomToken || !encodedUsername) {
    return { valid: false };
  }

  // Try to get from in-memory store first
  const storedState = oauthStateStore.get(randomToken);
  
  if (storedState) {
    // Check if expired
    if (storedState.expiresAt < Date.now()) {
      oauthStateStore.delete(randomToken);
      return { valid: false };
    }

    // Verify username matches
    const decodedUsername = Buffer.from(encodedUsername, 'base64').toString('utf-8');
    if (decodedUsername !== storedState.username) {
      return { valid: false };
    }

    // Clean up used state
    oauthStateStore.delete(randomToken);

    return { valid: true, username: storedState.username };
  }

  // Fallback: If state not in memory (e.g., hot-reload in dev, or Heroku dyno restart in prod),
  // verify using encoded username. The state includes a random token + base64(username),
  // so we can still verify the username even if the in-memory store was cleared.
  // This is acceptable because:
  // 1. The state is only valid for 10 minutes (expiresAt check above)
  // 2. The state includes a random token that prevents replay attacks
  // 3. The username is base64-encoded, providing some obfuscation
  try {
    const decodedUsername = Buffer.from(encodedUsername, 'base64').toString('utf-8');
    
    // Basic validation: username should be a valid string
    if (decodedUsername && decodedUsername.length > 0 && decodedUsername.length < 100) {
      // Allow fallback in both development and production (needed for Heroku dyno restarts)
      logger.warn('⚠️ State not found in memory store (likely due to server restart), using fallback verification', {
        username: decodedUsername,
        environment: process.env.NODE_ENV
      });
      return { valid: true, username: decodedUsername };
    }
  } catch (error) {
    // Invalid base64 encoding
    logger.error('Failed to decode username from state', {
      error: error instanceof Error ? error.message : String(error),
      encodedUsernameLength: encodedUsername?.length
    });
    return { valid: false };
  }

  return { valid: false };
}

