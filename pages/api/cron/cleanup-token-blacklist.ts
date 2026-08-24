import type { NextApiRequest, NextApiResponse } from 'next';
import { cleanupExpiredBlacklistEntries, getBlacklistStats } from '../../../utils/tokenBlacklist';

/**
 * Token Blacklist Cleanup Cron Job
 * 
 * Removes expired entries from the token blacklist to prevent database bloat.
 * 
 * Schedule: Run daily (recommended: 2:00 AM UTC)
 * 
 * For Heroku deployment:
 * - Use external cron service (EasyCron, Cron-job.org, etc.)
 * - URL: https://your-app-name.herokuapp.com/api/cron/cleanup-token-blacklist
 * - Schedule: "0 2 * * *" (Daily at 2:00 AM UTC)
 * 
 * Security: Consider adding authentication (API key, secret header, etc.)
 * Uncomment the authentication check below and set CRON_SECRET in your environment variables.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Optional: Add authentication check
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Allow both GET and POST for flexibility with different cron services
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Get stats before cleanup
    const statsBefore = await getBlacklistStats();

    // Cleanup expired entries
    const deletedCount = await cleanupExpiredBlacklistEntries();

    // Get stats after cleanup
    const statsAfter = await getBlacklistStats();

    console.log(`[Token Blacklist Cleanup] Removed ${deletedCount} expired entries`);
    console.log(`[Token Blacklist Cleanup] Stats - Before: ${statsBefore.total} total, ${statsBefore.expired} expired`);
    console.log(`[Token Blacklist Cleanup] Stats - After: ${statsAfter.total} total`);

    return res.status(200).json({
      success: true,
      message: 'Token blacklist cleanup completed',
      deletedCount,
      stats: {
        before: statsBefore,
        after: statsAfter,
      },
    });
  } catch (error) {
    console.error('Error in token blacklist cleanup:', error);
    
    return res.status(500).json({
      error: 'Cleanup failed',
      message: 'An error occurred during token blacklist cleanup',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

