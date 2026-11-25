import { NextApiRequest, NextApiResponse } from 'next';
import { getDiscordOAuth2Token, fetchDiscordUser } from '../../utils/discordAuth';
import { syncUserData } from '../../utils/proAccessUtil';
import { logger } from '../../utils/logger';
import { verifyOAuthState } from './discordLogin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check request method
  if (req.method !== 'GET') {
    logger.error('Invalid request method', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Log all environment variables (redacted)
  logger.info('Environment check', {
    hasApplicationId: !!process.env.DISCORD_APPLICATION_ID,
    hasClientSecret: !!process.env.DISCORD_CLIENT_SECRET,
    hasRedirectUri: !!process.env.DISCORD_REDIRECT_URI,
    environment: process.env.NODE_ENV,
    redirectUri: process.env.DISCORD_REDIRECT_URI
  });

  // Log initial request details
  logger.info('Discord callback initiated', {
    query: {
      code: req.query.code ? '[REDACTED]' : undefined,
      state: req.query.state ? '[REDACTED]' : undefined,
      error: req.query.error
    },
    headers: {
      host: req.headers.host,
      origin: req.headers.origin,
      referer: req.headers.referer
    }
  });

  // Check for Discord error response
  if (req.query.error) {
    logger.error('Discord returned an error', { error: req.query.error });
    return res.status(400).json({ error: 'Discord authorization failed' });
  }

  // Verify state parameter to prevent CSRF and account mixing
  // State comes URL-encoded from Discord, so decode it first
  const rawState = req.query.state as string | undefined;
  if (!rawState) {
    logger.error('Missing state parameter', {});
    const errorUrl = new URL(process.env.NODE_ENV === 'production'
      ? 'https://assistant.videogamewingman.com'
      : 'http://localhost:3000');
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'missing_state');
    return res.redirect(errorUrl.toString());
  }

  // Decode URL-encoded state (Discord returns it URL-encoded)
  const state = decodeURIComponent(rawState);
  
  const stateVerification = verifyOAuthState(state);
  if (!stateVerification.valid || !stateVerification.username) {
    logger.error('Invalid or expired state parameter', {
      hasState: !!rawState,
      stateValid: stateVerification.valid,
      stateLength: rawState?.length,
      // Log first few chars for debugging (not the full state for security)
      statePreview: rawState?.substring(0, 20)
    });
    const errorUrl = new URL(process.env.NODE_ENV === 'production'
      ? 'https://assistant.videogamewingman.com'
      : 'http://localhost:3000');
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'invalid_state');
    return res.redirect(errorUrl.toString());
  }

  const expectedUsername = stateVerification.username;
  logger.info('State verified successfully', {
    username: expectedUsername
  });

  try {
    const { code } = req.query;

    // Validate authorization code
    if (!code || Array.isArray(code)) {
      logger.error('Invalid code format', { 
        code: code ? '[REDACTED]' : undefined,
        type: typeof code,
        isArray: Array.isArray(code)
      });
      return res.status(400).json({ error: 'Invalid authorization code format' });
    }

    // Step 1: Get OAuth2 token
    logger.info('Starting OAuth2 token exchange');
    let accessToken;
    try {
      accessToken = await getDiscordOAuth2Token(code);
      logger.info('OAuth2 token received successfully');
    } catch (tokenError) {
      logger.error('OAuth2 token exchange failed', { 
        error: tokenError instanceof Error ? tokenError.message : tokenError 
      });
      throw new Error('Failed to exchange authorization code for token');
    }

    // Step 2: Fetch Discord user data
    logger.info('Starting Discord user data fetch');
    let discordUser;
    try {
      discordUser = await fetchDiscordUser(accessToken);
      logger.info('Discord user data fetched successfully', {
        userId: discordUser.id ? '[REDACTED]' : undefined,
        hasEmail: !!discordUser.email
      });
    } catch (userError) {
      logger.error('Discord user fetch failed', { 
        error: userError instanceof Error ? userError.message : userError 
      });
      throw new Error('Failed to fetch Discord user data');
    }

    // Step 3: Verify the Discord account should be linked to the expected Video Game Wingman account
    // This prevents account mixing when another Discord account is already logged into the browser
    logger.info('Verifying account linking', {
      expectedUsername,
      discordUserId: discordUser.id ? '[REDACTED]' : undefined
    });

    // Only trust the email if Discord has verified the user owns it. syncUserData links
    // accounts by email (it re-keys the Wingman account with that email to this Discord ID,
    // and the Discord bot identifies users by that ID), and Discord lets anyone put an
    // unverified address - including someone else's - on their account.
    if (!discordUser.verified || !discordUser.email) {
      logger.warn('Discord account email missing or unverified - refusing to link', {
        hasEmail: !!discordUser.email,
        verified: !!discordUser.verified
      });
      const errorUrl = new URL(process.env.NODE_ENV === 'production'
        ? 'https://assistant.videogamewingman.com'
        : 'http://localhost:3000');
      errorUrl.searchParams.append('auth', 'error');
      errorUrl.searchParams.append('error', 'discord_email_unverified');
      return res.redirect(errorUrl.toString());
    }

    // Step 4: Sync user data (this will link Discord ID to Video Game Wingman account)
    logger.info('Starting user data sync');
    try {
      // syncUserData will update the user's userId to the Discord ID - safe now that the
      // email is verified by Discord (checked above)
      await syncUserData(discordUser.id, discordUser.email);
      logger.info('User data synced successfully', {
        expectedUsername,
        discordUserId: discordUser.id ? '[REDACTED]' : undefined
      });
    } catch (syncError) {
      logger.error('User data sync failed', { 
        error: syncError instanceof Error ? syncError.message : syncError 
      });
      throw new Error('Failed to sync user data');
    }

    // After successful authentication, redirect to Discord bot invite URL
    const botInviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_APPLICATION_ID}&permissions=1617525337286&scope=bot%20applications.commands`;
    
    // Create a landing page URL that will show options to either add bot or start DM
    const landingUrl = new URL('/discord-landing', process.env.NODE_ENV === 'production'
      ? 'https://assistant.videogamewingman.com'
      : 'http://localhost:3000');
    
    // Add necessary parameters
    landingUrl.searchParams.append('botInvite', botInviteUrl);
    landingUrl.searchParams.append('userId', discordUser.id);
    landingUrl.searchParams.append('auth', 'success');
    
    return res.redirect(landingUrl.toString());

  } catch (error) {
    // Comprehensive error logging
    logger.error('Discord callback failed', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      query: {
        code: req.query.code ? '[REDACTED]' : undefined,
        state: req.query.state
      },
      headers: {
        host: req.headers.host,
        origin: req.headers.origin
      }
    });

    // Determine error redirect URL
    const redirectUrl = process.env.NODE_ENV === 'production'
      ? 'https://assistant.videogamewingman.com'
      : 'http://localhost:3000';

    const errorUrl = new URL(redirectUrl);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error_time', Date.now().toString());
    
    return res.redirect(errorUrl.toString());
  }
}