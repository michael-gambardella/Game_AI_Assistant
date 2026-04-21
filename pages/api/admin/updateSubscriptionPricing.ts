import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import User from '../../../models/User';
import { withWingmanDB } from '../../../utils/withDatabase';
import { requireAdminAccess } from '../../../utils/adminAccess';

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripeClient = stripeSecret
  ? new Stripe(stripeSecret, {
      apiVersion: '2025-05-28.basil',
    })
  : null;

type MigrationDetail = {
  username: string;
  email: string;
  action: 'updated' | 'db_only' | 'skipped' | 'error';
  reason?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const adminUsername =
    (req.headers['x-username'] as string) ||
    (typeof req.body?.username === 'string' ? req.body.username : undefined);

  if (!adminUsername) {
    return res.status(400).json({ message: 'Admin username is required' });
  }

  try {
    requireAdminAccess(adminUsername);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return res.status(403).json({ message });
  }

  if (!stripeClient) {
    return res.status(500).json({ message: 'Stripe secret key is not configured' });
  }

  const targetPriceId = process.env.STRIPE_WINGMAN_PRO_PRICE_ID;
  if (!targetPriceId) {
    return res
      .status(500)
      .json({ message: 'STRIPE_WINGMAN_PRO_PRICE_ID environment variable is not set' });
  }

  try {

    const usersNeedingUpdate = await User.find({
      hasProAccess: true,
      $or: [
        { 'subscription.amount': { $ne: 99 } },
        { 'subscription.amount': { $exists: false } },
      ],
    }).select('username email subscription');

    const summary = {
      totalCandidates: usersNeedingUpdate.length,
      stripeUpdated: 0,
      dbOnlyUpdated: 0,
      skipped: 0,
      errors: 0,
      details: [] as MigrationDetail[],
    };

    for (const user of usersNeedingUpdate) {
      const subscriptionId = user.subscription?.stripeSubscriptionId;

      try {
        let updatedStripe = false;

        if (subscriptionId) {
          const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
          const primaryItem = subscription.items.data[0];

          if (!primaryItem) {
            summary.skipped++;
            summary.details.push({
              username: user.username,
              email: user.email,
              action: 'skipped',
              reason: 'Subscription has no items on Stripe',
            });
            continue;
          }

          if (primaryItem.price?.id !== targetPriceId) {
            await stripeClient.subscriptions.update(subscriptionId, {
              items: [
                {
                  id: primaryItem.id,
                  price: targetPriceId,
                },
              ],
              proration_behavior: 'none',
            });
            updatedStripe = true;
            summary.stripeUpdated++;
          }
        } else {
          summary.dbOnlyUpdated++;
        }

        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              'subscription.amount': 99,
              'subscription.billingCycle': 'monthly',
              'subscription.currency': 'usd',
            },
          }
        );

        summary.details.push({
          username: user.username,
          email: user.email,
          action: subscriptionId ? 'updated' : 'db_only',
          reason: subscriptionId
            ? updatedStripe
              ? 'Stripe subscription price updated'
              : 'Stripe already at target price'
            : 'No Stripe subscription, updated local record only',
        });
      } catch (error) {
        summary.errors++;
        const reason =
          error instanceof Error ? error.message : 'Unknown error while updating user';
        summary.details.push({
          username: user.username,
          email: user.email,
          action: 'error',
          reason,
        });
        console.error(`Failed to update subscription for ${user.username}`, error);
      }
    }

    return res.status(200).json({
      message: 'Subscription pricing migration completed',
      summary,
    });
  } catch (error) {
    console.error('Error migrating subscription pricing:', error);
    return res.status(500).json({
      message: 'Failed to migrate subscription pricing',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withWingmanDB(handler);
