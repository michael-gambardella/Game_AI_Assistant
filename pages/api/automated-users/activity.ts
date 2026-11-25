import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminOrCron } from '../../../middleware/auth';
import { askQuestion, createForumPost, respondToForumPost, getUserPreferences } from '../../../utils/automatedUsersService';
import { getScheduler } from '../../../utils/automatedUsersScheduler';

/**
 * POST /api/automated-users/activity
 * 
 * Manually trigger automated user activities
 * 
 * Request body:
 * {
 *   activityType: 'ask-question' | 'create-post' | 'reply-to-post' | 'trigger-task',
 *   username?: string,  // Required for ask-question, create-post, and reply-to-post
 *   taskName?: string    // Required for trigger-task
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   activityType: string,
 *   result: ActivityResult | { taskName: string, message: string }
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Operations endpoint: admin session or scheduled job (Authorization: Bearer <CRON_SECRET>).
  // Previously unauthenticated - anyone could run it.
  if (!(await requireAdminOrCron(req, res))) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { activityType, username, taskName } = req.body;

  if (!activityType) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: activityType',
      availableActivities: [
        'ask-question - Ask a question as an automated user (requires: username)',
        'create-post - Create a forum post as an automated user (requires: username)',
        'reply-to-post - Reply to a forum post as an automated user (requires: username)',
        'trigger-task - Manually trigger a scheduled task (requires: taskName)'
      ]
    });
  }

  try {
    switch (activityType) {
      case 'ask-question': {
        if (!username) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: username for ask-question activity'
          });
        }

        const preferences = await getUserPreferences(username);
        if (!preferences) {
          return res.status(400).json({
            success: false,
            error: `No preferences found for user: ${username}`
          });
        }

        const result = await askQuestion(username, preferences);

        return res.status(result.success ? 200 : 500).json({
          success: result.success,
          activityType: 'ask-question',
          result
        });
      }

      case 'create-post': {
        if (!username) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: username for create-post activity'
          });
        }

        const preferences = await getUserPreferences(username);
        if (!preferences) {
          return res.status(400).json({
            success: false,
            error: `No preferences found for user: ${username}`
          });
        }

        const result = await createForumPost(username, preferences);

        return res.status(result.success ? 200 : 500).json({
          success: result.success,
          activityType: 'create-post',
          result
        });
      }

      case 'reply-to-post': {
        if (!username) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: username for reply-to-post activity'
          });
        }

        const preferences = await getUserPreferences(username);
        if (!preferences) {
          return res.status(400).json({
            success: false,
            error: `No preferences found for user: ${username}`
          });
        }

        const result = await respondToForumPost(username, preferences);

        return res.status(result.success ? 200 : 500).json({
          success: result.success,
          activityType: 'reply-to-post',
          result
        });
      }

      case 'trigger-task': {
        if (!taskName) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: taskName for trigger-task activity'
          });
        }

        const scheduler = getScheduler();
        
        try {
          await scheduler.triggerTask(taskName);
          
          return res.status(200).json({
            success: true,
            activityType: 'trigger-task',
            result: {
              taskName,
              message: 'Task executed successfully'
            }
          });
        } catch (error) {
          return res.status(404).json({
            success: false,
            activityType: 'trigger-task',
            error: error instanceof Error ? error.message : 'Task not found or failed to execute'
          });
        }
      }

      default:
        return res.status(400).json({
          success: false,
          error: `Invalid activityType: ${activityType}`,
          availableActivities: [
            'ask-question - Ask a question as an automated user (requires: username)',
            'create-post - Create a forum post as an automated user (requires: username)',
            'reply-to-post - Reply to a forum post as an automated user (requires: username)',
            'trigger-task - Manually trigger a scheduled task (requires: taskName)'
          ]
        });
    }
  } catch (error) {
    console.error('Error executing automated user activity:', error);
    return res.status(500).json({
      success: false,
      activityType,
      error: 'Failed to execute activity',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

