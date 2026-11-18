import type { NextApiRequest, NextApiResponse } from 'next';
import { checkProAccess } from '../../utils/proAccessUtil';
import { connectToWingmanDB } from '../../utils/databaseConnections';
import User from '../../models/User';
import { requireUser } from '../../middleware/auth';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Identity comes from the signed-in session, never the request (middleware/auth.ts)
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    // Pro status is only ever reported for the signed-in user
    const { username, userId } = authUser;

    // Check basic Pro access with error handling
    let hasProAccess = false;
    try {
      hasProAccess = await checkProAccess(username, userId);
    } catch (error) {
      console.error('Error in checkProAccess function:', error);
      // If checkProAccess fails, default to false but don't fail the entire request
      hasProAccess = false;
    }

    // Get detailed subscription information (optional - don't fail if this errors)
    let subscriptionStatus = null;
    if (hasProAccess) {
      try {
        await connectToWingmanDB();
        
        const user = await User.findOne({ userId });

        // If user has Pro access, get detailed subscription status
        if (user && user.hasProAccess && typeof user.getSubscriptionStatus === 'function') {
          try {
            subscriptionStatus = user.getSubscriptionStatus();
          } catch (error) {
            console.error('Error calling getSubscriptionStatus:', error);
            subscriptionStatus = null;
          }
        }
      } catch (error) {
        // Don't fail the request if subscription details can't be fetched
        // The user still has Pro access, we just can't provide detailed status
        console.error('Error fetching subscription details (non-fatal):', error);
        subscriptionStatus = null;
      }
    }

    return res.status(200).json({ 
      hasProAccess,
      subscriptionStatus
    });
  } catch (error) {
    console.error('Error checking Pro access:', error);
    return res.status(500).json({ 
      message: 'Error checking Pro access',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 