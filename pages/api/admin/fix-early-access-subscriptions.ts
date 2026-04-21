import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import { connectToSplashDB } from '../../../utils/databaseConnections';
import User from '../../../models/User';
import { requireAdminAccess } from '../../../utils/adminAccess';
import { Schema } from 'mongoose';
import { ISplashUser } from '../../../types';

// SplashDB User schema (same as in proAccessUtil.ts)
// Explicitly set collection name to 'users' since that's where the data is stored in splash database
const splashUserSchema = new Schema<ISplashUser>({
  email: { type: String, required: true },
  isApproved: { type: Boolean, default: false },
  userId: { type: String, required: true },
  position: { type: Number, default: null },
  hasProAccess: { type: Boolean, default: false }
}, {
  collection: 'users' // Use 'users' collection, not the default 'splashusers'
});

/**
 * Admin endpoint to fix subscription status for users who have Pro access
 * but incorrect subscription data (expired, wrong status, etc.)
 * 
 * This finds all users with hasProAccess: true but wrong subscription status
 * and updates them to free_period if they're eligible for early access
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow both GET and POST for convenience (GET from browser, POST from scripts)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Get username from request (from query params for GET, body/headers for POST)
    const username = req.method === 'GET' 
      ? (req.query.username as string)
      : (req.headers['x-username'] as string || req.body.username);
    
    // Require admin access
    requireAdminAccess(username);

    // Connect to databases
    const splashDB = await connectToSplashDB();
    // Create model if it doesn't exist (same pattern as proAccessUtil.ts)
    const SplashUser = splashDB.models.SplashUser || splashDB.model<ISplashUser>('SplashUser', splashUserSchema);

    // Find all users with hasProAccess but potentially wrong subscription status
    const usersWithProAccess = await User.find({ 
      hasProAccess: true 
    });

    console.log(`Found ${usersWithProAccess.length} users with Pro access to check`);

    const results = {
      totalChecked: usersWithProAccess.length,
      fixed: 0,
      skipped: 0,
      errors: 0,
      details: [] as Array<{ email: string; username: string; action: string; reason?: string }>
    };

    const earlyAccessStartDate = new Date('2025-12-31T23:59:59.999Z');
    const earlyAccessEndDate = new Date('2026-12-31T23:59:59.999Z');

    for (const user of usersWithProAccess) {
      try {
        // Check if subscription status is wrong
        const currentStatus = user.subscription?.status;
        const hasEarlyAccess = user.subscription?.earlyAccessGranted;
        
        // Check if user needs fixing
        const needsFix = !user.subscription || 
                        currentStatus !== 'free_period' || 
                        !hasEarlyAccess;

        if (!needsFix) {
          results.skipped++;
          results.details.push({
            email: user.email,
            username: user.username,
            action: 'skipped',
            reason: 'Subscription already correct'
          });
          continue;
        }

        // Check splash database to verify eligibility
        let shouldHaveEarlyAccess = false;
        if (user.email) {
          // Look up user in splash database by email
          const splashUser = await SplashUser.findOne({
            email: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
          });

          if (splashUser) {
            const isApproved = splashUser.isApproved || splashUser.hasProAccess;
            const isEarlyUser = (typeof splashUser.position === 'number' && splashUser.position <= 5000);
            
            // Check deadline logic
            let signupDate: Date | null = null;
            if (splashUser.userId.includes('-') && splashUser.userId.split('-').length > 1) {
              try {
                const datePart = splashUser.userId.split('-')[1];
                if (!isNaN(Date.parse(datePart))) {
                  signupDate = new Date(datePart);
                }
              } catch (error) {
                // Ignore parse errors
              }
            }
            const proDeadline = new Date('2025-12-31T23:59:59.999Z');
            const isBeforeDeadline = signupDate ? signupDate <= proDeadline : false;
            
            shouldHaveEarlyAccess = isEarlyUser || isBeforeDeadline || isApproved;
          }
        }

        // If user should have early access, fix their subscription
        if (shouldHaveEarlyAccess || !user.subscription?.stripeSubscriptionId) {
          // Only fix if they don't have a Stripe subscription (to avoid overwriting paid subscriptions)
          // Or if they're eligible for early access
          await User.findOneAndUpdate(
            { _id: user._id },
            {
              $set: {
                hasProAccess: true,
                subscription: {
                  status: 'free_period',
                  earlyAccessGranted: true,
                  earlyAccessStartDate,
                  earlyAccessEndDate,
                  transitionToPaid: false,
                  currentPeriodStart: earlyAccessStartDate,
                  currentPeriodEnd: earlyAccessEndDate,
                  billingCycle: 'monthly',
                  currency: 'usd',
                  cancelAtPeriodEnd: false,
                  // Preserve Stripe IDs if they exist
                  ...(user.subscription?.stripeCustomerId && { stripeCustomerId: user.subscription.stripeCustomerId }),
                  ...(user.subscription?.stripeSubscriptionId && { stripeSubscriptionId: user.subscription.stripeSubscriptionId })
                }
              }
            }
          );

          results.fixed++;
          results.details.push({
            email: user.email,
            username: user.username,
            action: 'fixed',
            reason: `Updated from ${currentStatus} to free_period`
          });

          console.log(`Fixed subscription for user: ${user.email} (${user.username})`);
        } else {
          results.skipped++;
          results.details.push({
            email: user.email,
            username: user.username,
            action: 'skipped',
            reason: 'Has Stripe subscription or not eligible for early access'
          });
        }
      } catch (error) {
        results.errors++;
        results.details.push({
          email: user.email,
          username: user.username,
          action: 'error',
          reason: error instanceof Error ? error.message : 'Unknown error'
        });
        console.error(`Error fixing user ${user.email}:`, error);
      }
    }

    return res.status(200).json({
      message: 'Early access subscription fix completed',
      results
    });

  } catch (error) {
    if (error instanceof Error && (error as any).statusCode === 403) {
      return res.status(403).json({ message: error.message });
    }
    
    console.error('Error in fix-early-access-subscriptions:', error);
    return res.status(500).json({
      message: 'Error fixing subscriptions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
