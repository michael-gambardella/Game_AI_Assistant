import { findOffensiveWords } from '../contentModeration';
import { logger } from '../logger';
import { getClient } from '../twitchBot';
import connectToMongoDB from '../mongodb';
import TwitchUserViolation from '../../models/TwitchUserViolation';
import TwitchModerationLog from '../../models/TwitchModerationLog';
import { getModerationConfig } from '../../config/twitchModerationConfig';

/**
 * Violation result type from violation handler
 */
export type ViolationResult = {
  action: 'warning' | 'banned' | 'permanent_ban';
  count?: number;
  expiresAt?: Date;
  banCount?: number;
  message?: string;
};

/**
 * Result of a moderation check
 */
export interface ModerationResult {
  /** Whether the content contains offensive material */
  isOffensive: boolean;
  /** List of offending words/phrases found */
  offendingWords: string[];
  /** Whether the message should be processed (false if offensive or banned) */
  shouldProcess: boolean;
  /** Violation result from violation handler (if applicable) */
  violationResult?: ViolationResult;
  /** Reason for rejection (if shouldProcess is false) */
  reason?: string;
}

/**
 * Check if a user's message contains offensive content
 * This is used BEFORE processing with AI - if offensive, we don't process the message
 * 
 * @param message - The message content to check
 * @param twitchUsername - The Twitch username of the user (not Video Game Wingman username)
 * @returns ModerationResult indicating if content is offensive and if message should be processed
 */
export async function checkMessageContent(
  message: string,
  twitchUsername: string,
  channelName?: string
): Promise<ModerationResult> {
  try {
    // Get moderation configuration (per-channel if channelName provided)
    const config = await getModerationConfig(channelName);
    
    // Check if moderation is enabled
    if (!config.enabled) {
      return {
        isOffensive: false,
        offendingWords: [],
        shouldProcess: true,
      };
    }
    // Pure word check - records nothing. Violations are tracked separately in TwitchUserViolation
    // (the recording check used before also wrote a junk UserViolation record per message).
    const offendingWords = findOffensiveWords(message);
    const moderationCheck = { isOffensive: offendingWords.length > 0, offendingWords };

    if (!moderationCheck.isOffensive) {
      // Content is clean - allow processing
      return {
        isOffensive: false,
        offendingWords: [],
        shouldProcess: true,
      };
    }

    // Offensive content detected
    logger.warn('Offensive content detected in Twitch message', {
      twitchUsername,
      offendingWords: moderationCheck.offendingWords,
      messagePreview: message.substring(0, 100), // Log first 100 chars for context
    });

    // For Twitch, we don't check the old UserViolation model for ban status
    // We use checkTwitchUserBanStatus() separately in botHandler
    // So we just return that content is offensive - violation tracking happens in handleModerationViolation

    return {
      isOffensive: true,
      offendingWords: moderationCheck.offendingWords,
      shouldProcess: false, // Don't process offensive messages
      // No violationResult here - we handle violations separately using TwitchUserViolation
      reason: 'Message contains offensive content',
    };
  } catch (error) {
    // If moderation check fails, log error but allow processing (fail open)
    // This prevents moderation system failures from breaking the bot
    logger.error('Error checking message content for moderation', {
      error: error instanceof Error ? error.message : String(error),
      twitchUsername,
    });

    return {
      isOffensive: false,
      offendingWords: [],
      shouldProcess: true, // Fail open - allow processing if check fails
      reason: 'Moderation check failed, allowing message',
    };
  }
}

/**
 * Check if an AI-generated response contains inappropriate content
 * This is used AFTER AI generates a response - if inappropriate, we replace it with a safe fallback
 * 
 * IMPORTANT: This does NOT penalize the user - the inappropriate content is AI-generated, not user-generated
 * 
 * @param response - The AI-generated response to check
 * @param twitchUsername - The Twitch username (for logging purposes only)
 * @param channelName - Optional: The channel name (for logging purposes)
 * @returns ModerationResult indicating if response is inappropriate
 */
