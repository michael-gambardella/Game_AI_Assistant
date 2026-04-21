import { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import TwitchBotChannel from '../../../models/TwitchBotChannel';
import { getSession } from '../../../utils/session';
import { joinChannel, leaveChannel, isBotInitialized } from '../../../utils/twitchBot';
import { logger } from '../../../utils/logger';

/**
 * Channel Management API for Twitch Bot
 * Handles listing, enabling, disabling, and removing channels
 * All operations require authentication and verify streamer ownership
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check authentication
  const session = await getSession(req);
  if (!session || !session.username) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'You must be logged in to manage channels'
    });
  }

  const username = session.username;

  try {
    switch (req.method) {
      case 'GET':
        return await handleListChannels(req, res, username);
      
      case 'POST':
        return await handleEnableChannel(req, res, username);
      
      case 'PATCH':
        return await handleUpdateChannel(req, res, username);
      
      case 'DELETE':
        return await handleRemoveChannel(req, res, username);
      
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    logger.error('Error in channel management API', {
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
 * List all channels for the authenticated user
 */
async function handleListChannels(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {

  const channels = await TwitchBotChannel.find({ streamerUsername: username })
    .select('channelName streamerTwitchId isActive addedAt messageCount lastJoinedAt lastLeftAt')
    .sort({ addedAt: -1 })
    .lean();

  return res.status(200).json({
    success: true,
    channels: channels.map(ch => ({
      channelName: ch.channelName,
      isActive: ch.isActive,
      addedAt: ch.addedAt,
      messageCount: ch.messageCount || 0,
      lastJoinedAt: ch.lastJoinedAt,
      lastLeftAt: ch.lastLeftAt
    })),
    total: channels.length,
    active: channels.filter(ch => ch.isActive).length
  });
}

/**
 * Enable a channel (reactivate if it was disabled)
 */
async function handleEnableChannel(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName } = req.body;

  if (!channelName || typeof channelName !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid channelName',
      message: 'channelName is required and must be a string'
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

  // Enable channel
  channel.isActive = true;
  await channel.save();

  // Try to join channel if bot is initialized
  let botJoined = false;
  if (isBotInitialized()) {
    try {
      botJoined = await joinChannel(normalizedChannelName);
      logger.info('Channel enabled and bot joined', {
        channelName: normalizedChannelName,
        username,
        botJoined
      });
    } catch (joinError) {
      logger.warn('Failed to join channel after enabling', {
        channelName: normalizedChannelName,
        error: joinError instanceof Error ? joinError.message : String(joinError)
      });
      // Don't fail - bot will join on next restart
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Channel enabled successfully',
    channel: {
      channelName: channel.channelName,
      isActive: channel.isActive,
      botJoined
    }
  });
}

/**
 * Update channel settings (enable/disable)
 */
async function handleUpdateChannel(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName, isActive } = req.body;

  if (!channelName || typeof channelName !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid channelName',
      message: 'channelName is required and must be a string'
    });
  }

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({
      error: 'Missing or invalid isActive',
      message: 'isActive is required and must be a boolean'
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

  // Update channel
  channel.isActive = isActive;
  await channel.save();

  // If enabling, try to join channel; if disabling, try to leave
  let botAction = null;
  if (isBotInitialized()) {
    try {
      if (isActive) {
        const joined = await joinChannel(normalizedChannelName);
        botAction = { action: 'joined', success: joined };
      } else {
        await leaveChannel(normalizedChannelName);
        botAction = { action: 'left', success: true };
      }
    } catch (actionError) {
      logger.warn('Failed to update bot channel state', {
        channelName: normalizedChannelName,
        isActive,
        error: actionError instanceof Error ? actionError.message : String(actionError)
      });
      // Don't fail - state is saved in DB
    }
  }

  return res.status(200).json({
    success: true,
    message: `Channel ${isActive ? 'enabled' : 'disabled'} successfully`,
    channel: {
      channelName: channel.channelName,
      isActive: channel.isActive,
      botAction
    }
  });
}

/**
 * Remove a channel (delete from database and leave channel)
 */
async function handleRemoveChannel(
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
  });

  if (!channel) {
    return res.status(404).json({
      error: 'Channel not found',
      message: 'Channel not found or you do not have permission to remove it'
    });
  }

  // Try to leave channel if bot is initialized
  if (isBotInitialized()) {
    try {
      await leaveChannel(normalizedChannelName);
      logger.info('Bot left channel before removal', {
        channelName: normalizedChannelName,
        username
      });
    } catch (leaveError) {
      logger.warn('Failed to leave channel before removal', {
        channelName: normalizedChannelName,
        error: leaveError instanceof Error ? leaveError.message : String(leaveError)
      });
      // Continue with deletion even if leave fails
    }
  }

  // Delete channel from database
  await TwitchBotChannel.deleteOne({
    channelName: normalizedChannelName,
    streamerUsername: username
  });

  logger.info('Channel removed', {
    channelName: normalizedChannelName,
    username
  });

  return res.status(200).json({
    success: true,
    message: 'Channel removed successfully',
    channelName: normalizedChannelName
  });
}

export default withDatabase(handler);
