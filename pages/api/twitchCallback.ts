import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getSession } from '../../utils/session';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import { logger } from '../../utils/logger';

/**
 * Legacy Twitch OAuth callback
 * NOTE: For linking Twitch accounts for bot usage, use /api/twitchViewerLogin instead
 * This endpoint is kept for backward compatibility
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    logger.info('Twitch callback received', { query: Object.keys(req.query) });

    const { code, error, error_description } = req.query;

    // Handle OAuth errors from Twitch (redirect mismatch, user cancelled, etc.)
    if (error) {
        console.error('Twitch OAuth error:', error, error_description);
        return res.status(400).json({ 
            error: 'OAuth authorization failed',
            errorCode: error,
            errorDescription: error_description || 'Unknown error',
            message: error === 'access_denied' 
                ? 'User cancelled the authorization'
                : error === 'redirect_uri_mismatch'
                ? 'Redirect URI mismatch. Check your Twitch Developer Console settings.'
                : 'Authorization failed. Please try again.'
        });
    }

    // Validate authorization code
    if (!code || Array.isArray(code)) {
        console.error("No code provided in the Twitch callback.");
        console.error("Query parameters:", req.query);
        console.error("Full URL:", req.url);
        return res.status(400).json({ 
            error: 'No code provided',
            message: 'The authorization code was not provided by Twitch. This may indicate a redirect URI mismatch or the authorization was cancelled.',
            queryParams: Object.keys(req.query),
            hasError: !!error
        });
    }

    // get twitch client id and secret
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    let redirectUri = process.env.TWITCH_REDIRECT_URI || '';

    // Ensure no trailing slash and correct encoding
    redirectUri = redirectUri.replace(/\/$/, '').replace(/([^:]\/)\/+/g, "$1");
    const encodedRedirectUri = encodeURIComponent(redirectUri);

    const tokenUrl = process.env.TWITCH_TOKEN_URL || 'https://id.twitch.tv/oauth2/token';

    console.log("Twitch OAuth2 environment variables:", { clientId, clientSecret, encodedRedirectUri, tokenUrl });
    console.log("Using encoded redirect_uri:", encodedRedirectUri);

    if (!clientId || !clientSecret || !encodedRedirectUri || !tokenUrl) {
        console.error("Missing environment variables for Twitch OAuth2.");
        return res.status(500).json({ error: 'Missing environment variables' });
    }

    // create params for token request
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
    });

    // try to get token response
    try {
        console.log("OAuth token request parameters:", params.toString());

        const tokenResponse = await axios.post(tokenUrl, params);

        console.log("Access Token Response:", tokenResponse.data);

        const { access_token } = tokenResponse.data;

        if (!access_token) {
            console.error("Failed to obtain access token from Twitch.");
            return res.status(400).json({ error: 'Failed to obtain access token' });
        }

        // Fetch user information using the access token
        const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Client-Id': clientId,
            },
        });

        const twitchUserData = userResponse.data.data?.[0];
        logger.info("Twitch user data fetched", {
            hasData: !!twitchUserData,
            twitchUsername: twitchUserData?.login
        });

        // If user is logged in, save Twitch info to their account
        const session = await getSession(req);
        if (session && session.username && twitchUserData) {
            try {
                await User.findOneAndUpdate(
                    { username: session.username },
                    {
                        twitchUsername: twitchUserData.login.toLowerCase(),
                        twitchId: twitchUserData.id
                    },
                    { new: true }
                );
                logger.info('Twitch account linked to user', {
                    username: session.username,
                    twitchUsername: twitchUserData.login
                });
            } catch (dbError) {
                logger.error('Failed to save Twitch info to user account', {
                    error: dbError instanceof Error ? dbError.message : String(dbError),
                    username: session.username
                });
                // Don't fail the whole flow if DB save fails
            }
        }

        // Return the user data as JSON to the frontend
        res.status(200).json(userResponse.data);
    } catch (error) {
        if (error instanceof Error) {
            console.error('Error in Twitch callback:', error.message);
            res.status(500).json({ error: 'Internal Server Error' });
        } else {
            console.error('Unexpected error in Twitch callback:', error);
            res.status(500).json({ error: 'Unexpected Error' });
        }
    }
}

export default withDatabase(handler);
