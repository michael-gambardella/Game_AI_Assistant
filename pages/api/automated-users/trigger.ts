import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminOrCron } from '../../../middleware/auth';
import { getScheduler } from '../../../utils/automatedUsersScheduler';

/**
 * POST /api/automated-users/trigger
 * 
 * Manually trigger a scheduled task for testing
 * 
 * Body: { taskName: string }
 * 
 * Response: { success: boolean, message: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Operations endpoint: admin session or scheduled job (Authorization: Bearer <CRON_SECRET>).
  // Previously unauthenticated - anyone could run it.
  if (!(await requireAdminOrCron(req, res))) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskName } = req.body;

  if (!taskName) {
    return res.status(400).json({ 
      error: 'Missing required field: taskName',
      availableTasks: [
        'MysteriousMrEnter-Question',
        'MysteriousMrEnter-ForumPost',
        'WaywardJammer-Question',
        'WaywardJammer-ForumPost',
        'InterdimensionalHipster-Reply',
        'InterdimensionalHipster-Reply2',
        'InterdimensionalHipster-ForumPost'
      ]
    });
  }

  try {
    const scheduler = getScheduler();
    await scheduler.triggerTask(taskName);

    return res.status(200).json({
      success: true,
      message: `Task ${taskName} triggered successfully`
    });
  } catch (error) {
    console.error('Error triggering task:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to trigger task',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

