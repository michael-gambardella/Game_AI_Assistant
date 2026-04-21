import type { NextApiRequest, NextApiResponse } from 'next';
import mongoose from 'mongoose';
import { withDatabase } from '../../utils/withDatabase';
import Forum from '../../models/Forum';
import { containsOffensiveContent } from '../../utils/contentModeration';
import { checkUserBanStatus } from '../../utils/violationHandler';
import { hasForumAccess } from '../../utils/forumAuth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { forumId, message, username, attachments, replyTo } = req.body;

    // Log the request for debugging (especially for 400 errors)
    console.log('addPostToForum request:', {
      forumId,
      username,
      messageLength: message?.length,
      hasMessage: !!message,
      hasAttachments: attachments && Array.isArray(attachments) && attachments.length > 0,
      timestamp: new Date().toISOString()
    });

    // Validate required fields with detailed error messages
    // Allow empty message if attachments are provided (like social media posts)
    const missingFields: string[] = [];
    if (!forumId) missingFields.push('forumId');
    if (!username) missingFields.push('username');
    
    // Check if message or attachments are provided
    const hasMessage = message && typeof message === 'string' && message.trim().length > 0;
    const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
    
    if (!hasMessage && !hasAttachments) {
      return res.status(400).json({ 
        error: 'Message is required and cannot be empty, or you must provide at least one image' 
      });
    }
    
    if (missingFields.length > 0) {
      console.warn('Missing required fields:', { missingFields, username, forumId });
      return res.status(400).json({ 
        error: `Missing required fields: ${missingFields.join(', ')}` 
      });
    }

    // Check if user is currently banned (before processing post)
    const banStatus = await checkUserBanStatus(username);
    if (banStatus.isBanned) {
      return res.status(403).json({ 
        error: `You are banned until ${banStatus.expiresAt}. Reason: Previous content violations.`,
        banStatus
      });
    }

    // Find the forum
    const forum = await Forum.findOne({ forumId });
    if (!forum) {
      return res.status(404).json({ error: 'Forum not found' });
    }

    // Check if forum is private and user is allowed
    if (!hasForumAccess(forum, username)) {
      return res.status(403).json({
        error: 'Not authorized to post in this forum',
        details: `This is a private forum. You must be added to the allowed users list to post. Current allowed users: ${forum.allowedUsers.length}`
      });
    }

    // Allow posting when forum is active or inactive (inactive = no new posts in 7 days; posting is still allowed and will set it back to active)
    const postableStatuses = ['active', 'inactive'];
    if (!postableStatuses.includes(forum.metadata?.status || 'active')) {
      return res.status(403).json({ error: 'Forum is not active' });
    }

    // Validate replyTo if provided
    let replyToObjectId = null;
    if (replyTo) {
      // Validate that replyTo is a valid ObjectId format
      if (!mongoose.Types.ObjectId.isValid(replyTo)) {
        return res.status(400).json({ error: 'Invalid replyTo post ID format' });
      }
      
      // Check that the post being replied to exists in this forum
      const repliedToPost = forum.posts.find((p: any) => 
        p._id && p._id.toString() === replyTo.toString()
      );
      
      if (!repliedToPost) {
        return res.status(404).json({ error: 'Post being replied to not found in this forum' });
      }
      
      replyToObjectId = new mongoose.Types.ObjectId(replyTo);
    }

    // Validate attachments if provided
    const postAttachments = attachments || [];
    if (postAttachments.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 images per post allowed' });
    }
    
    // Validate attachment structure
    for (const attachment of postAttachments) {
      if (!attachment.type || !attachment.url) {
        return res.status(400).json({ error: 'Invalid attachment format. Each attachment must have type and url' });
      }
      if (attachment.type !== 'image') {
        return res.status(400).json({ error: 'Only image attachments are currently supported' });
      }
      // Basic URL validation
      // Allow:
      // - Local forum images: /uploads/forum-images/
      // - Local automated images: /uploads/automated-images/
      // - Cloud URLs: http:// or https://
      const isValidUrl = 
        attachment.url.startsWith('/uploads/forum-images/') ||
        attachment.url.startsWith('/uploads/automated-images/') ||
        attachment.url.startsWith('http://') ||
        attachment.url.startsWith('https://');
      
      if (!isValidUrl) {
        return res.status(400).json({ 
          error: 'Invalid image URL. Images must be uploaded through the upload endpoint or be a valid cloud URL.' 
        });
      }
    }

    // Check for duplicate posts by the same user in this forum (within last 24 hours)
    // This prevents automated users from posting the same message multiple times
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPostsByUser = forum.posts.filter((p: any) => 
      p.username === username &&
      p.metadata?.status === 'active' &&
      new Date(p.timestamp) > oneDayAgo &&
      hasMessage && p.message && p.message.trim().length > 0
    );
    
    // Check for exact duplicate message
    if (hasMessage && recentPostsByUser.some((p: any) => 
      p.message.trim().toLowerCase() === message.trim().toLowerCase()
    )) {
      console.warn('Duplicate post detected:', {
        username,
        forumId,
        messagePreview: message.substring(0, 50) + '...',
        duplicateCount: recentPostsByUser.length
      });
      return res.status(400).json({ 
        error: 'Duplicate post detected',
        message: 'You have already posted this exact message recently. Please post something different.'
      });
    }
    
    // Check for offensive content
    console.log('Checking content moderation for message...');
    const contentCheck = await containsOffensiveContent(message, username);
    console.log('Content check result:', {
      isOffensive: contentCheck.isOffensive,
      offendingWords: contentCheck.offendingWords,
      hasViolationResult: !!contentCheck.violationResult,
      violationAction: contentCheck.violationResult?.action
    });
    
    if (contentCheck.isOffensive) {
      // Log the violation for server-side debugging
      console.warn('Content policy violation detected:', {
        username,
        forumId,
        warningCount: contentCheck.violationResult?.count,
        action: contentCheck.violationResult?.action,
        offendingWords: contentCheck.offendingWords,
        messagePreview: message.substring(0, 100) + (message.length > 100 ? '...' : '')
      });

      // Handle different violation actions
      if (contentCheck.violationResult?.action === 'banned') {
        return res.status(403).json({
          error: 'Account Suspended',
          message: 'Your account has been suspended due to content violations.',
          banExpiresAt: contentCheck.violationResult.expiresAt,
          violationResult: contentCheck.violationResult
        });
      }
      
      // Warning or first-time violation - return user-friendly message
      const warningCount = contentCheck.violationResult?.count || 1;
      return res.status(400).json({ 
        error: 'Content Policy Violation',
        message: `Your message contains offensive or inappropriate content. You have been given a warning (${warningCount}/3). Continued offenses will result in a temporary ban.`,
        isContentViolation: true,
        warningCount,
        violationResult: contentCheck.violationResult
      });
    }

    // Create new post with proper structure matching the schema
    // Use message if provided, otherwise use empty string (images-only post)
    const newPost = {
      _id: new mongoose.Types.ObjectId(), // Generate ObjectId for the post
      username,
      message: hasMessage ? message.trim() : '', // Allow empty message for image-only posts
      timestamp: new Date(),
      createdBy: username,
      replyTo: replyToObjectId,
      metadata: {
        edited: false,
        editedAt: undefined,
        editedBy: undefined,
        likes: 0,
        likedBy: [],
        reactions: {},
        attachments: postAttachments.map((att: any) => ({
          type: 'image',
          url: att.url,
          name: att.name || 'image'
        })),
        status: 'active'
      }
    };

    // Use findOneAndUpdate with $push to add post without validating entire array
    // This avoids validation errors on existing posts that might be missing fields
    const updatedForum = await Forum.findOneAndUpdate(
      { forumId },
      {
        $push: { posts: newPost },
        $set: {
          'metadata.totalPosts': (forum.metadata.totalPosts || 0) + 1,
          'metadata.lastActivityAt': new Date(),
          'metadata.status': 'active' // Reactivate forum when a new post is added (even if it was inactive)
        }
      },
      {
        new: true,
        runValidators: false // Skip validation to avoid issues with existing posts
      }
    );

    if (!updatedForum) {
      return res.status(404).json({ error: 'Forum not found after update' });
    }

    return res.status(200).json({ 
      message: 'Post added successfully', 
      forum: updatedForum
    });
  } catch (error: any) {
    console.error('Error adding post:', error);
    
    // Check for MongoDB validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation error',
        details: error.message,
        validationErrors: error.errors
      });
    }
    
    // Check for MongoDB document size limit (16MB)
    if (error.message && error.message.includes('maximum document size')) {
      return res.status(400).json({ 
        error: 'Forum has reached maximum size limit',
        details: 'The forum has too many posts. Please contact support or create a new forum.'
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to add post',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

export default withDatabase(handler);
