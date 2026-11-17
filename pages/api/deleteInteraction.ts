import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import Question from '../../models/Question';
import { clearUserCache } from './getConversation';
import { requireUser } from '../../middleware/auth';
import mongoose from 'mongoose';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Identity comes from the signed-in session, never the request (middleware/auth.ts)
  const authUser = await requireUser(req, res);
  if (!authUser) return;
  const { username } = authUser;

  const { id } = req.body;
  // Must be a real ObjectId string (an object here would be a MongoDB query operator)
  if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Missing id' });
  }

  try {
    // Only the owner's own conversation can be deleted. Someone else's id gets the same
    // 404 as a nonexistent one, so ids can't be probed.
    const result = await Question.deleteOne({ _id: id, username });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Interaction not found' });
    }
    
    // Clear the cache for this user to ensure fresh data on next fetch
    clearUserCache(username);
    
    res.status(200).json({ message: 'Interaction deleted successfully' });
  } catch (error: any) {
    console.error("Error deleting interaction:", error.message);
    res.status(500).json({ error: 'Failed to delete interaction' });
  }
}

export default withWingmanDB(handler);
