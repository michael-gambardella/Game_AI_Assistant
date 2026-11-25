import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminOrCron } from '../../../middleware/auth';
import { getScheduler } from '../../../utils/automatedUsersScheduler';

/**
 * GET /api/automated-users/status
 * 
 * Returns the current status of the automated users scheduler
 * 
 * Response:
 * {
 *   enabled: boolean,
 *   tasks: Array<{
 *     name: string,
 *     cronExpression: string,
 *     isRunning: boolean,
 *     nextRun?: string,
 *     lastRun?: string,
 *     isScheduled?: boolean,
 *     taskType: 'question' | 'forumPost'
 *   }>
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Operations endpoint: admin session or scheduled job (Authorization: Bearer <CRON_SECRET>).
  // Previously unauthenticated - anyone could run it.
  if (!(await requireAdminOrCron(req, res))) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const scheduler = getScheduler();
    const status = scheduler.getStatus();

    return res.status(200).json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error getting scheduler status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get scheduler status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

