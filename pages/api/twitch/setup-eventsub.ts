import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../utils/session';
import { withDatabase } from '../../../utils/withDatabase';
import TwitchBotChannel from '../../../models/TwitchBotChannel';
import { setupEventSubSubscriptions, removeEventSubSubscriptions, listEventSubSubscriptions } from '../../../utils/twitch/eventsubSetup';
import { logger } from '../../../utils/logger';

/**
 * API endpoint for managing EventSub subscriptions
 * 
 * POST /api/twitch/setup-eventsub
 * - Sets up EventSub subscriptions for a channel
 * 
 * DELETE /api/twitch/setup-eventsub
 * - Removes EventSub subscriptions for a channel
 * 
 * GET /api/twitch/setup-eventsub
 * - Lists all EventSub subscriptions
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow authenticated users
  const session = await getSession(req);
  if (!session || !session.username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {

    if (req.method === 'POST') {
      // Set up EventSub subscriptions for a channel
      const { channelName, subscriptionTypes } = req.body;

      if (!channelName) {
        return res.status(400).json({ 
          error: 'Missing channelName',
          message: 'channelName is required in request body'
        });
      }

      // Find the channel in database
      const channel = await TwitchBotChannel.findOne({
        channelName: channelName.toLowerCase(),
        streamerUsername: session.username
      });

      if (!channel) {
        return res.status(404).json({ 
          error: 'Channel not found',
          message: `Channel "${channelName}" not found or you don't have permission to manage it`
        });
      }

      if (!channel.streamerTwitchId) {
        return res.status(400).json({ 
          error: 'Missing Twitch ID',
          message: 'Channel does not have a Twitch user ID. Please re-authorize the channel.'
        });
      }

      // Default subscription types if not provided
      // Note: channel.follow is deprecated and has been removed
      const types = subscriptionTypes || [
        'channel.subscribe',
        'channel.subscription.gift',
        'channel.raid',
        'channel.cheer'
      ];

      logger.info('Setting up EventSub subscriptions', {
        channelName: channel.channelName,
        streamerTwitchId: channel.streamerTwitchId,
        subscriptionTypes: types,
        requestedBy: session.username,
        hasUserToken: !!channel.accessToken
      });

      const result = await setupEventSubSubscriptions(
        channel.streamerTwitchId,
        types
        // Note: All EventSub subscriptions use app access token (not user token)
      );

      return res.status(200).json({
        success: true,
        message: 'EventSub subscriptions set up successfully',
        channelName: channel.channelName,
        result: {
          created: result.created,
          existing: result.existing,
          errors: result.errors
        }
      });

    } else if (req.method === 'DELETE') {
      // Remove EventSub subscriptions for a channel
      const { channelName } = req.query;

      if (!channelName || typeof channelName !== 'string') {
        return res.status(400).json({ 
          error: 'Missing channelName',
          message: 'channelName is required as a query parameter'
        });
      }

      // Find the channel in database
      const channel = await TwitchBotChannel.findOne({
        channelName: channelName.toLowerCase(),
        streamerUsername: session.username
      });

      if (!channel) {
        return res.status(404).json({ 
          error: 'Channel not found',
          message: `Channel "${channelName}" not found or you don't have permission to manage it`
        });
      }

      if (!channel.streamerTwitchId) {
        return res.status(400).json({ 
          error: 'Missing Twitch ID',
          message: 'Channel does not have a Twitch user ID'
        });
      }

      logger.info('Removing EventSub subscriptions', {
        channelName: channel.channelName,
        streamerTwitchId: channel.streamerTwitchId,
        requestedBy: session.username
      });

      const result = await removeEventSubSubscriptions(channel.streamerTwitchId);

      return res.status(200).json({
        success: true,
        message: 'EventSub subscriptions removed successfully',
        channelName: channel.channelName,
        result: {
          removed: result.removed,
          errors: result.errors
        }
      });

    } else if (req.method === 'GET') {
      // List all EventSub subscriptions
      logger.info('Listing EventSub subscriptions', {
        requestedBy: session.username
      });

      const subscriptions = await listEventSubSubscriptions();

      // Filter to only show subscriptions for channels the user owns
      const userChannels = await TwitchBotChannel.find({
        streamerUsername: session.username
      }).select('streamerTwitchId channelName').lean();

      const userTwitchIds = new Set(
        userChannels.map(ch => ch.streamerTwitchId).filter(Boolean)
      );

      const relevantSubscriptions = subscriptions.filter((sub: any) => {
        const broadcasterId = sub.condition?.broadcaster_user_id || sub.condition?.to_broadcaster_user_id;
        return broadcasterId && userTwitchIds.has(broadcasterId);
      });

      // Map to include channel names
      const subscriptionsWithChannelNames = relevantSubscriptions.map((sub: any) => {
        const broadcasterId = sub.condition?.broadcaster_user_id || sub.condition?.to_broadcaster_user_id;
        const channel = userChannels.find(
          (ch: any) => ch.streamerTwitchId === broadcasterId
        );
        
        return {
          id: sub.id,
          type: sub.type,
          status: sub.status,
          channelName: channel?.channelName || 'Unknown',
          broadcasterUserId: broadcasterId,
          createdAt: sub.created_at,
          transport: {
            method: sub.transport?.method,
            callback: sub.transport?.callback
          }
        };
      });

      return res.status(200).json({
        success: true,
        subscriptions: subscriptionsWithChannelNames,
        total: subscriptionsWithChannelNames.length
      });

    } else {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

  } catch (error: any) {
    logger.error('Error in EventSub setup endpoint', {
      error: error.message,
      stack: error.stack,
      method: req.method
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
}

export default withDatabase(handler);
