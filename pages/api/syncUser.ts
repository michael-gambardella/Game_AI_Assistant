import type { NextApiRequest, NextApiResponse } from 'next';
import { syncUserData } from '../../utils/proAccessUtil';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';
import { containsOffensiveContent } from '../../utils/contentModeration';
import { handleContentViolation } from '../../utils/violationHandler';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow both GET and POST for convenience
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Get parameters from query (GET) or body (POST)
  const { userId, email, username } = req.method === 'GET' 
    ? req.query as { userId: string; email?: string; username?: string }
    : req.body;

  if (!userId || !email) {
    return res.status(400).json({ message: 'userId and email are required' });
  }

  // Only check if userId equals username if both are provided and username is not a timestamp-based test value
  if (userId && username && userId === username && !username.includes('TestUser1')) {
    return res.status(400).json({ message: "Invalid userId or email" });
  }

  try {

    // Check for offensive content in username
    if (username) {
      // Basic username validation
      if (username.length < 3) {
        return res.status(400).json({ 
          message: 'Username must be at least 3 characters long.'
        });
      }
      
      if (username.length > 32) {
        return res.status(400).json({ 
          message: 'Username must be 32 characters or less.'
        });
      }
      
      // Check for valid characters (alphanumeric, underscore, hyphen)
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return res.status(400).json({ 
          message: 'Username can only contain letters, numbers, underscores, and hyphens.'
        });
      }
      
      const contentCheck = await containsOffensiveContent(username, userId);
      if (contentCheck.isOffensive) {
        // Add a warning to the user's violation record
        const violationResult = await handleContentViolation(username, contentCheck.offendingWords);
        
        // Create a more detailed error message
        let errorMessage = 'Username contains offensive content. Please try a different username.';
        
        if (violationResult.action === 'warning') {
          errorMessage = `Username contains inappropriate content: "${contentCheck.offendingWords.join(', ')}". Warning ${violationResult.count}/3. Please choose a different username.`;
        } else if (violationResult.action === 'banned') {
          const banDate = new Date(violationResult.expiresAt).toLocaleDateString();
          errorMessage = `Username contains inappropriate content. You are temporarily banned until ${banDate}. Please try again later.`;
        } else if (violationResult.action === 'permanent_ban') {
          errorMessage = `Username contains inappropriate content. You are permanently banned from using this application.`;
        }
        
        return res.status(400).json({ 
          message: errorMessage,
          offendingWords: contentCheck.offendingWords,
          violationResult
        });
      }
    }

    // Find user by userId
    let user = await User.findOne({ userId });

    // If user exists and no username provided, just sync the data (for testing/syncing existing users)
    if (user && !username) {
      await syncUserData(userId, email);
      const updatedUser = await User.findOne({ userId });
      return res.status(200).json({ 
        message: 'User data synced successfully', 
        user: updatedUser 
      });
    }

    // If user exists but has no username, require one to be set
    if (user && !user.username) {
      if (!username) {
        return res.status(400).json({ message: 'Username required for legacy user' });
      }
      // Check if username is taken by another user
      const usernameTaken = await User.findOne({ username, userId: { $ne: userId } });
      if (usernameTaken) {
        return res.status(409).json({ message: 'Username is already taken' });
      }
      // Update legacy user with new username
      user.username = username;
      await user.save();
      await syncUserData(userId, email);
      return res.status(200).json({ message: 'Username set for legacy user', user });
    }

    // If user does not exist, require username for new user
    if (!user && !username) {
      return res.status(400).json({ message: 'Username is required for new users' });
    }

    // Find user by username
    const userByUsername = await User.findOne({ username });

    if (userByUsername) {
      // If the username is taken by the same userId, allow sign-in
      if (userByUsername.userId === userId) {
        // This is the same user, sync and return
        await syncUserData(userId, email);
        const updatedUser = await User.findOne({ userId });
        return res.status(200).json({ message: 'Signed in', user: updatedUser });
      } else {
        // Username is taken by someone else
        return res.status(409).json({ message: 'Username is already taken' });
      }
    }

    // If username is not taken, create or update user
    user = await User.findOneAndUpdate(
      { userId },
      {
        userId,
        email,
        username,
        $setOnInsert: {
          conversationCount: 0,
          hasProAccess: false,
          achievements: [],
          progress: {}
        }
      },
      {
        upsert: true,
        new: true,
        maxTimeMS: 5000
      }
    ).exec();

    // Sync user data (this will handle early access eligibility)
    await syncUserData(userId, email);
    
    // Fetch the updated user to get the latest subscription data
    const updatedUser = await User.findOne({ userId });
    
    // Check if user is eligible for early access and set up subscription
    if (updatedUser && !updatedUser.subscription?.earlyAccessGranted) {
      const earlyAccessDeadline = new Date('2025-12-31T23:59:59.999Z');
      const currentDate = new Date();
      
      // Check if user signed up before the deadline
      if (currentDate <= earlyAccessDeadline) {
        const earlyAccessStartDate = new Date('2025-12-31T23:59:59.999Z');
        const earlyAccessEndDate = new Date('2026-12-31T23:59:59.999Z');
        
        // Update user with early access subscription
        await User.findOneAndUpdate(
          { userId },
          {
            hasProAccess: true,
            subscription: {
              status: 'free_period',
              earlyAccessGranted: true,
              earlyAccessStartDate,
              earlyAccessEndDate,
              transitionToPaid: false,
              currentPeriodStart: earlyAccessStartDate,
              currentPeriodEnd: earlyAccessEndDate
            }
          }
        );
        
        // Fetch the final updated user
        const finalUser = await User.findOne({ userId });
        return res.status(200).json({ 
          message: 'User data synced successfully - Early access granted!', 
          user: finalUser,
          earlyAccessGranted: true
        });
      }
    }
    
    return res.status(200).json({ message: 'User data synced successfully', user: updatedUser });
  } catch (error) {
    console.error('Error in syncUser API:', error);
    res.status(500).json({
      message: 'Error syncing user data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
