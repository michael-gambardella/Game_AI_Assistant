import type { NextApiRequest, NextApiResponse } from 'next';
import connectToMongoDB from '../../utils/mongodb';
import Forum from '../../models/Forum';
import { isPostOwner } from '../../utils/forumAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { forumId, postId } = req.query;
  const { username } = req.body;

  if (!forumId || !postId) {
    return res.status(400).json({ error: 'Missing forumId or postId' });
  }

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    await connectToMongoDB();
    const forum = await Forum.findOne({ forumId });
    if (!forum) {
      return res.status(404).json({ error: 'Forum not found' });
    }

    // Find the post
    const post = forum.posts.id(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Only allow post creator to delete
    if (!isPostOwner(post, username)) {
      return res.status(403).json({ error: 'Only the post creator can delete this post' });
    }

    // Use findOneAndUpdate with $pull to remove the post without validating entire array
    // This avoids validation errors on existing posts that might be missing fields
    const updatedForum = await Forum.findOneAndUpdate(
      { forumId },
      {
        $pull: { posts: { _id: postId } },
        $set: {
          'metadata.totalPosts': forum.posts.length - 1,
          'metadata.lastActivityAt': new Date()
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

    return res.status(200).json({ message: 'Post deleted', forum: updatedForum });
  } catch (error) {
    console.error('Error deleting post:', error);
    return res.status(500).json({ error: 'Failed to delete post' });
  }
}