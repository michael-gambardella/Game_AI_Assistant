import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import { ChallengeHistoryEntry } from '../../types';
import { logger } from '../../utils/logger';

/**
 * GET /api/challenge-history?username=xxx&limit=30&offset=0
 * Returns paginated challenge history for a user
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{
    history: ChallengeHistoryEntry[];
    total: number;
    limit: number;
    offset: number;
  } | { error: string; details?: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, limit, offset } = req.query;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Parse limit and offset with defaults
    const limitNum = limit ? parseInt(String(limit), 10) : 30;
    const offsetNum = offset ? parseInt(String(offset), 10) : 0;

    // Validate limit and offset
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: 'Invalid limit',
        details: 'Limit must be a number between 1 and 100',
      });
    }

    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({
        error: 'Invalid offset',
        details: 'Offset must be a non-negative number',
      });
    }


    // Select challengeHistory field - MongoDB will return all sub-fields including challengeTitle and challengeDescription
    const user = await User.findOne({ username }).select('challengeHistory').lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get challenge history (empty array if not set)
    // Use lean() to get plain JavaScript objects, ensuring all fields are preserved
    const history = ((user as any).challengeHistory || []) as ChallengeHistoryEntry[];
    
    // Debug: Log first entry to verify fields are present in raw data
    if (history.length > 0) {
      logger.info('Raw challenge history from database', {
        username,
        firstEntry: history[0],
        hasChallengeTitle: !!(history[0] as any).challengeTitle,
        hasChallengeDescription: !!(history[0] as any).challengeDescription,
      });
    }

    // Sort by completedAt descending (most recent first)
    const sortedHistory = [...history].sort((a, b) => {
      const dateA = a.completedAt instanceof Date ? a.completedAt : new Date(a.completedAt);
      const dateB = b.completedAt instanceof Date ? b.completedAt : new Date(b.completedAt);
      return dateB.getTime() - dateA.getTime();
    });

    // Apply pagination
    const paginatedHistory = sortedHistory.slice(offsetNum, offsetNum + limitNum);

    // Convert dates to Date objects if they're strings
    // Ensure all fields are properly included (challengeTitle, challengeDescription, etc.)
    const formattedHistory = paginatedHistory.map((entry) => {
      const formatted = {
        ...entry,
        completedAt:
          entry.completedAt instanceof Date
            ? entry.completedAt
            : new Date(entry.completedAt),
      };
      // Debug: Log first entry to verify fields are present
      if (paginatedHistory.indexOf(entry) === 0) {
        logger.info('First challenge history entry being returned', {
          entry: formatted,
          hasChallengeTitle: !!formatted.challengeTitle,
          hasChallengeDescription: !!formatted.challengeDescription,
        });
      }
      return formatted;
    });

    logger.info('Challenge history fetched', {
      username,
      total: history.length,
      returned: formattedHistory.length,
      limit: limitNum,
      offset: offsetNum,
    });

    // Set cache headers to prevent stale data
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    return res.status(200).json({
      history: formattedHistory,
      total: history.length,
      limit: limitNum,
      offset: offsetNum,
    });
  } catch (error) {
    logger.error('Error fetching challenge history:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({
      error: 'Failed to fetch challenge history',
    });
  }
}

export default withDatabase(handler);