export async function checkAIResponse(
  response: string,
  twitchUsername: string,
  channelName?: string
): Promise<ModerationResult> {
  try {
    // Get moderation configuration (per-channel if channelName provided)
    const config = await getModerationConfig(channelName);
    
    // Check if AI response checking is enabled
    if (!config.checkAIResponses) {
      return {
        isOffensive: false,
        offendingWords: [],
        shouldProcess: true,
      };
    }
    
    // Pure word check on the AI's reply - records nothing, so no user is ever penalized
    const offendingWords = findOffensiveWords(response);
    const moderationCheck = { isOffensive: offendingWords.length > 0, offendingWords };

    if (!moderationCheck.isOffensive) {
      // Response is clean - allow sending
      return {
        isOffensive: false,
        offendingWords: [],
        shouldProcess: true,
      };
    }

    // Inappropriate content detected in AI response
    // Log this for review - this indicates we may need to adjust system prompts
    logger.warn('AI generated inappropriate response', {
      twitchUsername,
      offendingWords: moderationCheck.offendingWords,
      responsePreview: response.substring(0, 200), // Log first 200 chars for review
      note: 'This is AI-generated content, not user-generated. User should not be penalized.',
    });

    // Log AI response filtering to database (for review, not for user penalty)
    // Only log if logging is enabled
    if (config.logAllActions) {
      await logModerationAction({
      channelName: channelName || 'unknown', // Use provided channel or 'unknown'
      twitchUsername: twitchUsername,
      violationType: 'ai_inappropriate',
      offendingWords: moderationCheck.offendingWords,
      messageContent: response.substring(0, 500), // Store first 500 chars for review
      actionTaken: 'warning', // Treated as warning for logging purposes
      reason: 'AI response contains inappropriate content - replaced with safe fallback',
      totalViolations: 0, // Not a user violation
      success: true
      });
    }

    return {
      isOffensive: true,
      offendingWords: moderationCheck.offendingWords,
      shouldProcess: false, // Don't send inappropriate AI responses
      reason: 'AI response contains inappropriate content - will be replaced with safe fallback',
      // Note: No violationResult - we don't penalize users for AI-generated content
    };
  } catch (error) {
    // If moderation check fails, log error but allow sending (fail open)
    // This prevents moderation system failures from breaking the bot
    logger.error('Error checking AI response for moderation', {
      error: error instanceof Error ? error.message : String(error),
      twitchUsername,
    });

    return {
      isOffensive: false,
      offendingWords: [],
      shouldProcess: true, // Fail open - allow sending if check fails
      reason: 'Moderation check failed, allowing response',
    };
  }
}

/**
 * Convenience function to check if a message should be processed
 * Combines content check with ban status check
 * 
 * @param message - The message content to check
 * @param twitchUsername - The Twitch username of the user
 * @returns true if message should be processed, false otherwise
 */
export async function shouldProcessMessage(
  message: string,
  twitchUsername: string
): Promise<boolean> {
  const moderationResult = await checkMessageContent(message, twitchUsername);
  return moderationResult.shouldProcess;
}

/**
 * Get a safe fallback response when AI generates inappropriate content
 * This replaces the inappropriate AI response
 * 
 * @returns A safe, generic response message
 */
export function getSafeFallbackResponse(): string {
  return "I apologize, but I'm unable to provide a response to that question. Please feel free to ask me something else about video games!";
}

/**
 * Send a warning message to a user in chat
 * Used for first violation - no timeout, just a warning
 * 
 * @param channel - The Twitch channel (with or without # prefix)
 * @param username - The Twitch username to warn
 * @param displayName - The display name of the user (for @ mention)
 * @param reason - Reason for the warning
 * @returns Promise<boolean> - true if warning was sent successfully
 */
export async function sendWarningMessage(
  channel: string,
  username: string,
  displayName: string,
  reason: string
): Promise<boolean> {
  try {
    const client = getClient();
    if (!client) {
      logger.error('Cannot send warning: Twitch client not initialized');
      return false;
    }

    // Ensure channel has # prefix
    const channelName = channel.startsWith('#') ? channel : `#${channel}`;
    
    const warningMessage = `@${displayName} ⚠️ Warning: Your message contains inappropriate content. Please keep chat respectful. Reason: ${reason}`;
    
    await client.say(channelName, warningMessage);
    
    logger.info('Warning message sent', {
      channel: channelName,
      username,
      displayName,
      reason
    });
    
    return true;
  } catch (error) {
    logger.error('Error sending warning message', {
      error: error instanceof Error ? error.message : String(error),
      channel,
      username
    });
    return false;
  }
}

/**
 * Timeout a user in a Twitch channel
 * 
 * @param channel - The Twitch channel (with or without # prefix)
 * @param username - The Twitch username to timeout
 * @param duration - Duration in seconds (e.g., 300 for 5 minutes)
 * @param reason - Reason for the timeout
 * @returns Promise<boolean> - true if timeout was successful
 */
