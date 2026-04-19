import type { NextApiRequest, NextApiResponse } from 'next';
import connectToMongoDB from '../../utils/mongodb';
import Forum from '../../models/Forum';
import { validateUserAuthentication } from '../../utils/validation';
import { isForumOwner } from '../../utils/forumAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await connectToMongoDB();
    let username = 'test-user';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      username = authHeader.split(' ')[1] || 'test-user';
    }
    const { forumId } = req.query;

    // Validate user authentication
    const userAuthErrors = validateUserAuthentication(username);
    if (userAuthErrors.length > 0) {
      return res.status(401).json({ error: userAuthErrors[0] });
    }

    if (!forumId) {
      return res.status(400).json({ error: 'Forum ID is required' });
    }

    // Find the forum first to validate access
    const forum = await Forum.findOne({
      $or: [
        { forumId: forumId },
        { _id: forumId }
      ]
    });
    if (!forum) {
      return res.status(404).json({ error: 'Forum not found' });
    }

    // Only allow forum creator to delete
    if (!isForumOwner(forum, username)) {
      return res.status(403).json({ error: 'Only the forum creator can delete this forum' });
    }

    // Delete the forum
    await Forum.deleteOne({
      $or: [
        { forumId: forumId },
        { _id: forumId }
      ]
    });

    return res.status(200).json({ 
      message: 'Forum deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting forum:', error);
    return res.status(500).json({ error: 'Failed to delete forum' });
  }
} 