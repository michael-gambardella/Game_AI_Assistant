import { Client, Message, EmbedBuilder, ChannelType } from 'discord.js';
import { botConfig } from '../../config/botConfig';
import { getChatCompletion } from '../aiHelper';
import { checkProAccess } from '../proAccessUtil';
import { logger } from '../logger';
import { connectToWingmanDB } from '../databaseConnections';
import User from '../../models/User';
import {
  checkMessageContent,
  checkAIResponse,
  checkDiscordUserBanStatus,
  handleModerationViolation,
  getSafeFallbackResponse
} from './discordModeration';

// Rate limiting configuration
interface RateLimit {
  timestamp: number;
  count: number;
}

export class DiscordBotHandler {
  private client: Client;
  private rateLimits: Map<string, RateLimit>;
  private responseCache: Map<string, { response: string; timestamp: number }>;
  private messageQueue: Map<string, Promise<void>>;
  private processedMessages: Map<string, number>; // Track processed messages to prevent duplicates
  private processingMessages: Set<string>; // Track messages currently being processed
  private sentResponses: Set<string>; // Track message IDs we've already sent responses to
  private activeReplies: Set<string>; // Track message IDs that are currently being replied to (prevent concurrent replies)
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly MAX_MESSAGES_PER_WINDOW = 10;
  private readonly CACHE_TTL = 300000; // 5 minutes
  private readonly MAX_RETRIES = 3;
  private readonly MESSAGE_DEDUP_WINDOW = 10000; // 10 seconds - prevent processing same message twice
  private messageHandler: ((message: Message) => Promise<void>) | null = null;

  constructor(client: Client) {
    this.client = client;
    this.rateLimits = new Map();
    this.responseCache = new Map();
    this.messageQueue = new Map();
    this.processedMessages = new Map();
    this.processingMessages = new Set();
    this.sentResponses = new Set();
    this.activeReplies = new Set();
    this.setupEventHandlers();
    this.startMaintenanceTasks();
  }

