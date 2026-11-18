import type { NextApiRequest, NextApiResponse } from 'next';
import SubscriptionCleanupService from '../../../utils/subscriptionCleanupService';
import { hasCronSecret } from '../../../middleware/auth';

/**
 * Subscription Cleanup Cron Job
 *
 * Ends Pro access for users whose free early-access period has run out: users with
 * subscription.status 'free_period' and an earlyAccessEndDate in the past are set to
 * hasProAccess: false / status 'expired_free'. Idempotent - safe to run repeatedly.
 * Paid (Stripe) subscriptions are not touched; Stripe webhooks handle those.
 *
 * Schedule: Daily at 05:00 UTC (just after midnight US Eastern, when early-access
 * periods end - see utils/earlyAccessConfig.ts).
 *
 * Heroku Scheduler job (daily, 05:00 UTC):
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://assistant.videogamewingman.com/api/cron/subscription-cleanup
 *
 * For a one-off manual run as the admin, use POST /api/subscriptionCleanup instead.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Scheduled jobs authenticate with Authorization: Bearer <CRON_SECRET>
  if (!hasCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Allow both GET and POST for flexibility with different cron services
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const result = await SubscriptionCleanupService.getInstance().performDailyCleanup();

    console.log(
      `[Subscription Cleanup] ${result.expiredEarlyAccess} of ${result.totalUsers} expired early-access user(s) moved to expired_free`
    );

    return res.status(200).json({
      success: true,
      message: 'Subscription cleanup completed',
      result,
    });
  } catch (error) {
    console.error('Error in subscription cleanup cron:', error);
    return res.status(500).json({
      error: 'Cleanup failed',
      message: 'An error occurred during subscription cleanup',
    });
  }
}