export async function timeoutUser(
  channel: string,
  username: string,
  duration: number,
  reason: string
): Promise<boolean> {
  try {
    const client = getClient();
    if (!client) {
      logger.error('Cannot timeout user: Twitch client not initialized');
      return false;
    }

    // Ensure channel has # prefix
    const channelName = channel.startsWith('#') ? channel : `#${channel}`;
    
    // Remove # from channel for timeout command (tmi.js expects it without #)
    const channelWithoutHash = channelName.replace('#', '');
    
    await client.timeout(channelWithoutHash, username, duration, reason);
    
    logger.info('User timed out', {
      channel: channelName,
      username,
      duration,
      reason
    });
    
    return true;
  } catch (error) {
    logger.error('Error timing out user', {
      error: error instanceof Error ? error.message : String(error),
      channel,
      username,
      duration
    });
    return false;
  }
}

/**
 * Permanently ban a user from a Twitch channel
 * 
 * @param channel - The Twitch channel (with or without # prefix)
 * @param username - The Twitch username to ban
 * @param reason - Reason for the ban
 * @returns Promise<boolean> - true if ban was successful
 */
export async function banUser(
  channel: string,
  username: string,
  reason: string
): Promise<boolean> {
  try {
    const client = getClient();
    if (!client) {
      logger.error('Cannot ban user: Twitch client not initialized');
      return false;
    }

    // Ensure channel has # prefix
    const channelName = channel.startsWith('#') ? channel : `#${channel}`;
    
    // Remove # from channel for ban command (tmi.js expects it without #)
    const channelWithoutHash = channelName.replace('#', '');
    
    await client.ban(channelWithoutHash, username, reason);
    
    logger.info('User banned', {
      channel: channelName,
      username,
      reason
    });
    
    return true;
  } catch (error) {
    logger.error('Error banning user', {
      error: error instanceof Error ? error.message : String(error),
      channel,
      username
    });
    return false;
  }
}

/**
 * Unban a user from a Twitch channel
 * 
 * @param channel - The Twitch channel (with or without # prefix)
 * @param username - The Twitch username to unban
 * @returns Promise<boolean> - true if unban was successful
 */
export async function unbanUser(
  channel: string,
  username: string
): Promise<boolean> {
  try {
    const client = getClient();
    if (!client) {
      logger.error('Cannot unban user: Twitch client not initialized');
      return false;
    }

    // Ensure channel has # prefix
    const channelName = channel.startsWith('#') ? channel : `#${channel}`;
    
    // Remove # from channel for unban command (tmi.js expects it without #)
    const channelWithoutHash = channelName.replace('#', '');
    
    await client.unban(channelWithoutHash, username);
    
    // Log to database
    await logModerationAction({
      channelName: channelName,
      twitchUsername: username,
      violationType: 'other',
      offendingWords: [],
      actionTaken: 'unban',
      reason: 'User unbanned',
      totalViolations: 0,
      success: true
    });
    
    logger.info('User unbanned', {
      channel: channelName,
      username
    });
    
    return true;
  } catch (error) {
    logger.error('Error unbanning user', {
      error: error instanceof Error ? error.message : String(error),
      channel,
      username
    });
    return false;
  }
}

/**
 * Check if a Twitch user is banned in a specific channel
 * 
 * @param twitchUsername - The Twitch username to check
 * @param channelName - The channel name (with or without # prefix)
 * @returns Object with ban status information
 */
export async function checkTwitchUserBanStatus(
  twitchUsername: string,
  channelName: string
): Promise<{
  isBanned: boolean;
  isPermanent?: boolean;
  bannedAt?: Date;
  reason?: string;
}> {
  try {
    await connectToMongoDB();
    
    // Normalize channel name (remove #, lowercase)
    const normalizedChannel = channelName.replace('#', '').toLowerCase().trim();
    const normalizedUsername = twitchUsername.toLowerCase().trim();
    
    const violation = await TwitchUserViolation.findOne({
      twitchUsername: normalizedUsername,
      channelName: normalizedChannel
    });
    
    if (!violation) {
      return { isBanned: false };
    }
    
    if (violation.isBanned) {
      return {
        isBanned: true,
        isPermanent: true,
        bannedAt: violation.bannedAt,
        reason: 'Permanent ban due to repeated violations'
      };
    }
    
    return { isBanned: false };
  } catch (error) {
    logger.error('Error checking Twitch user ban status', {
      error: error instanceof Error ? error.message : String(error),
      twitchUsername,
      channelName
    });
    // Fail open - if check fails, assume not banned
    return { isBanned: false };
  }
}

