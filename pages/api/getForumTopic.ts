import { NextApiRequest, NextApiResponse } from 'next';
import connectToMongoDB from '../../utils/mongodb';
import Forum from '../../models/Forum';
import { getEffectiveForumStatus } from '../../utils/forumStatus';
import { hasForumAccess } from '../../utils/forumAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { forumId, username, incrementView } = req.query;

  if (!forumId) {
    return res.status(400).json({ error: 'Forum ID is required' });
  }

  try {
    await connectToMongoDB();
    
    // Log request for debugging in production
    console.log('getForumTopic request:', {
      forumId: req.query.forumId,
      username: req.query.username,
      timestamp: new Date().toISOString()
    });
    
    const forum = await Forum.findOne({ forumId });
    if (!forum) {
      console.warn('Forum not found:', { forumId: req.query.forumId });
      return res.status(404).json({ error: 'Forum not found' });
    }
    
    // Log forum found
    console.log('Forum found:', {
      forumId: forum.forumId,
      title: forum.title,
      isPrivate: forum.isPrivate,
      hasMetadata: !!forum.metadata,
      postsCount: Array.isArray(forum.posts) ? forum.posts.length : 'not array'
    });

    // Ensure metadata exists and has all required fields
    if (!forum.metadata) {
      forum.metadata = {
        totalPosts: 0,
        lastActivityAt: new Date(),
        viewCount: 0,
        viewedBy: [],
        status: 'active'
      };
    } else {
      // Ensure all required metadata fields exist (preserve existing fields like gameTitle, category)
      forum.metadata.totalPosts = forum.metadata.totalPosts ?? 0;
      forum.metadata.lastActivityAt = forum.metadata.lastActivityAt ?? new Date();
      forum.metadata.viewCount = forum.metadata.viewCount ?? 0;
      forum.metadata.viewedBy = forum.metadata.viewedBy ?? [];
      forum.metadata.status = forum.metadata.status ?? 'active';
    }

    // Allow viewing for all statuses: active/inactive (can post), archived (read-only; anyone can read posts)
    const viewableStatuses = ['active', 'inactive', 'archived'];
    if (!viewableStatuses.includes(forum.metadata.status || 'active')) {
      return res.status(403).json({ error: 'Forum is not available' });
    }

    // Check if forum is private and user has access
    if (!hasForumAccess(forum, username as string)) {
      return res.status(403).json({ error: 'Access denied to private forum' });
    }

    // Only increment view count if incrementView is not explicitly set to false and the user hasn't viewed this forum before
    if (incrementView !== "false" && username) {
      // Initialize viewedBy array if it doesn't exist
      if (!forum.metadata.viewedBy || !Array.isArray(forum.metadata.viewedBy)) {
        forum.metadata.viewedBy = [];
      }

      // Initialize viewCount if it doesn't exist
      if (typeof forum.metadata.viewCount !== 'number') {
        forum.metadata.viewCount = 0;
      }

      // Only increment if this is the user's first view
      if (!forum.metadata.viewedBy.includes(username as string)) {
        forum.metadata.viewCount += 1;
        forum.metadata.viewedBy.push(username as string);
        
        // Wrap save in try-catch - if it fails, continue anyway
        try {
          // Before saving, ensure all posts have required fields
          // Some old posts might have createdBy but not username
          if (Array.isArray(forum.posts)) {
            forum.posts.forEach((post: any, index: number) => {
              // If post has createdBy but no username, use createdBy as username
              if (!post.username && post.createdBy) {
                post.username = post.createdBy;
              }
              // If post has neither, set a default (shouldn't happen, but be safe)
              if (!post.username && !post.createdBy) {
                post.username = 'Unknown';
              }
            });
          }
          
          // Use updateOne instead of save() to avoid full document validation
          // This is safer when we're only updating metadata, not posts
          await Forum.updateOne(
            { _id: forum._id },
            { 
              $set: {
                'metadata.viewCount': forum.metadata.viewCount,
                'metadata.viewedBy': forum.metadata.viewedBy
              }
            }
          );
        } catch (saveError) {
          console.error('Error saving forum view count increment:', {
            error: saveError instanceof Error ? saveError.message : String(saveError),
            stack: saveError instanceof Error ? saveError.stack : undefined,
            forumId: req.query.forumId,
            username: req.query.username
          });
          // Continue execution even if save fails - the view count increment is not critical
        }
      }
    }

    // Ensure isPrivate is a proper boolean before serialization
    if (typeof forum.isPrivate !== 'boolean') {
      forum.isPrivate = false;
    }
    
    // Ensure posts is an array
    if (!Array.isArray(forum.posts)) {
      forum.posts = [];
    }
    
    // Ensure required fields exist before serialization
    if (!forum.title) {
      forum.title = 'Untitled Forum';
    }
    if (!forum.gameTitle) {
      forum.gameTitle = 'Unknown Game';
    }
    if (!forum.category) {
      forum.category = 'General';
    }
    if (!forum.createdBy) {
      forum.createdBy = 'Unknown';
    }
    
    // Return forum with posts (convert to plain object for JSON serialization)
    // Use try-catch with fallback for serialization
    try {
      // Use toObject() with options to handle edge cases
      const forumObject = forum.toObject({
        transform: (doc: any, ret: any) => {
          // Remove any internal Mongoose properties that might cause issues
          delete ret.__v;
          return ret;
        }
      });
      
      // Sanitize the object to ensure all nested values are serializable
      const sanitized = {
        _id: forumObject._id?.toString(),
        forumId: forumObject.forumId,
        title: String(forumObject.title || ''),
        gameTitle: String(forumObject.gameTitle || ''),
        category: String(forumObject.category || ''),
        isPrivate: Boolean(forumObject.isPrivate),
        allowedUsers: Array.isArray(forumObject.allowedUsers) ? forumObject.allowedUsers : [],
        createdBy: String(forumObject.createdBy || ''),
        createdAt: forumObject.createdAt ? new Date(forumObject.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: forumObject.updatedAt ? new Date(forumObject.updatedAt).toISOString() : new Date().toISOString(),
        posts: Array.isArray(forumObject.posts) ? forumObject.posts.map((post: any) => ({
          _id: post._id?.toString(),
          username: String(post.username || ''),
          message: String(post.message || ''),
          timestamp: post.timestamp ? new Date(post.timestamp).toISOString() : new Date().toISOString(),
          createdBy: String(post.createdBy || ''),
          metadata: post.metadata || {
            edited: false,
            likes: 0,
            likedBy: [],
            status: 'active'
          }
        })) : [],
        metadata: {
          totalPosts: Number(forumObject.metadata?.totalPosts || 0),
          lastActivityAt: forumObject.metadata?.lastActivityAt ? new Date(forumObject.metadata.lastActivityAt).toISOString() : new Date().toISOString(),
          viewCount: Number(forumObject.metadata?.viewCount || 0),
          viewedBy: Array.isArray(forumObject.metadata?.viewedBy) ? forumObject.metadata.viewedBy : [],
          status: getEffectiveForumStatus({
            status: forumObject.metadata?.status,
            lastActivityAt: forumObject.metadata?.lastActivityAt
          }),
          // Preserve additional metadata fields like gameTitle and category if they exist
          ...(forumObject.metadata?.gameTitle && { gameTitle: forumObject.metadata.gameTitle }),
          ...(forumObject.metadata?.category && { category: forumObject.metadata.category })
        }
      };
      
      return res.status(200).json(sanitized);
    } catch (serializationError) {
      console.error('Error serializing forum object:', {
        error: serializationError instanceof Error ? serializationError.message : String(serializationError),
        stack: serializationError instanceof Error ? serializationError.stack : undefined,
        forumId: req.query.forumId,
        forumFields: {
          hasTitle: !!forum.title,
          hasGameTitle: !!forum.gameTitle,
          hasMetadata: !!forum.metadata,
          postsCount: Array.isArray(forum.posts) ? forum.posts.length : 'not array',
          isPrivate: forum.isPrivate
        }
      });
      
      // Fallback: manually construct safe object
      const safeObject = {
        _id: forum._id?.toString(),
        forumId: String(forum.forumId || ''),
        title: String(forum.title || 'Untitled Forum'),
        gameTitle: String(forum.gameTitle || 'Unknown Game'),
        category: String(forum.category || 'General'),
        isPrivate: Boolean(forum.isPrivate),
        allowedUsers: Array.isArray(forum.allowedUsers) ? forum.allowedUsers : [],
        createdBy: String(forum.createdBy || 'Unknown'),
        createdAt: forum.createdAt ? new Date(forum.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: forum.updatedAt ? new Date(forum.updatedAt).toISOString() : new Date().toISOString(),
        posts: [],
        metadata: {
          totalPosts: 0,
          lastActivityAt: new Date().toISOString(),
          viewCount: 0,
          viewedBy: [],
          status: getEffectiveForumStatus({ status: forum.metadata?.status, lastActivityAt: forum.metadata?.lastActivityAt })
        }
      };

      return res.status(200).json(safeObject);
    }
  } catch (error) {
    console.error('Error fetching forum:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      forumId: req.query.forumId,
      username: req.query.username,
      timestamp: new Date().toISOString()
    });
    return res.status(500).json({ 
      error: 'Error fetching forum',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}