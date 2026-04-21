import { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import TwitchBotChannel from '../../../models/TwitchBotChannel';
import { getSession } from '../../../utils/session';
import { logger } from '../../../utils/logger';
import { validateChannelSettings, TwitchChannelSettings } from '../../../config/twitchChannelSettings';

/**
 * Channel Settings API for Twitch Bot
 * Handles getting and updating channel-specific bot settings
 * All operations require authentication and verify streamer ownership
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check authentication
  const session = await getSession(req);
  if (!session || !session.username) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'You must be logged in to manage channel settings'
    });
  }

  const username = session.username;

  try {
    switch (req.method) {
      case 'GET':
        return await handleGetSettings(req, res, username);
      
      case 'PUT':
      case 'PATCH':
        return await handleUpdateSettings(req, res, username);
      
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    logger.error('Error in channel settings API', {
      error: error instanceof Error ? error.message : String(error),
      method: req.method,
      username
    });
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Get channel settings for a specific channel
 */
async function handleGetSettings(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName } = req.query;

  if (!channelName || typeof channelName !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid channelName',
      message: 'channelName query parameter is required and must be a string'
    });
  }


  const normalizedChannelName = channelName.toLowerCase().trim();

  // Find channel and verify ownership
  const channel = await TwitchBotChannel.findOne({
    channelName: normalizedChannelName,
    streamerUsername: username
  }).select('channelSettings').lean();

  if (!channel) {
    return res.status(404).json({
      error: 'Channel not found',
      message: 'Channel not found or you do not have permission to manage it'
    });
  }

  // Return settings or defaults
  const settings = (channel as any).channelSettings || null;

  return res.status(200).json({
    success: true,
    channelName: normalizedChannelName,
    settings: settings
  });
}

/**
 * Update channel settings
 */
async function handleUpdateSettings(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName, settings } = req.body;

  if (!channelName || typeof channelName !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid channelName',
      message: 'channelName is required and must be a string'
    });
  }

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({
      error: 'Missing or invalid settings',
      message: 'settings is required and must be an object'
    });
  }


  const normalizedChannelName = channelName.toLowerCase().trim();

  // Find channel and verify ownership
  const channel = await TwitchBotChannel.findOne({
    channelName: normalizedChannelName,
    streamerUsername: username
  });

  if (!channel) {
    return res.status(404).json({
      error: 'Channel not found',
      message: 'Channel not found or you do not have permission to manage it'
    });
  }

  // Validate and merge settings
  const validatedSettings = validateChannelSettings(settings as Partial<TwitchChannelSettings>);

  // Update channel settings
  channel.channelSettings = validatedSettings;
  await channel.save();

  logger.info('Channel settings updated', {
    channelName: normalizedChannelName,
    username,
    settings: Object.keys(validatedSettings)
  });

  return res.status(200).json({
    success: true,
    message: 'Channel settings updated successfully',
    channelName: normalizedChannelName,
    settings: validatedSettings
  });
}

export default withDatabase(handler);