/**
 * Log a moderation action to the database for audit trail
 * 
 * @param logData - The moderation log data
 * @returns Promise<void>
 */
async function logModerationAction(logData: {
  channelName: string;
  twitchUsername: string;
  displayName?: string;
  violationType: 'offensive_content' | 'ai_inappropriate' | 'other';
  offendingWords: string[];
  messageContent?: string;
  actionTaken: 'warning' | 'timeout' | 'ban' | 'unban';
  duration?: number;
  reason: string;
  totalViolations: number;
  success: boolean;
  errorMessage?: string;
}): Promise<void> {
  try {
    await connectToMongoDB();
    
    // Normalize channel and username
    const normalizedChannel = logData.channelName.replace('#', '').toLowerCase().trim();
    const normalizedUsername = logData.twitchUsername.toLowerCase().trim();
    
    // Truncate message content if too long
    const truncatedMessage = logData.messageContent 
      ? logData.messageContent.substring(0, 500)
      : undefined;
    
    await TwitchModerationLog.create({
      timestamp: new Date(),
      channelName: normalizedChannel,
      twitchUsername: normalizedUsername,
      displayName: logData.displayName,
      violationType: logData.violationType,
      offendingWords: logData.offendingWords,
      messageContent: truncatedMessage,
      actionTaken: logData.actionTaken,
      duration: logData.duration,
      reason: logData.reason,
      totalViolations: logData.totalViolations,
      success: logData.success,
      errorMessage: logData.errorMessage
    });
  } catch (error) {
    // Log to console/logger but don't throw - logging failures shouldn't break moderation
    logger.error('Error logging moderation action to database', {
      error: error instanceof Error ? error.message : String(error),
      channel: logData.channelName,
      username: logData.twitchUsername,
      action: logData.actionTaken
    });
  }
}

/**
 * Handle a moderation violation and apply appropriate action
 * Implements progressive moderation: warning → timeout → ban
 * 
 * @param channel - The Twitch channel (with or without # prefix)
 * @param twitchUsername - The Twitch username
 * @param displayName - The display name (for @ mentions)
 * @param moderationResult - The moderation check result
 * @param messageContent - Optional: the original message content (for logging)
 * @returns Promise<boolean> - true if action was taken successfully
 */
