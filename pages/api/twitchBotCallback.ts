import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { withDatabase } from '../../utils/withDatabase';
import TwitchBotChannel from '../../models/TwitchBotChannel';
import User from '../../models/User';
import { joinChannel } from '../../utils/twitchBot';
import { logger } from '../../utils/logger';

/**
 * Callback route for streamer OAuth authorization
 * This handles the OAuth callback when a streamer authorizes the bot to join their channel
 * Saves channel authorization and automatically joins the channel
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error, error_description, state } = req.query;

  // Log what we received for debugging
  logger.info('Twitch Bot Callback received', {
    hasCode: !!code,
    hasError: !!error,
    error: error,
    errorDescription: error_description,
    hasState: !!state,
    queryParams: Object.keys(req.query)
  });

  // Handle OAuth errors
  if (error) {
    logger.error('Twitch OAuth error in bot callback', {
      error: error,
      errorDescription: error_description
    });
    
    const errorHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Error - Add Bot to Channel</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #0e0e10; color: #efeff1; }
        .error-box { background: #d32f2f; color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info-box { background: #1f1f23; padding: 15px; border-radius: 4px; margin: 15px 0; border-left: 4px solid #9147ff; }
        code { background: #0e0e10; padding: 2px 6px; border-radius: 3px; }
        a { color: #9147ff; }
    </style>
</head>
<body>
    <h1>❌ Twitch Authorization Failed</h1>
    <div class="error-box">
        <strong>Error:</strong> ${error}<br>
        ${error_description ? `<strong>Description:</strong> ${error_description}` : ''}
    </div>
    <div class="info-box">
        <h3>Common Issues:</h3>
        <ul>
            <li><strong>redirect_mismatch:</strong> The redirect URI in your Twitch Developer Console doesn't match exactly. 
                Make sure it's exactly: <code>${process.env.NODE_ENV === 'production' ? 'https://assistant.videogamewingman.com' : 'http://localhost:3000'}/api/twitchBotCallback</code> (no trailing slash)</li>
            <li><strong>access_denied:</strong> You didn't authorize all permissions. Try again and make sure to check all boxes.</li>
        </ul>
    </div>
    <div class="info-box">
        <h3>Next Steps:</h3>
        <ol>
            <li>Check your Twitch Developer Console redirect URIs</li>
            <li>Try again: <a href="/api/twitchBotLogin">Add Bot to Channel</a></li>
        </ol>
    </div>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(errorHtml);
  }

  // Validate authorization code
  if (!code || Array.isArray(code)) {
    logger.error('No authorization code in bot callback', {
      queryParams: Object.keys(req.query)
    });
    
    const debugHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>No Authorization Code - Debug Info</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #0e0e10; color: #efeff1; }
        .warning-box { background: #b8860b; color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info-box { background: #1f1f23; padding: 15px; border-radius: 4px; margin: 15px 0; border-left: 4px solid #9147ff; }
        code { background: #0e0e10; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
        a { color: #9147ff; }
    </style>
</head>
<body>
    <h1>⚠️ No Authorization Code Received</h1>
    <div class="warning-box">
        <strong>Issue:</strong> The callback was hit but no authorization code was provided by Twitch.
    </div>
    <div class="info-box">
        <h3>How to Fix:</h3>
        <ol>
            <li>Go to <a href="https://dev.twitch.tv/console/apps" target="_blank">Twitch Developer Console</a></li>
            <li>Click on your application</li>
            <li>In "OAuth Redirect URLs", make sure you have exactly: <code>${process.env.NODE_ENV === 'production' ? 'https://assistant.videogamewingman.com' : 'http://localhost:3000'}/api/twitchBotCallback</code></li>
            <li>Save changes</li>
            <li>Try again: <a href="/api/twitchBotLogin">Add Bot to Channel</a></li>
        </ol>
    </div>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(debugHtml);
  }

  // Verify state parameter
  if (!state || Array.isArray(state)) {
    logger.error('Missing state parameter in bot callback');
    return res.status(400).json({ error: 'Missing state parameter' });
  }

  // Parse state: timestamp:username:random
  const decodedState = decodeURIComponent(state as string);
  const stateParts = decodedState.split(':');
  if (stateParts.length < 2) {
    logger.error('Invalid state format', { state: decodedState.substring(0, 50) });
    return res.status(400).json({ error: 'Invalid state parameter' });
  }

  const streamerUsername = stateParts[1]; // Video Game Wingman username

  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const domain = process.env.NODE_ENV === 'production'
    ? 'https://assistant.videogamewingman.com'
    : 'http://localhost:3000';

  // Verify username exists in database (we trust the state parameter since it was created by us)
  // Note: We're not strictly verifying session here because tokens might be expired
  // but the user is still "logged in" from frontend perspective
  try {
    const user = await User.findOne({ username: streamerUsername }).select('username').lean();
    if (!user) {
      logger.error('Username from state not found in database', { streamerUsername });
      const errorUrl = new URL('/twitch-landing', domain);
      errorUrl.searchParams.append('auth', 'error');
      errorUrl.searchParams.append('error', 'user_not_found');
      res.redirect(errorUrl.toString());
      return;
    }
    logger.info('Username verified from state parameter', { streamerUsername });
  } catch (dbError) {
    logger.error('Error verifying username in callback', {
      error: dbError instanceof Error ? dbError.message : String(dbError)
    });
    const errorUrl = new URL('/twitch-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    errorUrl.searchParams.append('error', 'verification_failed');
    res.redirect(errorUrl.toString());
    return;
  }
  let redirectUri = `${domain}/api/twitchBotCallback`;
  // Ensure no trailing slash and no double slashes in the URI (except after "https://")
  redirectUri = redirectUri.replace(/\/$/, '').replace(/([^:]\/)\/+/g, "$1");
  const tokenUrl = process.env.TWITCH_TOKEN_URL || 'https://id.twitch.tv/oauth2/token';

  if (!clientId || !clientSecret) {
    logger.error('Missing environment variables in bot callback');
    return res.status(500).json({ 
      error: 'Missing environment variables',
      message: 'NEXT_PUBLIC_TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set in .env'
    });
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

    logger.info('Exchanging authorization code for token...');
    const tokenResponse = await axios.post(tokenUrl, params);

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token) {
      logger.error('No access token in response');
      return res.status(400).json({ 
        error: 'Failed to obtain access token',
        message: 'Twitch did not return an access token.'
      });
    }

    // Fetch streamer's Twitch user data
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
        logger.error('No user data returned from Twitch API');
        return res.status(400).json({ error: 'Failed to fetch Twitch user data' });
      }
    } catch (userError: any) {
      logger.error('Error fetching Twitch user data', {
        error: userError.response?.data || userError.message
      });
      return res.status(500).json({ 
        error: 'Failed to fetch Twitch user data',
        details: userError.response?.data || userError.message
      });
    }

    const channelName = twitchUserData.login.toLowerCase(); // Twitch username (channel name)
    const streamerTwitchId = twitchUserData.id;

    // Connect to database

    // Check if channel already exists
    const existingChannel = await TwitchBotChannel.findOne({ 
      channelName: channelName
    });

    if (existingChannel) {
      // Update existing channel
      existingChannel.streamerTwitchId = streamerTwitchId;
      existingChannel.streamerUsername = streamerUsername;
      existingChannel.isActive = true;
      existingChannel.accessToken = access_token;
      if (refresh_token) {
        existingChannel.refreshToken = refresh_token;
      }
      existingChannel.addedAt = new Date();
      await existingChannel.save();

      logger.info('Updated existing channel authorization', {
        channelName,
        streamerUsername
      });
    } else {
      // Create new channel entry
      await TwitchBotChannel.create({
        channelName: channelName,
        streamerTwitchId: streamerTwitchId,
        streamerUsername: streamerUsername,
        isActive: true,
        addedAt: new Date(),
        accessToken: access_token,
        refreshToken: refresh_token,
        messageCount: 0
      });

      logger.info('Created new channel authorization', {
        channelName,
        streamerUsername
      });
    }

    // Try to join channel if bot is initialized
    let botJoined = false;
    try {
      const { isBotInitialized } = await import('../../utils/twitchBot');
      if (isBotInitialized()) {
        botJoined = await joinChannel(channelName);
        logger.info('Bot join attempt', {
          channelName,
          success: botJoined
        });
      }
    } catch (joinError) {
      logger.warn('Failed to join channel immediately', {
        channelName,
        error: joinError instanceof Error ? joinError.message : String(joinError)
      });
      // Don't fail the whole flow if join fails - bot will join on next restart
    }

    // Automatically set up EventSub subscriptions for engagement tracking
    // Note: Some subscriptions require user OAuth token (channel.subscribe, channel.subscription.gift, channel.cheer)
    // channel.follow is deprecated and has been removed
    try {
      const { setupEventSubSubscriptions } = await import('../../utils/twitch/eventsubSetup');
      const eventsubResult = await setupEventSubSubscriptions(
        streamerTwitchId,
        [
          'channel.subscribe',
          'channel.subscription.gift',
          'channel.raid',
          'channel.cheer'
        ]
        // Note: All EventSub subscriptions use app access token (not user token)
      );
      logger.info('EventSub subscriptions set up automatically', {
        channelName,
        created: eventsubResult.created,
        existing: eventsubResult.existing,
        errors: eventsubResult.errors
      });
    } catch (eventsubError) {
      // Don't fail the whole flow if EventSub setup fails
      logger.warn('Failed to set up EventSub subscriptions automatically', {
        channelName,
        error: eventsubError instanceof Error ? eventsubError.message : String(eventsubError)
      });
    }

    // Redirect to Twitch landing page with success status
    const successUrl = new URL('/twitch-landing', domain);
    successUrl.searchParams.append('auth', 'success');
    successUrl.searchParams.append('channel', channelName);
    
    res.redirect(successUrl.toString());
    return;

  } catch (error: any) {
    logger.error('Error in bot callback', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    
    const errorUrl = new URL('/twitch-landing', domain);
    errorUrl.searchParams.append('auth', 'error');
    
    res.redirect(errorUrl.toString());
    return;
  }
}

export default withDatabase(handler);
