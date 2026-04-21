import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {

    // console.log('🔄 Starting user usage limits migration...'); // Commented out for production

    // Get all users from the database
    const users = await User.find({});
    // console.log(`📊 Found ${users.length} users to migrate`); // Commented out for production

    let migratedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const user of users) {
      try {
        // Check if user already has usageLimit data
        if (user.usageLimit) {
          // console.log(`⏭️  Skipping user ${user.username} - already has usage limit data`); // Commented out for production
          skippedCount++;
          continue;
        }

        // Initialize usage limit data for all users
        const now = new Date();
        const usageLimit = {
          freeQuestionsUsed: 0,
          freeQuestionsLimit: 10,
          windowStartTime: now,
          windowDurationHours: 1,
          lastQuestionTime: now
        };

        // Update the user with usage limit data
        await User.findByIdAndUpdate(
          user._id,
          { 
            $set: { 
              usageLimit: usageLimit 
            } 
          },
          { new: true }
        );

        // console.log(`✅ Migrated user: ${user.username} (Pro: ${user.hasProAccess})`); // Commented out for production
        migratedCount++;

      } catch (error) {
        const errorMsg = `Failed to migrate user ${user.username}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    // Get updated counts by user type
    const proUsers = await User.countDocuments({ hasProAccess: true });
    const freeUsers = await User.countDocuments({ hasProAccess: false });
    const usersWithUsageLimits = await User.countDocuments({ 'usageLimit': { $exists: true } });

    const result = {
      totalUsers: users.length,
      migrated: migratedCount,
      skipped: skippedCount,
      errors: errors.length,
      errorDetails: errors,
      finalStats: {
        proUsers,
        freeUsers,
        usersWithUsageLimits
      },
      timestamp: new Date().toISOString()
    };

    // console.log('🎉 Migration completed!'); // Commented out for production
    // console.log('📈 Final Stats:', result.finalStats); // Commented out for production

    return res.status(200).json({
      message: 'User usage limits migration completed successfully',
      ...result
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    return res.status(500).json({
      message: 'Migration failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
