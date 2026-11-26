import { NextApiRequest, NextApiResponse } from 'next';
import { createOAuthState, bindOAuthStateToBrowser } from '../../utils/oauthState';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get Discord OAuth configuration from environment variables
  const redirectUri = process.env.DISCORD_REDIRECT_URI || 'https://assistant.videogamewingman.com/api/discordCallback';
  const applicationId = process.env.DISCORD_APPLICATION_ID || '';

  // Get username from query parameter (passed from frontend)
  const username = req.query.username as string | undefined;

  // Validate username is provided
  if (!username) {
    return res.status(400).json({ 
      error: 'Username is required. Please ensure you are logged into Video Game Wingman.' 
    });
  }

  // Check for missing configuration
  if (!applicationId) {
    return res.status(500).json({ error: 'Missing DISCORD_APPLICATION_ID environment variable' });
  }

  // Signed, expiring state tied to this browser by a cookie (verified in discordCallback).
  // Kept out of server memory so a restart or a second dyno mid-login doesn't break it.
  const state = createOAuthState(username, 'discord');
  bindOAuthStateToBrowser(res, 'discord', state);

  // Prepare OAuth URL parameters
  const encodedRedirectUri = encodeURIComponent(redirectUri);
  const scope = 'identify email guilds';  // Required Discord permissions

  // Construct Discord OAuth authorization URL
  // Add prompt=consent to force Discord to show login screen even if user is already logged in
  // This prevents account mixing when another Discord account is already logged into the browser
  const discordLoginUrl = `https://discord.com/api/oauth2/authorize?client_id=${applicationId}&redirect_uri=${encodedRedirectUri}&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}&prompt=consent`;

  // Redirect user to Discord OAuth page
  res.redirect(discordLoginUrl);
}
