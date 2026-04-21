import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username, userId } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }


    // Find user
    const user = await User.findOne({
      $or: [
        { username },
        { userId },
        ...(userId ? [{ userId }] : [])
      ]
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has early access subscription
    if (!user.subscription?.earlyAccessGranted) {
      return res.status(400).json({ 
        message: 'User is not eligible for early access transition',
        eligible: false
      });
    }

    const now = new Date();
    const earlyAccessEndDate = user.subscription.earlyAccessEndDate;
    
    if (!earlyAccessEndDate) {
      return res.status(400).json({ 
        message: 'Invalid early access end date',
        eligible: false
      });
    }

    // Calculate days until expiration
    const daysUntilExpiration = Math.ceil(
      (earlyAccessEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Check if user is already transitioning or has transitioned
    if (user.subscription.transitionToPaid) {
      return res.status(200).json({
        message: 'User has already initiated transition to paid subscription',
        alreadyTransitioning: true,
        daysUntilExpiration,
        canTransition: false
      });
    }

    // Determine transition eligibility and create transition data
    let transitionData = null;
    let canTransition = false;
    let transitionMessage = '';

    if (daysUntilExpiration <= 30) {
      // User can transition if within 30 days of expiration
      canTransition = true;
      transitionMessage = 'Eligible for transition to paid subscription';
      
      // Create transition data for Stripe integration
      transitionData = {
        customerEmail: user.email,
        customerName: user.username,
        amount: 99, // $0.99 in cents
        currency: 'usd',
        billingCycle: 'monthly',
        metadata: {
          userId: user.userId,
          username: user.username,
          transitionFromFree: 'true',
          earlyAccessEndDate: earlyAccessEndDate.toISOString()
        }
      };
    } else if (daysUntilExpiration > 30) {
      // Too early to transition
      transitionMessage = `Transition available ${30 - daysUntilExpiration} days before expiration`;
    } else if (daysUntilExpiration <= 0) {
      // Already expired - can still transition
      canTransition = true;
      transitionMessage = 'Free period expired - upgrade to restore Pro access';
      
      transitionData = {
        customerEmail: user.email,
        customerName: user.username,
        amount: 99,
        currency: 'usd',
        billingCycle: 'monthly',
        metadata: {
          userId: user.userId,
          username: user.username,
          transitionFromExpired: 'true',
          earlyAccessEndDate: earlyAccessEndDate.toISOString()
        }
      };
    }

    // If user can transition, mark them as transitioning
    if (canTransition && transitionData) {
      await User.findOneAndUpdate(
        { _id: user._id },
        {
          'subscription.transitionToPaid': true
        }
      );
    }

    return res.status(200).json({
      message: transitionMessage,
      canTransition,
      daysUntilExpiration,
      earlyAccessEndDate: earlyAccessEndDate.toISOString(),
      transitionData,
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        hasProAccess: user.hasProAccess,
        subscription: {
          status: user.subscription.status,
          earlyAccessGranted: user.subscription.earlyAccessGranted,
          earlyAccessEndDate: user.subscription.earlyAccessEndDate,
          transitionToPaid: user.subscription.transitionToPaid
        }
      }
    });

  } catch (error) {
    console.error('Error handling early access transition:', error);
    return res.status(500).json({
      message: 'Error handling early access transition',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
