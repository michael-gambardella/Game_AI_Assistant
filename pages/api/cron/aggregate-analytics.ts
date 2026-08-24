import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import {
  aggregatePreviousHour,
  aggregatePreviousDay,
  aggregateAndSaveAnalytics
} from '../../../utils/twitch/analyticsAggregator';
import { logger } from '../../../utils/logger';

/**
 * Analytics Aggregation Cron Job
 * 
 * Aggregates raw Twitch bot analytics data into daily/hourly statistics
 * for fast queries and reporting.
 * 
 * Schedule: Run every hour (recommended: at :05 past the hour)
 * 
 * For Heroku deployment:
 * - Use external cron service (EasyCron, Cron-job.org, UptimeRobot, etc.)
 * - URL: https://your-app-name.herokuapp.com/api/cron/aggregate-analytics
 * - Schedule: "5 * * * *" (Every hour at :05 minutes)
 * - Method: GET or POST
 * 
 * For Heroku Scheduler (if available):
 * - Install Heroku Scheduler add-on: heroku addons:create scheduler:standard
 * - Open scheduler: heroku addons:open scheduler
 * - Add job: curl https://your-app-name.herokuapp.com/api/cron/aggregate-analytics
 * - Schedule: Every hour
 * 
 * Query Parameters:
 * - ?mode=hourly - Aggregate previous hour (default)
 * - ?mode=daily - Aggregate previous day
 * - ?channel=channelname - Aggregate specific channel only
 * - ?test=true - Test mode (bypasses time checks)
 * 
 * Security: Consider adding authentication (API key, secret header, etc.)
 * Uncomment the authentication check below and set CRON_SECRET in your environment variables.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const mode = (req.query.mode as string) || 'hourly'; // 'hourly' or 'daily'
  const channelName = req.query.channel as string | undefined;
  const isTestMode = req.query.test === 'true';

  try {

    let result;

    if (mode === 'daily') {
      // Aggregate previous day
      if (channelName) {
        const now = new Date();
        const currentDayStart = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0, 0, 0, 0
        ));
        const previousDayStart = new Date(currentDayStart.getTime() - 24 * 60 * 60 * 1000);
        const previousDayEnd = currentDayStart;

        result = await aggregateAndSaveAnalytics(
          channelName,
          previousDayStart,
          previousDayEnd,
          'daily'
        );
      } else {
        result = await aggregatePreviousDay();
      }
    } else {
      // Aggregate previous hour (default)
      if (channelName) {
        const now = new Date();
        const currentHourStart = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          now.getUTCHours(),
          0, 0, 0
        ));
        const previousHourStart = new Date(currentHourStart.getTime() - 60 * 60 * 1000);
        const previousHourEnd = currentHourStart;

        result = await aggregateAndSaveAnalytics(
          channelName,
          previousHourStart,
          previousHourEnd,
          'hourly'
        );
      } else {
        result = await aggregatePreviousHour();
      }
    }

    logger.info('Analytics aggregation completed', {
      mode,
      channelName: channelName || 'all channels',
      result
    });

    return res.status(200).json({
      success: true,
      message: `Analytics aggregation completed (${mode})`,
      mode,
      channelName: channelName || 'all channels',
      result: {
        channelsProcessed: result.channelsProcessed,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        errors: result.errors.length > 0 ? result.errors : undefined
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error in analytics aggregation cron job', {
      error: error instanceof Error ? error.message : 'Unknown error',
      mode,
      channelName
    });

    return res.status(500).json({
      success: false,
      error: 'Aggregation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      mode,
      channelName: channelName || 'all channels',
      timestamp: new Date().toISOString()
    });
  }
}

export default withWingmanDB(handler);
