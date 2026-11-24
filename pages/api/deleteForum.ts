import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import Forum from '../../models/Forum';
import { requireUser } from '../../middleware/auth';
import mongoose from 'mongoose';
import { isForumOwner } from '../../utils/forumAuth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Owner check uses the signed-in user. This used to read the username straight out of
    // "Authorization: Bearer <username>" (defaulting to 'test-user'), so anyone could
    // delete any forum by naming its creator.
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const { username } = authUser;

    const { forumId } = req.query;
    if (typeof forumId !== 'string' || !forumId) {
      return res.status(400).json({ error: 'Forum ID is required' });
    }

    // forumId, or the Mongo _id when it's a valid ObjectId
    const forumQuery = mongoose.Types.ObjectId.isValid(forumId)
      ? { $or: [{ forumId }, { _id: forumId }] }
      : { forumId };

    // Find the forum first to validate access
    const forum = await Forum.findOne(forumQuery);
    if (!forum) {
      return res.status(404).json({ error: 'Forum not found' });
    }

    // Only allow forum creator to delete
    if (!isForumOwner(forum, username)) {
      return res.status(403).json({ error: 'Only the forum creator can delete this forum' });
    }

    // Delete the forum
    await Forum.deleteOne({ _id: forum._id });

    return res.status(200).json({ 
      message: 'Forum deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting forum:', error);
    return res.status(500).json({ error: 'Failed to delete forum' });
  }
}

export default withDatabase(handler);