export async function handleModerationViolation(
  channel: string,
  twitchUsername: string,
  displayName: string,
  moderationResult: ModerationResult,
  messageContent?: string
): Promise<boolean> {
  try {
    // Normalize channel name (remove #, lowercase)
    const normalizedChannel = channel.replace('#', '').toLowerCase().trim();
    
    // Get moderation configuration (per-channel)
    const config = await getModerationConfig(normalizedChannel);
    
    // Check if moderation is enabled
    if (!config.enabled) {
      logger.debug('Moderation is disabled, skipping action', {
        twitchUsername,
        channel
      });
      return false;
    }
    
    await connectToMongoDB();
    
    // normalizedChannel already set above
    const normalizedUsername = twitchUsername.toLowerCase().trim();
    
    // Get or create violation record for this user in this channel
    let violation = await TwitchUserViolation.findOne({
      twitchUsername: normalizedUsername,
      channelName: normalizedChannel
    });
    
    if (!violation) {
      // Create new violation record
      violation = await TwitchUserViolation.create({
        twitchUsername: normalizedUsername,
        channelName: normalizedChannel,
        violations: [],
        warningCount: 0,
        timeoutCount: 0,
        isBanned: false
      });
    }
    
    // Check if user is already banned
    if (violation.isBanned) {
      logger.info('User is already banned, skipping moderation action', {
        twitchUsername: normalizedUsername,
        channel: normalizedChannel
      });
      return false; // Already banned, no action needed
    }
    
    // Determine violation count (total violations = warningCount)
    // warningCount tracks total violations, timeoutCount tracks how many timeouts
    const totalViolations = violation.warningCount + 1; // +1 for this violation
    
    // Determine action based on violation count and configuration
    let actionTaken: 'warning' | 'timeout' | 'ban' = 'warning';
    let timeoutDuration = 0;
    let actionSuccess = false;
    
    // Create violation record with appropriate action
    let violationRecord: {
      offendingWords: string[];
      message: string;
      timestamp: Date;
      actionTaken: 'warning' | 'timeout' | 'ban';
      duration?: number;
      reason: string;
    };
    
    if (totalViolations === 1) {
      // First violation: Warning only (or timeout if configured)
      actionTaken = config.timeoutDurations.first > 0 ? 'timeout' : 'warning';
      timeoutDuration = config.timeoutDurations.first;
      
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: messageContent || '',
        timestamp: new Date(),
        actionTaken: actionTaken,
        duration: timeoutDuration > 0 ? timeoutDuration : undefined,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      if (actionTaken === 'warning') {
        actionSuccess = await sendWarningMessage(
          channel,
          twitchUsername,
          displayName,
          `Inappropriate content: ${moderationResult.offendingWords.join(', ')}`
        );
      } else {
        actionSuccess = await timeoutUser(
          channel,
          twitchUsername,
          timeoutDuration,
          `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
        );
        violation.timeoutCount = 1;
        violation.lastTimeoutAt = new Date();
        violation.lastTimeoutDuration = timeoutDuration;
      }
      
      violation.warningCount = 1;
      violation.violations.push(violationRecord);
      
      logger.info('First violation - action taken', {
        twitchUsername: normalizedUsername,
        channel: normalizedChannel,
        action: actionTaken,
        duration: timeoutDuration,
        offendingWords: moderationResult.offendingWords
      });
      
    } else if (totalViolations === 2) {
      // Second violation: Use configured timeout duration
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.second;
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: messageContent || '',
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        channel,
        twitchUsername,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = 2;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
      
      logger.info('Second violation - timeout applied', {
        twitchUsername: normalizedUsername,
        channel: normalizedChannel,
        duration: timeoutDuration
      });
      
    } else if (totalViolations === 3) {
      // Third violation: Use configured timeout duration
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.third;
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: messageContent || '',
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        channel,
        twitchUsername,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = 3;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
      
      logger.info('Third violation - timeout applied', {
        twitchUsername: normalizedUsername,
        channel: normalizedChannel,
        duration: timeoutDuration
      });
      
    } else if (totalViolations === 4) {
      // Fourth violation: Use configured timeout duration
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.fourth;
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: messageContent || '',
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        channel,
        twitchUsername,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = 4;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
      
      logger.info('Fourth violation - timeout applied', {
        twitchUsername: normalizedUsername,
        channel: normalizedChannel,
        duration: timeoutDuration
      });
      
    } else if (totalViolations >= config.maxViolationsBeforeBan) {
      // Max violations reached: Permanent ban
      actionTaken = 'ban';
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: messageContent || '',
        timestamp: new Date(),
        actionTaken: 'ban',
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await banUser(
        channel,
        twitchUsername,
        `Repeated violations (${totalViolations}): ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = totalViolations;
      violation.timeoutCount = violation.timeoutCount; // Keep existing count
      violation.isBanned = true;
      violation.bannedAt = new Date();
      violation.violations.push(violationRecord);
      
      logger.warn('Max violations reached - permanent ban', {
        twitchUsername: normalizedUsername,
        channel: normalizedChannel,
        totalViolations,
        maxViolations: config.maxViolationsBeforeBan
      });
    } else {
      // Between 4th and max violations: Continue with longest timeout
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.fourth; // Use longest timeout
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: messageContent || '',
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        channel,
        twitchUsername,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = totalViolations;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
      
      logger.info('Additional violation - extended timeout', {
        twitchUsername: normalizedUsername,
        channel: normalizedChannel,
        totalViolations,
        duration: timeoutDuration
      });
    }
    
    // Save violation record
    await violation.save();
    
    // Log moderation action to database and logger (if logging is enabled)
    if (config.logAllActions) {
      await logModerationAction({
      channelName: normalizedChannel,
      twitchUsername: normalizedUsername,
      displayName: displayName,
      violationType: 'offensive_content',
      offendingWords: moderationResult.offendingWords,
      messageContent: messageContent,
      actionTaken: actionTaken,
      duration: timeoutDuration || undefined,
      reason: moderationResult.reason || 'Offensive content detected',
      totalViolations:       totalViolations,
      success: actionSuccess,
      errorMessage: actionSuccess ? undefined : 'Action execution failed'
      });
    }
    
    // Also log to structured logger
    logger.info('Moderation action executed', {
      twitchUsername: normalizedUsername,
      channel: normalizedChannel,
      action: actionTaken,
      duration: timeoutDuration || undefined,
      totalViolations,
      success: actionSuccess
    });
    
    return actionSuccess;
  } catch (error) {
    logger.error('Error handling moderation violation', {
      error: error instanceof Error ? error.message : String(error),
      twitchUsername,
      channel,
      offendingWords: moderationResult.offendingWords
    });
    return false;
  }
}

