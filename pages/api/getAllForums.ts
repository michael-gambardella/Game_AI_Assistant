import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import Forum from '../../models/Forum';
import { validateUserAuthentication } from '../../utils/validation';
import { normalizeForumCategory } from '../../utils/forumCategory';
import { getEffectiveForumStatus } from '../../utils/forumStatus';

/** Escape special regex characters in user input to avoid ReDoS and injection */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Use test user for local development if user-id is not provided
    let username = req.headers['username'] as string;
    if (!username) {
      username = 'test-user';
    }

    // Validate user authentication only if not test user
    if (username !== 'test-user') {
      const userAuthErrors = validateUserAuthentication(username);
      if (userAuthErrors.length > 0) {
        return res.status(401).json({ error: userAuthErrors[0] });
      }
    }

    // Get pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Filter parameters (optional)
    const gameTitleRaw = (req.query.gameTitle as string)?.trim();
    const categoryRaw = (req.query.category as string)?.trim();
    const sortParam = (req.query.sort as string)?.toLowerCase() || 'newest';

    // Build query conditions: list forums that are active or inactive (exclude archived)
    const baseConditions: Record<string, any> = {
      $or: [
        { isPrivate: false },
        { allowedUsers: username }
      ],
      'metadata.status': { $in: ['active', 'inactive'] }
    };

    if (gameTitleRaw) {
      baseConditions.gameTitle = new RegExp(escapeRegex(gameTitleRaw), 'i');
    }
    if (categoryRaw) {
      baseConditions.category = normalizeForumCategory(categoryRaw);
    }

    // Sort: newest (default), oldest, mostPosts
    const sortOption: Record<string, 1 | -1> =
      sortParam === 'oldest'
        ? { 'metadata.lastActivityAt': 1 }
        : sortParam === 'mostposts'
          ? { 'metadata.totalPosts': -1, 'metadata.lastActivityAt': -1 }
          : { 'metadata.lastActivityAt': -1 };

    // Find forums that are either public or private but accessible to the user
    const forums = await Forum.find(baseConditions)
      .sort(sortOption)
      .skip(skip)
      .limit(limit);

    // Process forums to include metadata; derive active/inactive from lastActivityAt (7-day rule)
    const processedForums = forums.map(forum => ({
      ...forum.toObject(),
      metadata: {
        totalPosts: forum.metadata.totalPosts || 0,
        lastActivityAt: forum.metadata.lastActivityAt || new Date(),
        viewCount: forum.metadata.viewCount || 0,
        status: getEffectiveForumStatus({
          status: forum.metadata.status,
          lastActivityAt: forum.metadata.lastActivityAt
        })
      }
    }));

    // Get total count for pagination (using same conditions)
    const total = await Forum.countDocuments(baseConditions);

    return res.status(200).json({
      forums: processedForums,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching forums:', error);
    return res.status(500).json({ error: 'Error fetching forums' });
  }
}

export default withDatabase(handler);
