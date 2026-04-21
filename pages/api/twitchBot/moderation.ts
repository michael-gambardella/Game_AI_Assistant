import { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import TwitchBotChannel from '../../../models/TwitchBotChannel';
import { getSession } from '../../../utils/session';
import { logger } from '../../../utils/logger';
import { TwitchModerationConfig, defaultModerationConfig } from '../../../config/twitchModerationConfig';

/**
 * Moderation Settings API for Twitch Bot
 * Handles getting and saving per-channel moderation configuration
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check authentication
  const session = await getSession(req);
  if (!session || !session.username) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'You must be logged in to manage moderation settings'
    });
  }

  const username = session.username;

  try {
    switch (req.method) {
      case 'GET':
        return await handleGetModerationConfig(req, res, username);
      
      case 'POST':
        return await handleSaveModerationConfig(req, res, username);
      
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    logger.error('Error in moderation settings API', {
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
 * Get moderation configuration for a channel
 */
async function handleGetModerationConfig(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName } = req.query;

  if (!channelName || typeof channelName !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid channelName',
      message: 'channelName query parameter is required'
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
      message: 'Channel not found or you do not have permission to access it'
    });
  }

  // Return channel's moderation config or default config
  const config: TwitchModerationConfig = channel.moderationConfig || defaultModerationConfig;

  return res.status(200).json({
    success: true,
    channelName: normalizedChannelName,
    config
  });
}

/**
 * Save moderation configuration for a channel
 */
async function handleSaveModerationConfig(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName, config } = req.body;

  if (!channelName || typeof channelName !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid channelName',
      message: 'channelName is required and must be a string'
    });
  }

  if (!config || typeof config !== 'object') {
    return res.status(400).json({
      error: 'Missing or invalid config',
      message: 'config is required and must be an object'
    });
  }

  // Validate config structure
  const validatedConfig: TwitchModerationConfig = {
    enabled: typeof config.enabled === 'boolean' ? config.enabled : defaultModerationConfig.enabled,
    strictMode: typeof config.strictMode === 'boolean' ? config.strictMode : defaultModerationConfig.strictMode,
    timeoutDurations: {
      first: typeof config.timeoutDurations?.first === 'number' 
        ? Math.max(0, Math.min(300, config.timeoutDurations.first))
        : defaultModerationConfig.timeoutDurations.first,
      second: typeof config.timeoutDurations?.second === 'number'
        ? Math.max(60, Math.min(600, config.timeoutDurations.second))
        : defaultModerationConfig.timeoutDurations.second,
      third: typeof config.timeoutDurations?.third === 'number'
        ? Math.max(300, Math.min(3600, config.timeoutDurations.third))
        : defaultModerationConfig.timeoutDurations.third,
      fourth: typeof config.timeoutDurations?.fourth === 'number'
        ? Math.max(600, Math.min(7200, config.timeoutDurations.fourth))
        : defaultModerationConfig.timeoutDurations.fourth,
    },
    maxViolationsBeforeBan: typeof config.maxViolationsBeforeBan === 'number'
      ? Math.max(3, Math.min(10, config.maxViolationsBeforeBan))
      : defaultModerationConfig.maxViolationsBeforeBan,
    checkAIResponses: typeof config.checkAIResponses === 'boolean' 
      ? config.checkAIResponses 
      : defaultModerationConfig.checkAIResponses,
    logAllActions: typeof config.logAllActions === 'boolean'
      ? config.logAllActions
      : defaultModerationConfig.logAllActions,
  };


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

  // Update moderation config
  channel.moderationConfig = validatedConfig;
  await channel.save();

  logger.info('Moderation config updated', {
    username,
    channelName: normalizedChannelName,
    config: validatedConfig
  });

  return res.status(200).json({
    success: true,
    message: 'Moderation settings saved successfully',
    channelName: normalizedChannelName,
    config: validatedConfig
  });
}

export default withDatabase(handler);
