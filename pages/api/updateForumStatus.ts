import type { NextApiRequest, NextApiResponse } from 'next';
import mongoose from 'mongoose';
import { withDatabase } from '../../utils/withDatabase';
import Forum from '../../models/Forum';
import { validateAdminAccess } from '../../utils/adminAccess';
import { requireUser } from '../../middleware/auth';

const ALLOWED_STATUSES = ['active', 'archived'] as const;

/**
 * Update forum status (active / archived).
 * Only the forum creator or the admin (ADMIN_USERNAME, e.g. Legendary Renegade) can change status.
 * - active: forum can be posted to.
 * - archived: read-only; everyone can view, no one can post. Creator or admin can restore to active.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Creator/admin check uses the signed-in user - a username in the body or a
  // "Bearer <username>" header proves nothing
  const user = await requireUser(req, res);
  if (!user) return;
  const { username } = user;

  try {
    const { forumId, status } = req.body || {};
    if (!forumId || typeof forumId !== 'string') {
      return res.status(400).json({ error: 'forumId is required' });
    }
    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }

    const trimmedId = forumId.trim();
    const isMongoId = /^[a-fA-F0-9]{24}$/.test(trimmedId);
    const forum = await Forum.findOne(
      isMongoId ? { $or: [{ forumId: trimmedId }, { _id: new mongoose.Types.ObjectId(trimmedId) }] } : { forumId: trimmedId }
    );
    if (!forum) {
      return res.status(404).json({ error: 'Forum not found' });
    }

    const isCreator = forum.createdBy === username;
    const adminCheck = validateAdminAccess(username);
    const isAdmin = adminCheck.hasAccess;

    if (!isCreator && !isAdmin) {
      return res.status(403).json({
        error: 'Only the forum creator or an admin can change this forum’s status.',
      });
    }

    await Forum.updateOne(
      { forumId: forum.forumId },
      { $set: { 'metadata.status': status, updatedAt: new Date() } }
    );

    const updated = await Forum.findOne({ forumId: forum.forumId }).lean();
    return res.status(200).json({
      message: 'Forum status updated',
      forum: updated,
      status,
    });
  } catch (error) {
    console.error('Error updating forum status:', error);
    return res.status(500).json({
      error: 'Failed to update forum status',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
    });
  }
}

export default withDatabase(handler);
