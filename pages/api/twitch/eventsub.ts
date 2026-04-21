import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { withDatabase } from '../../../utils/withDatabase';
import TwitchBotChannel from '../../../models/TwitchBotChannel';
import { getEngagementTracker } from '../../../utils/twitchBot';
import { logger } from '../../../utils/logger';

/**
 * Twitch EventSub Webhook Handler
 * Handles subscription, follow, raid, and other engagement events from Twitch
 * 
 * EventSub Documentation: https://dev.twitch.tv/docs/eventsub
 */

const TWITCH_MESSAGE_ID_HEADER = 'twitch-eventsub-message-id';
const TWITCH_MESSAGE_TIMESTAMP_HEADER = 'twitch-eventsub-message-timestamp';
const TWITCH_MESSAGE_SIGNATURE_HEADER = 'twitch-eventsub-message-signature';

// Get webhook secret from environment
const WEBHOOK_SECRET = process.env.TWITCH_EVENTSUB_SECRET;

/**
 * Verify webhook signature
 */
function verifySignature(
  messageId: string,
  timestamp: string,
  signature: string,
  body: string
): boolean {
  if (!WEBHOOK_SECRET) {
    logger.warn('TWITCH_EVENTSUB_SECRET not configured, skipping signature verification');
    return true; // Allow in development if secret not set
  }
  
  const message = messageId + timestamp + body;
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(message);
  const expectedSignature = 'sha256=' + hmac.digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Handle EventSub notification
 */
async function handleEventSubNotification(
  subscriptionType: string,
  event: any,
  channelName: string
): Promise<void> {
  const engagementTracker = getEngagementTracker();
  
  if (!engagementTracker) {
    logger.warn('Engagement tracker not initialized, cannot process EventSub event');
    return;
  }
  
  try {
    switch (subscriptionType) {
      case 'channel.subscribe':
        await handleSubscriptionEvent(event, channelName, engagementTracker);
        break;
        
      case 'channel.subscription.gift':
        await handleGiftSubscriptionEvent(event, channelName, engagementTracker);
        break;
        
      case 'channel.follow':
        await handleFollowEvent(event, channelName, engagementTracker);
        break;
        
      case 'channel.raid':
        await handleRaidEvent(event, channelName, engagementTracker);
        break;
        
      case 'channel.cheer':
        await handleCheerEvent(event, channelName, engagementTracker);
        break;
        
      default:
        logger.debug('Unhandled EventSub subscription type', { subscriptionType });
    }
  } catch (error) {
    logger.error('Error handling EventSub notification', {
      subscriptionType,
      channelName,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Handle subscription event
 */
async function handleSubscriptionEvent(
  event: any,
  channelName: string,
  engagementTracker: any
): Promise<void> {
  const user = event.user_name || event.user_login;
  const displayName = event.user_name || user;
  const months = event.cumulative_months || event.months || 1;
  const tier = event.tier || '1000';
  const isGift = event.is_gift || false;
  
  // Skip if it's a gift (handled separately)
  if (isGift) {
    return;
  }
  
  const velocity = await calculateCurrentVelocity(channelName);
  
  await engagementTracker.recordEngagementEvent({
    channelName: channelName.toLowerCase(),
    eventType: 'subscription',
    eventSource: 'eventsub',
    username: user?.toLowerCase(),
    displayName,
    months,
    tier: tier.toString(),
    chatActivity: velocity,
    engagementScore: months > 1 ? 60 : 50, // Higher score for resubs
    eventTimestamp: new Date(event.event_timestamp || Date.now())
  });
  
  logger.info('Subscription event processed', {
    channel: channelName,
    user: displayName,
    months,
    tier
  });
}

/**
 * Handle gift subscription event
 */
async function handleGiftSubscriptionEvent(
  event: any,
  channelName: string,
  engagementTracker: any
): Promise<void> {
  const gifter = event.user_name || event.user_login;
  const displayName = event.user_name || gifter;
  const giftCount = event.total || event.gift_count || 1;
  const tier = event.tier || '1000';
  
  const velocity = await calculateCurrentVelocity(channelName);
  
  await engagementTracker.recordEngagementEvent({
    channelName: channelName.toLowerCase(),
    eventType: 'gift_subscription',
    eventSource: 'eventsub',
    username: gifter?.toLowerCase(),
    displayName,
    giftCount,
    tier: tier.toString(),
    chatActivity: velocity,
    engagementScore: 70 + (giftCount * 2), // Higher score for more gifts
    eventTimestamp: new Date(event.event_timestamp || Date.now())
  });
  
  logger.info('Gift subscription event processed', {
    channel: channelName,
    gifter: displayName,
    giftCount,
    tier
  });
}

/**
 * Handle follow event
 */
async function handleFollowEvent(
  event: any,
  channelName: string,
  engagementTracker: any
): Promise<void> {
  const user = event.user_name || event.user_login;
  const displayName = event.user_name || user;
  
  const velocity = await calculateCurrentVelocity(channelName);
  
  await engagementTracker.recordEngagementEvent({
    channelName: channelName.toLowerCase(),
    eventType: 'follow',
    eventSource: 'eventsub',
    username: user?.toLowerCase(),
    displayName,
    chatActivity: velocity,
    engagementScore: 15, // Lower score for follows (common event)
    eventTimestamp: new Date(event.event_timestamp || Date.now())
  });
  
  logger.info('Follow event processed', {
    channel: channelName,
    user: displayName
  });
}

/**
 * Handle raid event
 */
async function handleRaidEvent(
  event: any,
  channelName: string,
  engagementTracker: any
): Promise<void> {
  const raider = event.from_broadcaster_user_name || event.from_broadcaster_user_login;
  const displayName = event.from_broadcaster_user_name || raider;
  const viewers = event.viewers || 0;
  
  const velocity = await calculateCurrentVelocity(channelName);
  
  await engagementTracker.recordEngagementEvent({
    channelName: channelName.toLowerCase(),
    eventType: 'raid',
    eventSource: 'eventsub',
    username: raider?.toLowerCase(),
    displayName,
    raidViewers: viewers,
    chatActivity: velocity,
    engagementScore: 40 + (viewers / 10), // Higher score for more viewers
    eventTimestamp: new Date(event.event_timestamp || Date.now())
  });
  
  logger.info('Raid event processed', {
    channel: channelName,
    raider: displayName,
    viewers
  });
}

/**
 * Handle cheer event
 */
async function handleCheerEvent(
  event: any,
  channelName: string,
  engagementTracker: any
): Promise<void> {
  const user = event.user_name || event.user_login;
  const displayName = event.user_name || user;
  const bits = event.bits || 0;
  
  const velocity = await calculateCurrentVelocity(channelName);
  
  await engagementTracker.recordEngagementEvent({
    channelName: channelName.toLowerCase(),
    eventType: 'cheer',
    eventSource: 'eventsub',
    username: user?.toLowerCase(),
    displayName,
    bits,
    chatActivity: velocity,
    engagementScore: 20 + (bits / 10), // Higher score for more bits
    eventTimestamp: new Date(event.event_timestamp || Date.now())
  });
  
  logger.info('Cheer event processed', {
    channel: channelName,
    user: displayName,
    bits
  });
}

/**
 * Calculate current message velocity for a channel
 * This is a helper to get velocity when processing EventSub events
 * Note: Velocity is tracked internally by EngagementTracker, so we estimate here
 */
async function calculateCurrentVelocity(channelName: string): Promise<number> {
  // Velocity is tracked internally by EngagementTracker
  // For EventSub events, we'll use a default value since we can't access internal state
  // The engagement tracker will calculate actual velocity when it processes the event
  return 0; // Will be updated by engagement tracker's internal tracking
}

/**
 * EventSub Webhook Handler
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  
  try {
    // Get headers
    const messageId = req.headers[TWITCH_MESSAGE_ID_HEADER] as string;
    const timestamp = req.headers[TWITCH_MESSAGE_TIMESTAMP_HEADER] as string;
    const signature = req.headers[TWITCH_MESSAGE_SIGNATURE_HEADER] as string;
    
    // Handle different notification types
    // Parse body if it's a string (Next.js sometimes doesn't auto-parse)
    let notification = req.body;
    if (typeof notification === 'string') {
      try {
        notification = JSON.parse(notification);
      } catch (e) {
        logger.warn('Failed to parse request body as JSON', { body: notification });
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    
    // Debug: Log what we received (only in test mode)
    if (!messageId && !timestamp && !signature) {
      logger.debug('EventSub request received (test mode)', {
        hasBody: !!notification,
        bodyKeys: notification ? Object.keys(notification) : [],
        bodyType: typeof notification,
        bodyValue: notification
      });
    }
    
    // Webhook verification challenge (allow without full headers for testing)
    if (notification && notification.challenge) {
      // If this is a simple challenge test (no headers), allow it
      if (!messageId && !timestamp && !signature) {
        logger.info('EventSub webhook verification challenge received (test mode - no headers)');
      } else {
        logger.info('EventSub webhook verification challenge received');
      }
      return res.status(200).send(notification.challenge);
    }
    
    // For actual EventSub notifications, require headers
    if (!messageId || !timestamp || !signature) {
      logger.warn('Missing EventSub headers', {
        hasMessageId: !!messageId,
        hasTimestamp: !!timestamp,
        hasSignature: !!signature
      });
      return res.status(400).json({ error: 'Missing required headers' });
    }
    
    // Get raw body for signature verification
    const body = JSON.stringify(req.body);
    
    // Verify signature
    if (!verifySignature(messageId, timestamp, signature, body)) {
      logger.warn('Invalid EventSub signature', { messageId });
      return res.status(403).json({ error: 'Invalid signature' });
    }
    
    // Handle notification
    if (notification.subscription && notification.event) {
      const subscription = notification.subscription;
      const event = notification.event;
      
      // Extract channel name from subscription condition
      const channelName = subscription.condition?.broadcaster_user_id 
        ? await getChannelNameFromUserId(subscription.condition.broadcaster_user_id)
        : subscription.condition?.broadcaster_user_login;
      
      if (!channelName) {
        logger.warn('Could not determine channel name from EventSub notification', {
          subscriptionType: subscription.type
        });
        return res.status(400).json({ error: 'Could not determine channel' });
      }
      
      // Process the event
      await handleEventSubNotification(
        subscription.type,
        event,
        channelName.toLowerCase()
      );
      
      return res.status(200).json({ received: true });
    }
    
    // Unknown notification format
    logger.warn('Unknown EventSub notification format', {
      keys: Object.keys(notification)
    });
    return res.status(400).json({ error: 'Unknown notification format' });
    
  } catch (error) {
    logger.error('Error processing EventSub webhook', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get channel name from broadcaster user ID
 */
async function getChannelNameFromUserId(userId: string): Promise<string | null> {
  try {
    
    const channel = await TwitchBotChannel.findOne({
      streamerTwitchId: userId
    }).select('channelName').lean();
    
    if (!channel || Array.isArray(channel)) {
      return null;
    }
    
    return (channel as any).channelName || null;
  } catch (error) {
    logger.error('Error getting channel name from user ID', {
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export default withDatabase(handler);
