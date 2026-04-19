import type { NextApiRequest, NextApiResponse } from 'next';
import connectToMongoDB from '../../utils/mongodb';
import Forum from '../../models/Forum';
import { isPostOwner } from '../../utils/forumAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { forumId, postId } = req.query;
  const { message, username, attachments } = req.body;

  if (!forumId || !postId) {
    return res.status(400).json({ error: 'Missing forumId or postId' });
  }

  // Allow empty message if attachments are provided (like social media posts)
  // But also allow message + attachments together (normal case)
  const hasMessage = message && typeof message === 'string' && message.trim().length > 0;
  const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
  
  if (!hasMessage && !hasAttachments) {
    return res.status(400).json({ error: 'Message is required and cannot be empty, or you must provide at least one image' });
  }

  if (message && message.length > 5000) {
    return res.status(400).json({ error: 'Message too long (max 5000 characters)' });
  }

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
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

  try {
    await connectToMongoDB();
    
    // First, find the forum and post to check authorization
    const forum = await Forum.findOne({ forumId });
    if (!forum) {
      return res.status(404).json({ error: 'Forum not found' });
    }

    // Find the post to verify ownership
    const post = forum.posts.id(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Only allow post creator to edit
    if (!isPostOwner(post, username)) {
      return res.status(403).json({ error: 'Only the post creator can edit this post' });
    }

    // Use findOneAndUpdate with positional operator to update only the specific post
    // This avoids validating all posts in the array
    const updateData: any = {
      'posts.$.metadata.edited': true,
      'posts.$.metadata.editedAt': new Date(),
      'posts.$.metadata.editedBy': username
    };

    // Always update message if provided (preserve existing message when adding images)
    // If message is provided (even if empty string), update it to preserve user's intent
    if (message !== undefined && typeof message === 'string') {
      updateData['posts.$.message'] = message.trim();
    }

    // Update attachments if provided
    if (postAttachments.length > 0) {
      updateData['posts.$.metadata.attachments'] = postAttachments.map((att: any) => ({
        type: 'image',
        url: att.url,
        name: att.name || 'image'
      }));
    }

    const updatedForum = await Forum.findOneAndUpdate(
      { 
        forumId,
        'posts._id': postId
      },
      {
        $set: updateData
      },
      { 
        new: true, // Return the updated document
        runValidators: false // Skip validation to avoid issues with other posts
      }
    );

    if (!updatedForum) {
      return res.status(404).json({ error: 'Forum or post not found after update' });
    }

    return res.status(200).json({ message: 'Post updated', forum: updatedForum });
  } catch (error) {
    console.error('Error editing post:', error);
    return res.status(500).json({ error: 'Failed to edit post' });
  }
}

