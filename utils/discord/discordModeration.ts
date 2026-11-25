import { findOffensiveWords } from '../contentModeration';
import { logger } from '../logger';
import { getClient } from '../discordBot';
import connectToMongoDB from '../mongodb';
import DiscordUserViolation from '../../models/DiscordUserViolation';
import DiscordModerationLog from '../../models/DiscordModerationLog';
import { getDiscordModerationConfig } from '../../config/discordModerationConfig';
import { GuildMember, Message, TextChannel, DMChannel } from 'discord.js';

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
  /** Reason for rejection (if shouldProcess is false) */
  reason?: string;
}

/**
 * Check if a user's message contains offensive content
 * This is used BEFORE processing with AI - if offensive, we don't process the message
 * 
 * @param message - The message content to check
 * @param discordUserId - The Discord user ID
 * @param guildId - Optional: The Discord server (guild) ID
 * @returns ModerationResult indicating if content is offensive and if message should be processed
 */
export async function checkMessageContent(
  message: string,
  discordUserId: string,
  guildId?: string
): Promise<ModerationResult> {
  try {
    // Get moderation configuration (per-server if guildId provided)
    const config = await getDiscordModerationConfig(guildId);
    
    // Check if moderation is enabled
    if (!config.enabled) {
      return {
        isOffensive: false,
        offendingWords: [],
        shouldProcess: true,
      };
    }
    
    // Pure word check - records nothing. Violations are tracked separately in DiscordUserViolation
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
    logger.warn('Offensive content detected in Discord message', {
      discordUserId,
      guildId: guildId || 'DM',
      offendingWords: moderationCheck.offendingWords,
      messagePreview: message.substring(0, 100), // Log first 100 chars for context
    });

    return {
      isOffensive: true,
      offendingWords: moderationCheck.offendingWords,
      shouldProcess: false, // Don't process offensive messages
      reason: 'Message contains offensive content',
    };
  } catch (error) {
    // If moderation check fails, log error but allow processing (fail open)
    // This prevents moderation system failures from breaking the bot
    logger.error('Error checking message content for moderation', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId,
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
 * @param discordUserId - The Discord user ID (for logging purposes only)
 * @param guildId - Optional: The Discord server (guild) ID (for logging purposes)
 * @returns ModerationResult indicating if response is inappropriate
 */
export async function checkAIResponse(
  response: string,
  discordUserId: string,
  guildId?: string
): Promise<ModerationResult> {
  try {
    // Get moderation configuration (per-server if guildId provided)
    const config = await getDiscordModerationConfig(guildId);
    
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
      discordUserId,
      guildId: guildId || 'DM',
      offendingWords: moderationCheck.offendingWords,
      responsePreview: response.substring(0, 200), // Log first 200 chars for review
      note: 'This is AI-generated content, not user-generated. User should not be penalized.',
    });

    // Log AI response filtering to database (for review, not for user penalty)
    // Only log if logging is enabled
    if (config.logAllActions) {
      await logModerationAction({
        guildId: guildId || 'DM',
        discordUserId: discordUserId,
        username: undefined, // Will be filled if available
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
    };
  } catch (error) {
    // If moderation check fails, log error but allow sending (fail open)
    // This prevents moderation system failures from breaking the bot
    logger.error('Error checking AI response for moderation', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId,
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
 * Get a safe fallback response when AI generates inappropriate content
 * This replaces the inappropriate AI response
 * 
 * @returns A safe, generic response message
 */
export function getSafeFallbackResponse(): string {
  return "I apologize, but I'm unable to provide a response to that question. Please feel free to ask me something else about video games!";
}

/**
 * Check if a Discord user is banned in a specific server
 * 
 * @param discordUserId - The Discord user ID to check
 * @param guildId - The Discord server (guild) ID
 * @returns Object with ban status information
 */
export async function checkDiscordUserBanStatus(
  discordUserId: string,
  guildId: string
): Promise<{
  isBanned: boolean;
  isPermanent?: boolean;
  bannedAt?: Date;
  reason?: string;
}> {
  try {
    await connectToMongoDB();
    
    const violation = await DiscordUserViolation.findOne({
      discordUserId: discordUserId.trim(),
      guildId: guildId.trim()
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
    logger.error('Error checking Discord user ban status', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId,
      guildId
    });
    // Fail open - if check fails, assume not banned
    return { isBanned: false };
  }
}

/**
 * Send a warning message to a user via DM
 * Used for first violation - no timeout, just a warning
 * 
 * @param message - The Discord message object
 * @param reason - Reason for the warning
 * @returns Promise<boolean> - true if warning was sent successfully
 */
export async function sendWarningMessage(
  message: Message,
  reason: string
): Promise<boolean> {
  try {
    const warningMessage = `⚠️ **Warning**: Your message contains inappropriate content. Please keep interactions respectful.\n\n**Reason**: ${reason}\n\nRepeated violations may result in timeouts or bans.`;
    
    try {
      await message.author.send(warningMessage);
      logger.info('Warning message sent via DM', {
        discordUserId: message.author.id,
        username: message.author.username,
        reason
      });
      return true;
    } catch (dmError) {
      // If DM fails (user has DMs disabled), try to reply in channel (if in a server)
      if (message.guild && message.channel instanceof TextChannel) {
        try {
          await message.reply(`⚠️ **Warning**: Your message contains inappropriate content. Please keep interactions respectful.\n\n**Reason**: ${reason}`);
          logger.info('Warning message sent in channel (DM failed)', {
            discordUserId: message.author.id,
            username: message.author.username,
            reason
          });
          return true;
        } catch (channelError) {
          logger.error('Failed to send warning message', {
            error: channelError instanceof Error ? channelError.message : String(channelError),
            discordUserId: message.author.id
          });
          return false;
        }
      }
      logger.error('Failed to send warning message via DM', {
        error: dmError instanceof Error ? dmError.message : String(dmError),
        discordUserId: message.author.id
      });
      return false;
    }
  } catch (error) {
    logger.error('Error sending warning message', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId: message.author.id
    });
    return false;
  }
}

/**
 * Timeout a user in a Discord server
 * Note: Discord timeouts are implemented as temporary role restrictions
 * 
 * @param member - The GuildMember to timeout
 * @param duration - Duration in seconds (e.g., 300 for 5 minutes)
 * @param reason - Reason for the timeout
 * @returns Promise<boolean> - true if timeout was successful
 */
export async function timeoutUser(
  member: GuildMember,
  duration: number,
  reason: string
): Promise<boolean> {
  try {
    // Discord.js v14 timeout expects a Date object for when the timeout expires
    // Convert duration from seconds to milliseconds and add to current time
    const timeoutUntil = new Date(Date.now() + duration * 1000);
    
    // Discord.js timeout method signature: timeout(communicationDisabledUntil: Date | null, options?: { reason?: string })
    // TypeScript types may be incorrect, so we use type assertion
    await (member.timeout as any)(timeoutUntil, { reason });
    
    logger.info('User timed out', {
      discordUserId: member.id,
      username: member.user.username,
      guildId: member.guild.id,
      duration,
      reason
    });
    
    return true;
  } catch (error) {
    logger.error('Error timing out user', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId: member.id,
      guildId: member.guild.id,
      duration
    });
    return false;
  }
}

/**
 * Permanently ban a user from a Discord server
 * 
 * @param member - The GuildMember to ban
 * @param reason - Reason for the ban
 * @returns Promise<boolean> - true if ban was successful
 */
export async function banUser(
  member: GuildMember,
  reason: string
): Promise<boolean> {
  try {
    await member.ban({ reason: reason });
    
    logger.info('User banned', {
      discordUserId: member.id,
      username: member.user.username,
      guildId: member.guild.id,
      reason
    });
    
    return true;
  } catch (error) {
    logger.error('Error banning user', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId: member.id,
      guildId: member.guild.id
    });
    return false;
  }
}

/**
 * Kick a user from a Discord server
 * 
 * @param member - The GuildMember to kick
 * @param reason - Reason for the kick
 * @returns Promise<boolean> - true if kick was successful
 */
export async function kickUser(
  member: GuildMember,
  reason: string
): Promise<boolean> {
  try {
    await member.kick(reason);
    
    logger.info('User kicked', {
      discordUserId: member.id,
      username: member.user.username,
      guildId: member.guild.id,
      reason
    });
    
    return true;
  } catch (error) {
    logger.error('Error kicking user', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId: member.id,
      guildId: member.guild.id
    });
    return false;
  }
}

/**
 * Log a moderation action to the database for audit trail
 * 
 * @param logData - The moderation log data
 * @returns Promise<void>
 */
async function logModerationAction(logData: {
  guildId: string;
  discordUserId: string;
  username?: string;
  violationType: 'offensive_content' | 'ai_inappropriate' | 'other';
  offendingWords: string[];
  messageContent?: string;
  actionTaken: 'warning' | 'timeout' | 'ban' | 'kick' | 'unban';
  duration?: number;
  reason: string;
  totalViolations: number;
  success: boolean;
  errorMessage?: string;
}): Promise<void> {
  try {
    await connectToMongoDB();
    
    // Truncate message content if too long
    const truncatedMessage = logData.messageContent 
      ? logData.messageContent.substring(0, 500)
      : undefined;
    
    await DiscordModerationLog.create({
      timestamp: new Date(),
      guildId: logData.guildId.trim(),
      discordUserId: logData.discordUserId.trim(),
      username: logData.username,
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
      guildId: logData.guildId,
      discordUserId: logData.discordUserId,
      action: logData.actionTaken
    });
  }
}

/**
 * Handle a moderation violation and apply appropriate action
 * Implements progressive moderation: warning → timeout → ban
 * 
 * @param message - The Discord message object
 * @param moderationResult - The moderation check result
 * @returns Promise<boolean> - true if action was taken successfully
 */
export async function handleModerationViolation(
  message: Message,
  moderationResult: ModerationResult
): Promise<boolean> {
  try {
    // For DMs, we can only warn (no timeout/ban/kick possible)
    const isDM = !message.guild;
    const guildId = message.guild?.id || 'DM';
    
    // Get moderation configuration (per-server if in a server)
    const config = await getDiscordModerationConfig(guildId !== 'DM' ? guildId : undefined);
    
    // Check if moderation is enabled
    if (!config.enabled) {
      logger.debug('Moderation is disabled, skipping action', {
        discordUserId: message.author.id,
        guildId
      });
      return false;
    }
    
    // For DMs, only warn - can't timeout/ban/kick in DMs
    if (isDM) {
      const warningSuccess = await sendWarningMessage(
        message,
        `Inappropriate content: ${moderationResult.offendingWords.join(', ')}`
      );
      
      // Log the action even for DMs
      if (config.logAllActions) {
        await logModerationAction({
          guildId: 'DM',
          discordUserId: message.author.id,
          username: message.author.username,
          violationType: 'offensive_content',
          offendingWords: moderationResult.offendingWords,
          messageContent: message.content.substring(0, 500),
          actionTaken: 'warning',
          reason: moderationResult.reason || 'Offensive content detected',
          totalViolations: 1, // DMs don't track violations, just warn
          success: warningSuccess
        });
      }
      
      return warningSuccess;
    }
    
    // For server messages, implement full progressive moderation
    await connectToMongoDB();
    
    const normalizedUserId = message.author.id.trim();
    const normalizedGuildId = guildId.trim();
    
    // Get or create violation record for this user in this server
    let violation = await DiscordUserViolation.findOne({
      discordUserId: normalizedUserId,
      guildId: normalizedGuildId
    });
    
    if (!violation) {
      // Create new violation record
      violation = await DiscordUserViolation.create({
        discordUserId: normalizedUserId,
        guildId: normalizedGuildId,
        violations: [],
        warningCount: 0,
        timeoutCount: 0,
        kickCount: 0,
        isBanned: false
      });
    }
    
    // Check if user is already banned
    if (violation.isBanned) {
      logger.info('User is already banned, skipping moderation action', {
        discordUserId: normalizedUserId,
        guildId: normalizedGuildId
      });
      return false; // Already banned, no action needed
    }
    
    // Get the guild member (needed for moderation actions)
    const member = await message.guild!.members.fetch(message.author.id).catch(() => null);
    if (!member) {
      logger.warn('Could not fetch guild member for moderation action', {
        discordUserId: message.author.id,
        guildId: normalizedGuildId
      });
      return false;
    }
    
    // Determine violation count (total violations = warningCount)
    const totalViolations = violation.warningCount + 1; // +1 for this violation
    
    // Determine action based on violation count and configuration
    let actionTaken: 'warning' | 'timeout' | 'ban' | 'kick' = 'warning';
    let timeoutDuration = 0;
    let actionSuccess = false;
    
    // Create violation record with appropriate action
    let violationRecord: {
      offendingWords: string[];
      message: string;
      timestamp: Date;
      actionTaken: 'warning' | 'timeout' | 'ban' | 'kick';
      duration?: number;
      reason: string;
    };
    
    if (totalViolations === 1) {
      // First violation: Warning only (or timeout if configured)
      actionTaken = config.timeoutDurations.first > 0 ? 'timeout' : 'warning';
      timeoutDuration = config.timeoutDurations.first;
      
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: message.content.substring(0, 500),
        timestamp: new Date(),
        actionTaken: actionTaken,
        duration: timeoutDuration > 0 ? timeoutDuration : undefined,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      if (actionTaken === 'warning') {
        actionSuccess = await sendWarningMessage(
          message,
          `Inappropriate content: ${moderationResult.offendingWords.join(', ')}`
        );
      } else {
        actionSuccess = await timeoutUser(
          member,
          timeoutDuration,
          `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
        );
        violation.timeoutCount = 1;
        violation.lastTimeoutAt = new Date();
        violation.lastTimeoutDuration = timeoutDuration;
      }
      
      violation.warningCount = 1;
      violation.violations.push(violationRecord);
      
    } else if (totalViolations === 2) {
      // Second violation: Use configured timeout duration
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.second;
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: message.content.substring(0, 500),
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        member,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = 2;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
      
    } else if (totalViolations === 3) {
      // Third violation: Use configured timeout duration
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.third;
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: message.content.substring(0, 500),
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        member,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = 3;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
      
    } else if (totalViolations === 4) {
      // Fourth violation: Use configured timeout duration
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.fourth;
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: message.content.substring(0, 500),
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        member,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = 4;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
      
    } else if (totalViolations >= config.maxViolationsBeforeBan) {
      // Max violations reached: Permanent ban
      actionTaken = 'ban';
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: message.content.substring(0, 500),
        timestamp: new Date(),
        actionTaken: 'ban',
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await banUser(
        member,
        `Repeated violations (${totalViolations}): ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = totalViolations;
      violation.isBanned = true;
      violation.bannedAt = new Date();
      violation.violations.push(violationRecord);
      
    } else {
      // Between 4th and max violations: Continue with longest timeout
      actionTaken = 'timeout';
      timeoutDuration = config.timeoutDurations.fourth; // Use longest timeout
      violationRecord = {
        offendingWords: moderationResult.offendingWords,
        message: message.content.substring(0, 500),
        timestamp: new Date(),
        actionTaken: 'timeout',
        duration: timeoutDuration,
        reason: moderationResult.reason || 'Offensive content detected'
      };
      
      actionSuccess = await timeoutUser(
        member,
        timeoutDuration,
        `Repeated violations: ${moderationResult.offendingWords.join(', ')}`
      );
      
      violation.warningCount = totalViolations;
      violation.timeoutCount = violation.timeoutCount + 1;
      violation.lastTimeoutAt = new Date();
      violation.lastTimeoutDuration = timeoutDuration;
      violation.violations.push(violationRecord);
    }
    
    // Save violation record
    await violation.save();
    
    // Log moderation action to database and logger (if logging is enabled)
    if (config.logAllActions) {
      await logModerationAction({
        guildId: normalizedGuildId,
        discordUserId: normalizedUserId,
        username: message.author.username,
        violationType: 'offensive_content',
        offendingWords: moderationResult.offendingWords,
        messageContent: message.content.substring(0, 500),
        actionTaken: actionTaken,
        duration: timeoutDuration || undefined,
        reason: moderationResult.reason || 'Offensive content detected',
        totalViolations: totalViolations,
        success: actionSuccess,
        errorMessage: actionSuccess ? undefined : 'Action execution failed'
      });
    }
    
    // Also log to structured logger
    logger.info('Moderation action executed', {
      discordUserId: normalizedUserId,
      guildId: normalizedGuildId,
      action: actionTaken,
      duration: timeoutDuration || undefined,
      totalViolations,
      success: actionSuccess
    });
    
    return actionSuccess;
  } catch (error) {
    logger.error('Error handling moderation violation', {
      error: error instanceof Error ? error.message : String(error),
      discordUserId: message.author.id,
      guildId: message.guild?.id || 'DM',
      offendingWords: moderationResult.offendingWords
    });
    return false;
  }
}

