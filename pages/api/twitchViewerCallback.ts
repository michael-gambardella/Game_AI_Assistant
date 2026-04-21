import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import { verifyOAuthState } from './twitchViewerLogin';
import { logger } from '../../utils/logger';

/**
 * Callback route for viewer OAuth authorization
 * This handles the OAuth callback when a viewer links their Twitch account
 * to their Video Game Wingman account for bot usage
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error, error_description, state } = req.query;

  // Log what we received for debugging
  logger.info('Twitch Viewer Callback received', {
    hasCode: !!code,
    hasError: !!error,
    error: error,
    errorDescription: error_description,
    hasState: !!state,
    queryParams: Object.keys(req.query)
  });

  const domain = process.env.NODE_ENV === 'production'
    ? 'https://assistant.videogamewingman.com'
    : 'http://localhost:3000';

  // Handle OAuth errors
  if (error) {
    logger.error('Twitch OAuth error in viewer callback', {
      error: error,
      errorDescription: error_description
    });
    
    const errorUrl = new URL('/twitch-viewer-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', error as string);
    if (error_description) {
      errorUrl.searchParams.append('errorDescription', error_description as string);
    }
    return res.redirect(errorUrl.toString());
  }

  // Validate authorization code
  if (!code || Array.isArray(code)) {
    logger.error('No authorization code in viewer callback', {
      queryParams: Object.keys(req.query)
    });
    
    const errorUrl = new URL('/twitch-viewer-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'no_code');
    return res.redirect(errorUrl.toString());
  }

  // Verify state parameter
  if (!state || Array.isArray(state)) {
    logger.error('Missing state parameter in viewer callback');
    const errorUrl = new URL('/twitch-viewer-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'invalid_state');
    return res.redirect(errorUrl.toString());
  }

  // URL-decode the state (Next.js should do this automatically, but be explicit)
  // Twitch may URL-encode the state parameter when redirecting back
  let decodedState = state as string;
  try {
    decodedState = decodeURIComponent(decodedState);
  } catch (decodeError) {
    // If decoding fails, use original (might already be decoded)
    logger.warn('State parameter decode failed, using original', {
      error: decodeError instanceof Error ? decodeError.message : String(decodeError)
    });
  }

  // Verify state
  logger.info('Verifying OAuth state', {
    stateLength: decodedState.length,
    statePreview: decodedState.substring(0, 50) + '...',
    hasColon: decodedState.includes(':'),
    parts: decodedState.split(':').length
  });
  
  const stateVerification = verifyOAuthState(decodedState);
  if (!stateVerification.valid || !stateVerification.username) {
    logger.error('Invalid state parameter in viewer callback', {
      state: decodedState.substring(0, 100), // Log more of the state
      stateLength: decodedState.length,
      hasColon: decodedState.split(':').length > 1,
      parts: decodedState.split(':').length,
      verificationResult: {
        valid: stateVerification.valid,
        hasUsername: !!stateVerification.username
      }
    });
    const errorUrl = new URL('/twitch-viewer-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'invalid_state');
    return res.redirect(errorUrl.toString());
  }
  
  logger.info('State verification successful', {
    username: stateVerification.username
  });

  const username = stateVerification.username;

  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  let redirectUri = `${domain}/api/twitchViewerCallback`;
  
  // Ensure no trailing slash and no double slashes in the URI (except after "https://")
  redirectUri = redirectUri.replace(/\/$/, '').replace(/([^:]\/)\/+/g, "$1");
  const tokenUrl = process.env.TWITCH_TOKEN_URL || 'https://id.twitch.tv/oauth2/token';

  if (!clientId || !clientSecret) {
    logger.error('Missing environment variables in viewer callback');
    const errorUrl = new URL('/twitch-viewer-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'server_error');
    return res.redirect(errorUrl.toString());
  }

  try {
    // Exchange authorization code for access token
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: redirectUri,
    });

    logger.info('Exchanging authorization code for token (viewer)...');
    const tokenResponse = await axios.post(tokenUrl, params);

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      logger.error('No access token in response (viewer)');
      const errorUrl = new URL('/twitch-viewer-landing', domain);
      errorUrl.searchParams.append('auth', 'error');
      errorUrl.searchParams.append('error', 'no_token');
      return res.redirect(errorUrl.toString());
    }

    // Fetch viewer's Twitch user data
    let twitchUserData = null;
    try {
      const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Client-Id': clientId,
        },
      });
      twitchUserData = userResponse.data.data?.[0];
      
      if (!twitchUserData) {
        logger.error('No user data returned from Twitch API (viewer)');
        const errorUrl = new URL('/twitch-viewer-landing', domain);
        errorUrl.searchParams.append('auth', 'error');
        errorUrl.searchParams.append('error', 'no_user_data');
        return res.redirect(errorUrl.toString());
      }
    } catch (userError: any) {
      logger.error('Error fetching Twitch user data (viewer)', {
        error: userError.response?.data || userError.message
      });
      const errorUrl = new URL('/twitch-viewer-landing', domain);
      errorUrl.searchParams.append('auth', 'error');
      errorUrl.searchParams.append('error', 'fetch_failed');
      return res.redirect(errorUrl.toString());
    }

    const twitchUsername = twitchUserData.login.toLowerCase();
    const twitchId = twitchUserData.id;

    // Connect to database

    // Verify username exists in database
    const user = await User.findOne({ username: username }).select('username twitchUsername twitchId').lean();
    if (!user) {
      logger.error('Username from state not found in database (viewer)', { username });
      const errorUrl = new URL('/twitch-viewer-landing', domain);
      errorUrl.searchParams.append('auth', 'error');
      errorUrl.searchParams.append('error', 'user_not_found');
      return res.redirect(errorUrl.toString());
    }

    // Check if this Twitch account is already linked to another user
    const existingLink = await User.findOne({ 
      twitchId: twitchId,
      username: { $ne: username } // Different user
    }).select('username').lean();

    if (existingLink && !Array.isArray(existingLink)) {
      logger.warn('Twitch account already linked to another user', {
        twitchId,
        twitchUsername,
        linkedTo: existingLink.username,
        attemptingToLink: username
      });
      const errorUrl = new URL('/twitch-viewer-landing', domain);
      errorUrl.searchParams.append('auth', 'error');
      errorUrl.searchParams.append('error', 'already_linked');
      errorUrl.searchParams.append('twitchUsername', twitchUsername);
      return res.redirect(errorUrl.toString());
    }

    // Update user's Twitch account information
    await User.findOneAndUpdate(
      { username: username },
      {
        twitchUsername: twitchUsername,
        twitchId: twitchId
      },
      { new: true }
    );

    logger.info('Twitch account linked to user (viewer)', {
      username: username,
      twitchUsername: twitchUsername,
      twitchId: twitchId
    });

    // Redirect to success page
    const successUrl = new URL('/twitch-viewer-landing', domain);
    successUrl.searchParams.append('auth', 'success');
    successUrl.searchParams.append('twitchUsername', twitchUsername);
    
    res.redirect(successUrl.toString());
    return;

  } catch (error: any) {
    logger.error('Error in viewer callback', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    
    const errorUrl = new URL('/twitch-viewer-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'server_error');
    
    res.redirect(errorUrl.toString());
    return;
  }
}

export default withDatabase(handler);
