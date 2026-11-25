import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminOrCron } from '../../../middleware/auth';
import { getScheduler } from '../../../utils/automatedUsersScheduler';

/**
 * GET /api/automated-users/diagnostics
 * 
 * Returns diagnostic information about the cron scheduler
 * 
 * Response includes:
 * - Current UTC time
 * - Whether scheduler is enabled
 * - Task status
 * - Next scheduled runs
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
    const now = new Date();
    const utcNow = new Date(now.toISOString());

    // Helper function to check if a task should have run today based on cron expression
    const shouldHaveRunToday = (cronExpression: string, lastRun?: string): boolean => {
      try {
        const parts = cronExpression.split(/\s+/);
        if (parts.length !== 5) return false;
        
        const scheduledMinute = parts[0] === '*' ? null : parseInt(parts[0]);
        const scheduledHour = parts[1] === '*' ? null : parseInt(parts[1]);
        
        // If it's a daily task (not * for hour/minute), check if it should have run today
        if (scheduledHour !== null && scheduledMinute !== null) {
          const todayAtScheduledTime = new Date(utcNow);
          todayAtScheduledTime.setUTCHours(scheduledHour, scheduledMinute, 0, 0);
          
          // If the scheduled time today has passed and we haven't run today, it should have run
          if (todayAtScheduledTime < utcNow) {
            // Check if we've run today
            if (lastRun) {
              const lastRunDate = new Date(lastRun);
              const sameDay = lastRunDate.getUTCDate() === utcNow.getUTCDate() &&
                             lastRunDate.getUTCMonth() === utcNow.getUTCMonth() &&
                             lastRunDate.getUTCFullYear() === utcNow.getUTCFullYear();
              return !sameDay; // Should have run if we haven't run today
            }
            return true; // Should have run but haven't
          }
        }
        return false;
      } catch (error) {
        return false;
      }
    };

    // Check if any tasks should have run by now (based on nextRun being in the past)
    const overdueTasks = status.tasks
      .filter(task => {
        if (!task.nextRun) return false;
        const nextRunDate = new Date(task.nextRun);
        return nextRunDate < utcNow && !task.isRunning;
      })
      .map(task => ({
        name: task.name,
        nextRun: task.nextRun,
        lastRun: task.lastRun,
        isScheduled: task.isScheduled,
        overdueBy: Math.floor((utcNow.getTime() - new Date(task.nextRun!).getTime()) / 1000 / 60) + ' minutes'
      }));
    
    // Check for tasks that should have run today but haven't
    const missedTodayTasks = status.tasks
      .filter(task => {
        if (!task.isScheduled) return false;
        return shouldHaveRunToday(task.cronExpression, task.lastRun) && !task.isRunning;
      })
      .map(task => ({
        name: task.name,
        cronExpression: task.cronExpression,
        lastRun: task.lastRun,
        shouldHaveRunAt: (() => {
          const parts = task.cronExpression.split(/\s+/);
          if (parts.length === 5) {
            const hour = parseInt(parts[1]);
            const minute = parseInt(parts[0]);
            const todayAtTime = new Date(utcNow);
            todayAtTime.setUTCHours(hour, minute, 0, 0);
            return todayAtTime.toISOString();
          }
          return null;
        })()
      }));

    return res.status(200).json({
      success: true,
      diagnostics: {
        currentTime: {
          local: now.toISOString(),
          utc: utcNow.toISOString(),
          utcString: utcNow.toUTCString()
        },
        scheduler: {
          enabled: status.enabled,
          totalTasks: status.tasks.length,
          scheduledTasks: status.tasks.filter(t => t.isScheduled).length,
          runningTasks: status.tasks.filter(t => t.isRunning).length
        },
        tasks: status.tasks.map(task => ({
          name: task.name,
          cronExpression: task.cronExpression,
          isScheduled: task.isScheduled,
          isRunning: task.isRunning,
          nextRun: task.nextRun,
          lastRun: task.lastRun,
          taskType: task.taskType,
          description: task.description,
          shouldHaveRun: shouldHaveRunToday(task.cronExpression, task.lastRun)
        })),
        overdueTasks,
        missedTodayTasks,
        recommendations: [
          ...(overdueTasks.length > 0 ? [
            `⚠️ ${overdueTasks.length} task(s) have passed their next scheduled run time. Check server logs for [CRON TRIGGER] messages.`
          ] : []),
          ...(missedTodayTasks.length > 0 ? [
            `⚠️ ${missedTodayTasks.length} task(s) should have run today but haven't. This may be because the server was restarted after the scheduled time. They will run at the next scheduled time.`
          ] : []),
          ...(!status.enabled ? [
            '❌ Scheduler is disabled. Set AUTOMATED_USERS_ENABLED=true'
          ] : []),
          ...(status.tasks.some(t => !t.isScheduled) ? [
            '⚠️ Some tasks are not scheduled. Check cron expressions.'
          ] : []),
          '💡 Check server logs for [CRON HEARTBEAT] messages every 5 minutes to verify cron is running.',
          '💡 Use POST /api/automated-users/trigger to manually test tasks.'
        ]
      }
    });
  } catch (error) {
    console.error('Error getting diagnostics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get diagnostics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

