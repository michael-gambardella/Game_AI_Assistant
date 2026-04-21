import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {

    // console.log('🔄 Starting unlimited usage limit cleanup...'); // Commented out for production

    // Get all users from the database
    const users = await User.find({});
    // console.log(`📊 Found ${users.length} users to update`); // Commented out for production

    let updatedCount = 0;
    const errors: string[] = [];

    for (const user of users) {
      try {
        const now = new Date();

        const unlimitedUsage = {
          freeQuestionsUsed: 0,
          freeQuestionsLimit: -1, // Unlimited for analytics consistency
          windowStartTime: now,
          windowDurationHours: 0,
          lastQuestionTime: now,
          cooldownUntil: undefined
        };

        await User.findByIdAndUpdate(
          user._id,
          {
            $set: {
              usageLimit: unlimitedUsage
            }
          },
          { new: true }
        );

        updatedCount++;
      } catch (error) {
        const errorMsg = `Failed to update user ${user.username}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    const result = {
      totalUsers: users.length,
      updated: updatedCount,
      errors: errors.length,
      errorDetails: errors,
      timestamp: new Date().toISOString()
    };

    // console.log('🎉 Unlimited usage cleanup completed!'); // Commented out for production

    return res.status(200).json({
      message: 'All users updated with unlimited usage limits',
      ...result
    });

  } catch (error) {
    console.error('❌ Advanced migration failed:', error);
    return res.status(500).json({
      message: 'Advanced migration failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