  private setupEventHandlers() {
    // Remove ALL existing messageCreate listeners to prevent duplicates
    // This is important during hot-reload or reinitialization
    this.client.removeAllListeners('messageCreate');
    
    // Create the handler function
    this.messageHandler = async (message: Message) => {
      if (message.author.bot) return;
      
      // Log every message event received for debugging
      logger.debug('messageCreate event fired', {
        messageId: message.id,
        userId: message.author.id,
        username: message.author.username,
        content: message.content.substring(0, 50),
        timestamp: new Date().toISOString()
      });
      
      // Determine if message is a DM or in a server channel
      // Check both channel type and guild presence (guild is null for DMs)
      const isDM = message.channel.type === ChannelType.DM || message.guild === null;
      
      // For server channels, only respond if bot is mentioned
      // This is better for security and prevents processing every message
      if (!isDM) {
        if (!this.client.user) {
          // Bot user not available yet, skip
          return;
        }
        
        // Check for bot mention in multiple ways
        const directMention = message.mentions.has(this.client.user.id);
        const userIdMention = message.content.includes(`<@${this.client.user.id}>`);
        const nicknameMention = message.content.includes(`<@!${this.client.user.id}>`);
        
        // Check if bot is in any mentioned roles (non-blocking, use cache)
        let botInMentionedRole = false;
        if (message.mentions.roles.size > 0 && message.guild) {
          try {
            const botMember = message.guild.members.cache.get(this.client.user.id);
            if (botMember) {
              botInMentionedRole = Array.from(message.mentions.roles.keys()).some(roleId => 
                botMember.roles.cache.has(roleId)
              );
            }
          } catch (e) {
            // If cache lookup fails, ignore (non-critical)
          }
        }
        
        const botMentioned = directMention || userIdMention || nicknameMention || botInMentionedRole;
        
        if (!botMentioned) {
          // Bot not mentioned in server channel - ignore for security/privacy
          return;
        }
        
        // Log mention details for debugging
        logger.debug('Bot mention detected', {
          messageId: message.id,
          directMention,
          userIdMention,
          nicknameMention,
          botInMentionedRole,
          mentionedRoles: Array.from(message.mentions.roles.keys()),
          botUserId: this.client.user.id
        });
      }
      
      // Use Discord's unique message ID to prevent duplicate processing
      // Discord message IDs are unique and persistent, perfect for deduplication
      const messageId = message.id;
      
      // CRITICAL: Check if we've already sent a response to this message BEFORE queuing
      // This prevents duplicate processing if the event fires twice
      if (messageId && this.sentResponses.has(messageId)) {
        logger.warn('Message event received but response already sent, preventing duplicate queue', {
          userId: message.author.id,
          username: message.author.username,
          messageId: messageId
        });
        return; // Already sent response, don't queue for processing
      }
      
      if (!messageId) {
        logger.warn('Message ID is missing, cannot deduplicate', {
          userId: message.author.id,
          username: message.author.username,
          content: message.content.substring(0, 50)
        });
        // Continue processing but log the issue
      }
      
      // Check if this message is currently being processed
      if (messageId && this.processingMessages.has(messageId)) {
        logger.info('Message already being processed, ignoring duplicate', {
          userId: message.author.id,
          username: message.author.username,
          messageId: messageId,
          content: message.content.substring(0, 50)
        });
        return; // Already processing this message
      }

      // Check if we've already processed this message recently
      const lastProcessed = this.processedMessages.get(messageId);
      const now = Date.now();
      if (messageId && lastProcessed && (now - lastProcessed) < this.MESSAGE_DEDUP_WINDOW) {
        logger.info('Duplicate message detected, ignoring', {
          userId: message.author.id,
          username: message.author.username,
          messageId: messageId,
          timeSinceLastProcessed: now - lastProcessed,
          content: message.content.substring(0, 50)
        });
        return; // Already processed this message recently
      }

      // Mark message as being processed (only if we have a message ID)
      if (messageId) {
        this.processingMessages.add(messageId);
        this.processedMessages.set(messageId, now);
      }
      
      // CRITICAL: Check if we've already sent a response to this message BEFORE queuing
      // This prevents duplicate processing if the event fires twice
      if (messageId && this.sentResponses.has(messageId)) {
        logger.warn('Message event received but response already sent, preventing duplicate queue', {
          userId: message.author.id,
          username: message.author.username,
          messageId: messageId
        });
        return; // Already sent response, don't queue for processing
      }
      
      // Log message received for debugging
      logger.info('Discord message received', {
        userId: message.author.id,
        username: message.author.username,
        channelType: message.channel.type,
        isDM,
        hasGuild: !!message.guild,
        botMentioned: !isDM, // In server channels, we only process if mentioned
        content: message.content.substring(0, 100), // First 100 chars
        guildId: message.guild?.id || 'DM',
        messageId: messageId
      });
      
      try {
        // Check rate limits
        if (!this.checkRateLimit(message.author.id)) {
          logger.warn('Rate limit exceeded', { userId: message.author.id });
          await message.reply("You're sending messages too quickly. Please wait a moment.");
          return;
        }

        // Queue message processing
        const processing = this.messageQueue.get(message.author.id) || Promise.resolve();
        const newProcessing = processing.then(() => this.handleMessage(message));
        this.messageQueue.set(message.author.id, newProcessing);

      } catch (error) {
        this.handleError(error, message);
      }
    };
    
    // Register the handler (only once, prevents duplicates during hot-reload)
    this.client.on('messageCreate', this.messageHandler);
    
    // Log listener count for debugging
    const listenerCount = this.client.listenerCount('messageCreate');
    logger.info(`Discord bot event listener registered`, {
      listenerCount,
      botId: this.client.user?.id || 'not logged in yet',
      timestamp: new Date().toISOString()
    });
    
    if (listenerCount > 1) {
      logger.warn(`⚠️ Multiple messageCreate listeners detected: ${listenerCount} - This may cause duplicate responses!`, {
        listenerCount
      });
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    const messageId = message.id;
    
    // CRITICAL: Check if we've already sent a response to this message
    // This must be the FIRST check, before any processing
    if (this.sentResponses.has(messageId)) {
      logger.warn('handleMessage called but response already sent, preventing duplicate processing', {
        userId: message.author.id,
        username: message.author.username,
        messageId: messageId,
        stackTrace: new Error().stack?.split('\n').slice(0, 8).join('\n')
      });
      return; // Already sent response, don't process again
    }
    
    try {
      logger.info('Processing Discord message', {
        userId: message.author.id,
        username: message.author.username,
        messageId: messageId,
        contentLength: message.content.length
      });
      
      // Map Discord user ID to Video Game Wingman username
      // First, try to find user by Discord user ID (userId field)
      let wingmanUsername: string | null = null;
      try {
        await connectToWingmanDB();
        const user = await User.findOne({ userId: message.author.id });
        if (user) {
          wingmanUsername = user.username;
          logger.info('Found Video Game Wingman user by Discord ID', {
            discordId: message.author.id,
            wingmanUsername: wingmanUsername
          });
        } else {
          // If not found by userId, try by Discord username as fallback for testing
          // This helps with local testing where Discord account might not be linked
          logger.info('User not found by Discord ID, checking by username', {
            discordId: message.author.id,
            discordUsername: message.author.username
          });
        }
      } catch (error) {
        logger.error('Error looking up user by Discord ID', {
          error: error instanceof Error ? error.message : String(error),
          discordId: message.author.id
        });
      }
      
      // Check Pro access using username if found, otherwise fall back to Discord ID
      // For local testing: if Discord username is "thelegendaryrenegade", grant access
      const identifier = wingmanUsername || 
                         (message.author.username.toLowerCase() === 'thelegendaryrenegade' ? 'TestUser1' : message.author.id);
      
      logger.info('Checking Pro access', { 
        discordId: message.author.id,
        identifier,
        usingUsername: !!wingmanUsername
      });
      const hasAccess = await this.retryOperation(() => checkProAccess(identifier));
      
      logger.info('Pro access check result', {
        userId: message.author.id,
        identifier,
        hasAccess
      });
      
      if (!hasAccess) {
        logger.warn('Pro access denied', { userId: message.author.id });
        await message.reply({
          embeds: [this.createProAccessEmbed()]
        });
        return;
      }

      // MODERATION: Check if user is banned (only for server messages, not DMs)
      if (message.guild) {
        const banStatus = await checkDiscordUserBanStatus(message.author.id, message.guild.id);
        if (banStatus.isBanned) {
          logger.info('Banned user attempted to use bot', {
            userId: message.author.id,
            username: message.author.username,
            guildId: message.guild.id,
            isPermanent: banStatus.isPermanent
          });
          // Silently reject - don't respond to banned users
          return;
        }
      }

      // MODERATION: Check message content for offensive content BEFORE processing
      const guildId = message.guild?.id;
      const moderationCheck = await checkMessageContent(
        message.content,
        message.author.id,
        guildId
      );

      if (moderationCheck.isOffensive) {
        logger.warn('Offensive content detected, handling violation', {
          userId: message.author.id,
          username: message.author.username,
          guildId: guildId || 'DM',
          offendingWords: moderationCheck.offendingWords
        });

        // Handle the violation (warn, timeout, or ban based on violation count)
        await handleModerationViolation(message, moderationCheck);

        // Don't process the message with AI - stop here
        return;
      }

      // Check cache first
      const cachedResponse = this.getCachedResponse(message.content);
      if (cachedResponse) {
        // MODERATION: Check cached response for inappropriate content
        const cachedResponseCheck = await checkAIResponse(
          cachedResponse,
          message.author.id,
          guildId
        );
        
        if (cachedResponseCheck.isOffensive) {
          logger.warn('Cached response contains inappropriate content, using safe fallback', {
            userId: message.author.id
          });
          
          // Atomic check before sending safe fallback
          if (this.sentResponses.has(messageId)) {
            logger.warn('Response already sent (cached safe fallback check), skipping', { messageId });
            return;
          }
          
          // sendLongMessage will handle the sentResponses check and marking atomically
          await this.sendLongMessage(message, getSafeFallbackResponse());
          return;
        }
        
        // Atomic check before sending cached response
        if (this.sentResponses.has(messageId)) {
          logger.warn('Response already sent (cached response check), skipping', { messageId });
          return;
        }
        
        // sendLongMessage will handle the sentResponses check and marking atomically
        await this.sendLongMessage(message, cachedResponse);
        return;
      }

      // Process the message
      logger.info('Generating AI response', { userId: message.author.id });
      const response = await this.processMessage(message);
      if (response) {
        // MODERATION: Check AI response for inappropriate content BEFORE sending
        const responseCheck = await checkAIResponse(
          response,
          message.author.id,
          guildId
        );

        if (responseCheck.isOffensive) {
          logger.warn('AI generated inappropriate response, using safe fallback', {
            userId: message.author.id,
            offendingWords: responseCheck.offendingWords
          });
          
          // Atomic check before sending safe response
          if (this.sentResponses.has(messageId)) {
            logger.warn('Response already sent (safe fallback check), skipping', { messageId });
            return;
          }
          
          // Replace with safe fallback instead of inappropriate content
          const safeResponse = getSafeFallbackResponse();
          this.cacheResponse(message.content, safeResponse);
          // sendLongMessage will handle the sentResponses check and marking atomically
          await this.sendLongMessage(message, safeResponse);
          return;
        }

        // ATOMIC CHECK: Ensure we haven't already sent a response to this message
        // This must be done atomically to prevent race conditions
        if (this.sentResponses.has(messageId)) {
          logger.warn('Response already sent for this message (atomic check), skipping duplicate send', {
            userId: message.author.id,
            messageId: messageId
          });
          return; // Already sent response, don't send again
        }

        // Cache the response
        this.cacheResponse(message.content, response);
        logger.info('Sending response to user', {
          userId: message.author.id,
          messageId: messageId,
          responseLength: response.length
        });
        
        // Split long messages into chunks (Discord has 2000 character limit)
        // Note: sendLongMessage will handle the sentResponses check and marking atomically
        await this.sendLongMessage(message, response);
        logger.info('Response sent successfully', { 
          userId: message.author.id,
          messageId: messageId
        });
      } else {
        logger.warn('No response generated', { userId: message.author.id });
      }
    } catch (error) {
      logger.error('Error in handleMessage', {
        error,
        userId: message.author.id,
        messageId: messageId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.handleError(error, message);
    } finally {
      // Remove from processing set when done
      if (messageId) {
        this.processingMessages.delete(messageId);
      }
    }
  }

  private async processMessage(message: Message): Promise<string> {
    const question = message.content;
    
    try {
      // Create a system message using botConfig
      const systemMessage = this.createSystemMessage();

      // Get AI response with retry mechanism
      const response = await this.retryOperation(() => 
        getChatCompletion(question, systemMessage)
      );

      return response || this.createFallbackResponse();
    } catch (error) {
      logger.error('Error getting chat completion:', error);
      throw error;
    }
  }

  private createSystemMessage(): string {
    return `You are ${botConfig.name}, ${botConfig.description}. 
Your expertise includes: ${botConfig.knowledge.join(', ')}. 
Character: ${botConfig.bio[0]}`;
  }

  private createFallbackResponse(): string {
    return `I apologize, but I was unable to generate a response. As ${botConfig.name}, I aim to provide helpful gaming advice and information.`;
  }

  /**
   * Split and send long messages that exceed Discord's 2000 character limit
   * Attempts to split at sentence boundaries when possible
   */
  private async sendLongMessage(message: Message, text: string): Promise<void> {
    const MAX_LENGTH = 2000; // Discord's message limit
    const messageId = message.id;
    
    // ATOMIC CHECK: Ensure we haven't already sent a response to this message
    // This must be the FIRST check and done atomically to prevent race conditions
    if (this.sentResponses.has(messageId)) {
      logger.warn('sendLongMessage called but response already sent, preventing duplicate', {
        messageId,
        userId: message.author.id,
        stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n') // Log where this is being called from
      });
      return; // Already sent, don't send again
    }
    
    // Check if a reply is currently in progress for this message
    if (this.activeReplies.has(messageId)) {
      logger.warn('sendLongMessage called but reply already in progress, preventing duplicate', {
        messageId,
        userId: message.author.id
      });
      return; // Reply already in progress, don't start another one
    }
    
    // Mark as being replied to IMMEDIATELY (before any async operations)
    // This prevents concurrent replies to the same message
    this.activeReplies.add(messageId);
    
    // Generate a unique call ID for tracking
    const callId = `${messageId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    logger.info('sendLongMessage called', {
      messageId,
      callId,
      textLength: text.length,
      userId: message.author.id,
      timestamp: new Date().toISOString()
    });
    
    try {
      // If message fits, send it directly
      if (text.length <= MAX_LENGTH) {
        logger.info('Sending single message reply', { 
          messageId,
          callId,
          textLength: text.length,
          userId: message.author.id,
          timestamp: new Date().toISOString(),
          textPreview: text.substring(0, 100) // First 100 chars for debugging
        });
        
        logger.info('About to call message.reply()', { 
          messageId, 
          callId,
          textLength: text.length,
          textPreview: text.substring(0, 50)
        });
        
        const replyResult = await message.reply(text);
        
        // Mark as sent AFTER successful reply
        this.sentResponses.add(messageId);
        
        logger.info('message.reply() completed successfully', { 
          messageId,
          callId,
          replyId: replyResult?.id || 'unknown',
          replyContent: replyResult?.content?.substring(0, 100) || 'no content',
          replyLength: replyResult?.content?.length || 0,
          timestamp: new Date().toISOString()
        });
        return; // Short message sent, we're done
      }
      
      // Handle long messages (chunked)
      // Mark as sent before sending chunks
      this.sentResponses.add(messageId);
      
      // Split into chunks, trying to break at sentence boundaries
      const chunks: string[] = [];
      let currentChunk = '';
      
      // Split by paragraphs first (double newlines)
      const paragraphs = text.split(/\n\n+/);
      
      for (const paragraph of paragraphs) {
        // If adding this paragraph would exceed limit, finalize current chunk
        if (currentChunk.length + paragraph.length + 2 > MAX_LENGTH && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        // If paragraph itself is too long, split it by sentences
        if (paragraph.length > MAX_LENGTH) {
          // Finalize current chunk if it has content
          if (currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }
          
          // Split paragraph by sentences
          const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
          for (const sentence of sentences) {
            if (currentChunk.length + sentence.length + 1 > MAX_LENGTH && currentChunk.length > 0) {
              chunks.push(currentChunk.trim());
              currentChunk = sentence;
            } else {
              currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
          }
        } else {
          // Add paragraph to current chunk
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        }
      }
      
      // Add remaining chunk
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      
      // If still too long, force split at character limit (last resort)
      const finalChunks: string[] = [];
      for (const chunk of chunks) {
        if (chunk.length <= MAX_LENGTH) {
          finalChunks.push(chunk);
        } else {
          // Force split at character limit
          for (let i = 0; i < chunk.length; i += MAX_LENGTH) {
            finalChunks.push(chunk.substring(i, i + MAX_LENGTH));
          }
        }
      }
      
      // Send all chunks
      logger.debug('Sending message in chunks', { 
        messageId: message.id,
        totalChunks: finalChunks.length 
      });
      
      for (let i = 0; i < finalChunks.length; i++) {
        if (i === 0) {
          // First chunk as reply
          logger.debug('Sending first chunk as reply', { 
            messageId: message.id, 
            chunkIndex: i, 
            chunkLength: finalChunks[i].length 
          });
          await message.reply(finalChunks[i]);
          logger.debug('First chunk sent', { messageId: message.id, chunkIndex: i });
      } else {
        // Subsequent chunks as follow-up messages
        // Check if channel is a text-based channel that supports sending
        const channel = message.channel;
        logger.debug('Sending subsequent chunk', { 
          messageId: message.id, 
          chunkIndex: i, 
          chunkLength: finalChunks[i].length 
        });
        if (channel.type === ChannelType.DM || 
            channel.type === ChannelType.GuildText || 
            channel.type === ChannelType.GuildAnnouncement ||
            channel.type === ChannelType.PublicThread ||
            channel.type === ChannelType.PrivateThread) {
          await (channel as any).send(finalChunks[i]);
        } else {
          // Fallback: send as reply if channel type doesn't support direct send
          await message.reply(finalChunks[i]);
        }
        logger.debug('Subsequent chunk sent', { messageId: message.id, chunkIndex: i });
      }
      
        // Small delay between messages to avoid rate limits
        if (i < finalChunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      logger.info('Sent long message in chunks', {
        userId: message.author.id,
        messageId: message.id,
        totalChunks: finalChunks.length,
        totalLength: text.length
      });
    } catch (error) {
      // If sending fails, remove from activeReplies and sentResponses so it can be retried
      this.activeReplies.delete(messageId);
      this.sentResponses.delete(messageId);
      logger.error('Error sending message reply', {
        messageId,
        callId,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    } finally {
      // Always remove from activeReplies when done
      this.activeReplies.delete(messageId);
    }
  }

  private createProAccessEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('Pro Access Required')
      .setDescription('This feature is only available to Video Game Wingman Pro users.')
      .setColor('#FF0000')
      .addFields({ name: 'How to Get Pro', value: 'Visit our website to learn more about Pro benefits.' })
      .setTimestamp();
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userLimit = this.rateLimits.get(userId);

    if (!userLimit || (now - userLimit.timestamp) > this.RATE_LIMIT_WINDOW) {
      this.rateLimits.set(userId, { timestamp: now, count: 1 });
      return true;
    }

    if (userLimit.count >= this.MAX_MESSAGES_PER_WINDOW) {
      return false;
    }

    userLimit.count++;
    return true;
  }

  private getCachedResponse(question: string): string | null {
    const cached = this.responseCache.get(question);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.response;
    }
    return null;
  }

  private cacheResponse(question: string, response: string): void {
    this.responseCache.set(question, {
      response,
      timestamp: Date.now()
    });
  }

  private async retryOperation<T>(operation: () => Promise<T>, retries = this.MAX_RETRIES): Promise<T> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }

    throw lastError;
  }

  private handleError(error: any, message: Message): void {
    logger.error('Error in bot handler:', {
      error,
      userId: message.author.id,
      messageId: message.id,
      content: message.content
    });

    message.reply('Sorry, I encountered an error processing your request. Please try again later.')
      .catch(err => logger.error('Error sending error message:', err));
  }

  private startMaintenanceTasks(): void {
    // Clean up rate limits periodically
    setInterval(() => {
      const now = Date.now();
      Array.from(this.rateLimits.entries()).forEach(([userId, limit]) => {
        if (now - limit.timestamp > this.RATE_LIMIT_WINDOW) {
          this.rateLimits.delete(userId);
        }
      });
    }, this.RATE_LIMIT_WINDOW);

    // Clean up response cache periodically
    setInterval(() => {
      const now = Date.now();
      Array.from(this.responseCache.entries()).forEach(([question, cached]) => {
        if (now - cached.timestamp > this.CACHE_TTL) {
          this.responseCache.delete(question);
        }
      });
    }, this.CACHE_TTL);

    // Clean up message queue periodically
    setInterval(() => {
      Array.from(this.messageQueue.entries()).forEach(([userId, promise]) => {
        if (promise.constructor.name === 'Promise') {
          promise.then(() => this.messageQueue.delete(userId));
        }
      });
    }, 60000);

    // Clean up processed messages periodically (remove old entries)
    setInterval(() => {
      const now = Date.now();
      Array.from(this.processedMessages.entries()).forEach(([messageId, timestamp]) => {
        if (now - timestamp > this.MESSAGE_DEDUP_WINDOW) {
          this.processedMessages.delete(messageId);
        }
      });
    }, this.MESSAGE_DEDUP_WINDOW);

    // Clean up sent responses periodically (remove old entries after 1 minute)
    setInterval(() => {
      // Keep sent responses for 1 minute to prevent duplicates
      // After that, clear them to free memory
      if (this.sentResponses.size > 1000) {
        // If we have too many entries, clear half of them
        const entries = Array.from(this.sentResponses);
        const toRemove = entries.slice(0, Math.floor(entries.length / 2));
        toRemove.forEach(id => this.sentResponses.delete(id));
      }
    }, 60000); // Every minute
  }
}
