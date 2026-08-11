import { connectToSplashDB, connectToWingmanDB } from './databaseConnections';
import { Schema } from 'mongoose';
import User from '../models/User';
import { ISplashUser } from '../types';
import connectToMongoDB from './mongodb';
import { PRO_DEADLINE, EARLY_ACCESS_START_DATE, EARLY_ACCESS_END_DATE } from './earlyAccessConfig';

// SplashDB User schema
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

// Check pro access for a user
export const checkProAccess = async (identifier: string, userId?: string): Promise<boolean> => {
  // Always grant Pro access for test/dev user (with username)
  if (identifier === "test-user" || identifier === "TestUser1") return true;
  
  // Always grant Pro access for LegendaryRenegade (Master account)
  if (identifier === "LegendaryRenegade") return true;
  
  // Always grant Pro access for automated users
  const automatedUsers = ["MysteriousMrEnter", "WaywardJammer", "InterdimensionalHipster"];
  if (automatedUsers.includes(identifier)) return true;
  
  try {
    await connectToWingmanDB();
    const splashDB = await connectToSplashDB();

    const AppUser = User;
    const SplashUser = splashDB.models.SplashUser || splashDB.model<ISplashUser>('SplashUser', splashUserSchema);

    // Check if identifier is an email (contains @)
    const isEmail = identifier.includes('@');
    const normalizedIdentifier = isEmail ? identifier.trim().toLowerCase() : identifier;
    
    // Build query - prioritize username over userId when both are provided
    // Use case-insensitive email matching if identifier is an email
    const emailQuery = isEmail 
      ? { email: new RegExp(`^${normalizedIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      : { email: identifier };
    
    // Try to find by username first (most specific), then userId, then email
    // This prevents matching the wrong user when userId matches a different user
    let appUser = null;
    let splashUser = null;
    
    // Priority 1: Find by username if identifier is not an email
    if (!isEmail && identifier) {
      appUser = await AppUser.findOne({ username: identifier });
      if (!appUser) {
        splashUser = await SplashUser.findOne({ username: identifier });
      }
    }
    
    // Priority 2: If not found by username, try userId (both from identifier and userId param)
    if (!appUser) {
      const userIdQuery = userId 
        ? { $or: [{ userId: identifier }, { userId }] }
        : { userId: identifier };
      appUser = await AppUser.findOne(userIdQuery);
      if (!appUser) {
        splashUser = await SplashUser.findOne(userIdQuery);
      }
    }
    
    // Priority 3: If not found by username or userId, try email
    if (!appUser && emailQuery) {
      appUser = await AppUser.findOne(emailQuery);
      if (!appUser) {
        splashUser = await SplashUser.findOne(emailQuery);
      }
    }

    // PRIORITY 1: Check main application database first
    if (appUser) {
      // 1. Check if user has active subscription using new subscription system
      if (appUser.hasActiveProAccess && appUser.hasActiveProAccess()) {
        console.log('Pro access granted via hasActiveProAccess() method for user:', appUser.username);
        return true;
      }

      // 2. Check if user has active subscription status
      if (appUser.subscription?.status === 'active' && appUser.subscription?.currentPeriodEnd && appUser.subscription.currentPeriodEnd > new Date()) {
        console.log('Pro access granted via active subscription for user:', appUser.username);
        return true;
      }

      // 3. Check if user has canceled subscription but still has access until period end
      if (appUser.subscription?.status === 'canceled' && appUser.subscription?.cancelAtPeriodEnd && appUser.subscription?.currentPeriodEnd && appUser.subscription.currentPeriodEnd > new Date()) {
        console.log('Pro access granted via canceled subscription (active until period end) for user:', appUser.username);
        return true;
      }
    }

    // PRIORITY 2: Check early access eligibility from Splash DB (only if not found in main app)
    if (splashUser) {
      // Check deadline logic
      // Handle both old format (user-1762023949745) and new format (user-1762029860357-0f08c4)
      const proDeadline = PRO_DEADLINE;
      let signupDate: Date | null = null;
      if (splashUser.userId && splashUser.userId.includes('-')) {
        // Extract date from userId if possible
        // For both formats, the timestamp is always in split('-')[1]
        // Old: user-1762023949745 -> ["user", "1762023949745"]
        // New: user-1762029860357-0f08c4 -> ["user", "1762029860357", "0f08c4"]
        const datePart = splashUser.userId.split('-')[1];
        // Only parse if it's purely numeric (timestamp)
        if (/^\d+$/.test(datePart) && !isNaN(Date.parse(datePart))) {
          signupDate = new Date(datePart);
        }
      }
      const isEarlyUser = typeof splashUser.position === 'number' && splashUser.position <= 5000;
      const isBeforeDeadline = signupDate && signupDate <= proDeadline;

      if (
        splashUser.hasProAccess ||
        splashUser.isApproved ||
        isEarlyUser ||
        isBeforeDeadline
      ) {
        // If user is eligible for early access, update their subscription data
        if (appUser && !appUser.subscription?.earlyAccessGranted) {
          const earlyAccessStartDate = EARLY_ACCESS_START_DATE;
          const earlyAccessEndDate = EARLY_ACCESS_END_DATE;
          
          await AppUser.findOneAndUpdate(
            { _id: appUser._id },
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
        }
        return true;
      }
    }

    // PRIORITY 3: Otherwise, no Pro access
    return false;
  } catch (error) {
    console.error('Error checking Pro access:', error);
    return false;
  }
};

export const syncUserData = async (userId: string, email?: string): Promise<void> => {
  try {
    // Clean the email if it has malformed parameters attached
    if (email) {
      // Handle various malformed email formats
      if (email.includes("?")) {
        // Extract the actual email (everything before the first ?)
        email = email.split("?")[0];
        console.log("Cleaned malformed email in syncUserData:", email);
      }
      
      // Additional cleanup for any remaining malformed parameters
      if (email.includes("?earlyAccess=true")) {
        email = email.replace("?earlyAccess=true", "");
        console.log("Cleaned remaining malformed parameters from email in syncUserData");
      }
      
      // Normalize email to lowercase for case-insensitive matching
      email = email.trim().toLowerCase();
    }

    // Connect to databases
    await connectToMongoDB(); // Ensure MongoDB is connected
    const splashDB = await connectToSplashDB();

    // Use unique model names to avoid conflicts
    const AppUser = User;
    const SplashUser = splashDB.models.SplashUser || splashDB.model<ISplashUser>('SplashUser', splashUserSchema);
    
    // Debug: Verify SplashUser model is working
    // console.log('SplashUser model status:', {
    //   hasModel: !!SplashUser,
    //   modelName: SplashUser?.modelName,
    //   collectionName: SplashUser?.collection?.name,
    //   dbName: splashDB?.name
    // });

    // First check if user already exists in Wingman DB
    // console.log('=== syncUserData called ===', { userId, email });
    const existingWingmanUser = await AppUser.findOne({ userId });
    
    if (existingWingmanUser) {
      // console.log('✓ User already exists in Wingman DB, checking for Pro access eligibility:', {
      //   userId,
      //   existingEmail: existingWingmanUser.email,
      //   discordEmail: email,
      //   existingUserId: existingWingmanUser.userId,
      //   hasProAccess: existingWingmanUser.hasProAccess
      // });
      
      // Update the existing user with Discord email if different (case-insensitive comparison)
      if (email && email.toLowerCase() !== (existingWingmanUser.email || '').toLowerCase()) {
        await AppUser.findOneAndUpdate(
          { userId },
          { 
            email: email, // Update with Discord email
            $addToSet: { 
              linkedAccounts: { 
                platform: 'discord', 
                email: email,
                linkedAt: new Date()
              }
            }
          }
        );
        // console.log('Updated user with Discord email');
      }

      // Check if user should have Pro access from splash database
      // Try multiple lookup strategies to find the user
      let splashUser = null;
      
      // Strategy 1: Direct userId lookup (most reliable - userIds are unique)
      if (existingWingmanUser && existingWingmanUser.userId) {
        // console.log('Attempting direct userId lookup in splash DB:', existingWingmanUser.userId);
        const userIdResults = await SplashUser.find({ userId: existingWingmanUser.userId }).lean();
        // console.log(`Found ${userIdResults.length} user(s) with userId ${existingWingmanUser.userId}`);
        
        if (userIdResults.length > 0) {
          splashUser = userIdResults[0]; // userIds are unique, so should only be one
          // console.log('✓ Found splash user by userId!', { 
          //   email: splashUser.email, 
          //   userId: splashUser.userId,
          //   isApproved: splashUser.isApproved,
          //   hasProAccess: splashUser.hasProAccess 
          // });
        }
      }
      
      // Strategy 2: If still not found, try by function parameter userId
      if (!splashUser && userId && userId !== existingWingmanUser?.userId) {
        // console.log('Attempting userId lookup with parameter:', userId);
        const userIdResults = await SplashUser.find({ userId: userId }).lean();
        if (userIdResults.length > 0) {
          splashUser = userIdResults[0];
          // console.log('✓ Found splash user by parameter userId!', { 
          //   email: splashUser.email, 
          //   userId: splashUser.userId 
          // });
        }
      }
      
      // Then try email lookups - use find() since findOne() seems to have issues
      if (!splashUser && email) {
        // Strategy 1: Exact email match first (most reliable) - use find() and take first
        // console.log('Attempting exact email lookup:', email);
        const emailResults = await SplashUser.find({ email: email }).lean();
        if (emailResults.length > 0) {
          splashUser = emailResults[0];
          // console.log('✓ Found splash user by exact email!', { email: splashUser.email, userId: splashUser.userId });
        }
        
        // Strategy 2: Case-insensitive email regex match
        if (!splashUser) {
          const regexResults = await SplashUser.find({ 
            email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
          }).lean();
          if (regexResults.length > 0) {
            splashUser = regexResults[0];
            // console.log('✓ Found splash user by regex email!', { email: splashUser.email, userId: splashUser.userId });
          }
        }
        
        // Strategy 3: Try with trimmed email
        if (!splashUser) {
          const trimmedResults = await SplashUser.find({ email: email.trim() }).lean();
          if (trimmedResults.length > 0) {
            splashUser = trimmedResults[0];
            // console.log('✓ Found splash user by trimmed email!', { email: splashUser.email, userId: splashUser.userId });
          }
        }
      }
      
      // Strategy 4: Try by existing user's email (original casing) - use find()
      if (!splashUser && existingWingmanUser && existingWingmanUser.email) {
        // console.log('Attempting lookup with existing user email:', existingWingmanUser.email);
        const existingEmailResults = await SplashUser.find({ email: existingWingmanUser.email }).lean();
        if (existingEmailResults.length > 0) {
          splashUser = existingEmailResults[0];
          // console.log('✓ Found splash user by existing email!', { email: splashUser.email, userId: splashUser.userId });
        }
      }
      
      // Debug: Log all attempts if not found
      // if (!splashUser) {
      //   console.log('SplashUser lookup failed. Attempted strategies:', {
      //     emailUsed: email,
      //     userIdUsed: userId,
      //     existingEmail: existingWingmanUser.email,
      //     existingUserId: existingWingmanUser.userId
      //   });
      //   
      // // Debug: Try exact queries to see what's actually in the DB
      // console.log('Debug: Testing exact queries...');
      // 
      // // Debug: Check total count and sample documents in the collection
      // const totalCount = await SplashUser.countDocuments({});
      // console.log(`Total documents in splashusers collection: ${totalCount}`);
      // 
      // // Get a few sample documents to see the structure
      // const sampleDocs = await SplashUser.find({}).limit(3).lean();
      // console.log('Sample documents from splashusers collection:', sampleDocs.map(doc => ({
      //   email: doc.email,
      //   userId: doc.userId,
      //   isApproved: doc.isApproved,
      //   hasProAccess: doc.hasProAccess,
      //   _id: doc._id
      // })));
      // 
      // if (email) {
      //   const exactEmailResult = await SplashUser.find({ email: email }).lean();
      //   console.log(`Exact email match (${email}):`, exactEmailResult.length, 'results');
      //   if (exactEmailResult.length > 0) {
      //     console.log('Email match result:', exactEmailResult[0]);
      //   }
      // }
      // if (userId) {
      //   const exactUserIdResult = await SplashUser.find({ userId: userId }).lean();
      //   console.log(`Exact userId match (${userId}):`, exactUserIdResult.length, 'results');
      //   if (exactUserIdResult.length > 0) {
      //     console.log('UserId match result:', exactUserIdResult[0]);
      //   }
      // }
      // if (existingWingmanUser.userId) {
      //   const exactExistingUserIdResult = await SplashUser.find({ userId: existingWingmanUser.userId }).lean();
      //   console.log(`Exact existing userId match (${existingWingmanUser.userId}):`, exactExistingUserIdResult.length, 'results');
      //   if (exactExistingUserIdResult.length > 0) {
      //     console.log('Existing userId match result:', exactExistingUserIdResult[0]);
      //   }
      // }
      // 
      // // Also try searching by any part of the email
      // if (email) {
      //   const partialMatch = await SplashUser.find({ 
      //     email: { $regex: email.split('@')[0], $options: 'i' } 
      //   }).lean();
      //   console.log(`Partial email match (${email.split('@')[0]}):`, partialMatch.length, 'results');
      //   if (partialMatch.length > 0) {
      //     console.log('Partial matches:', partialMatch.map(u => ({ email: u.email, userId: u.userId })));
      //   }
      // }
      // }
      
      // console.log('Looking up SplashUser for existing Wingman user:', {
      //   email,
      //   userId,
      //   existingEmail: existingWingmanUser.email,
      //   foundSplashUser: !!splashUser,
      //   splashUserEmail: splashUser?.email,
      //   splashUserUserId: splashUser?.userId,
      //   splashUserIsApproved: splashUser?.isApproved,
      //   splashUserHasProAccess: splashUser?.hasProAccess
      // });

      if (splashUser) {
        const isApproved = splashUser.isApproved || splashUser.hasProAccess;
        const isEarlyUser = (typeof splashUser.position === 'number' && splashUser.position <= 5000);
        
        // Check deadline logic
        // Handle both old format (user-1762023949745) and new format (user-1762029860357-0f08c4)
        let signupDate: Date | null = null;
        if (splashUser.userId.includes('-') && splashUser.userId.split('-').length > 1) {
          try {
            // For both formats, the timestamp is always in split('-')[1]
            // Old: user-1762023949745 -> ["user", "1762023949745"]
            // New: user-1762029860357-0f08c4 -> ["user", "1762029860357", "0f08c4"]
            const datePart = splashUser.userId.split('-')[1];
            // Only parse if it's purely numeric (timestamp) or can be parsed as a date
            if (/^\d+$/.test(datePart) && !isNaN(Date.parse(datePart))) {
              signupDate = new Date(datePart);
            }
          } catch (error) {
            console.log('Could not parse date from userId:', splashUser.userId);
          }
        }
        const proDeadline = PRO_DEADLINE;
        const isBeforeDeadline = signupDate ? signupDate <= proDeadline : false;

        const shouldHaveProAccess = isEarlyUser || isBeforeDeadline || isApproved;

        // console.log('Existing user Pro access check:', {
        //   userId,
        //   isApproved,
        //   isEarlyUser,
        //   isBeforeDeadline,
        //   shouldHaveProAccess,
        //   currentHasProAccess: existingWingmanUser.hasProAccess
        // });

        // Prepare update data for both Pro access and password setup
        const updateData: any = {};
        let needsUpdate = false;

        // Always check and update Pro access if they should have it (to sync changes from splash database)
        if (shouldHaveProAccess) {
          const earlyAccessStartDate = EARLY_ACCESS_START_DATE;
          const earlyAccessEndDate = EARLY_ACCESS_END_DATE;
          
          // Check if user needs subscription data update
          // Update if subscription doesn't exist, or if status is wrong, or if earlyAccessGranted is false
          const currentStatus = existingWingmanUser.subscription?.status;
          const hasEarlyAccess = existingWingmanUser.subscription?.earlyAccessGranted;
          const needsSubscriptionUpdate = !existingWingmanUser.subscription || 
                                        currentStatus !== 'free_period' || 
                                        !hasEarlyAccess ||
                                        currentStatus === 'expired';
          
          if (!existingWingmanUser.hasProAccess || needsSubscriptionUpdate) {
            updateData.hasProAccess = true;
            updateData.subscription = {
              status: 'free_period',
              earlyAccessGranted: true,
              earlyAccessStartDate,
              earlyAccessEndDate,
              transitionToPaid: false,
              currentPeriodStart: earlyAccessStartDate,
              currentPeriodEnd: earlyAccessEndDate,
              billingCycle: 'monthly',
              currency: 'usd',
              cancelAtPeriodEnd: false
            };
            needsUpdate = true;
            // console.log('User needs Pro access update', {
            //   currentStatus,
            //   hasEarlyAccess,
            //   hasProAccess: existingWingmanUser.hasProAccess
            // });
          }
        }

        // Always check and update requiresPasswordSetup if user doesn't have a password
        // This is separate from Pro access check so it works for all users
        if (!existingWingmanUser.password && !existingWingmanUser.requiresPasswordSetup) {
          updateData.requiresPasswordSetup = true;
          needsUpdate = true;
          // console.log('User needs password setup flag update');
        }

        // Apply updates if any are needed
        if (needsUpdate) {
          // console.log('Updating existing user with data from splash database:', updateData);
          // Use $set to ensure subscription object is fully replaced, not merged
          await AppUser.findOneAndUpdate(
            { userId },
            { $set: updateData }
          );
          // console.log('Updated existing user successfully');
        } else {
          // console.log('User already has correct settings');
        }
      }
      
      return; // User already exists, no need to create new one
    }

    // Check Splash DB for early access users
    // Use case-insensitive email lookup to handle case variations
    const splashUser = email 
      ? await SplashUser.findOne({ 
          email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        })
      : await SplashUser.findOne({ userId });
    
    // console.log('Looking up SplashUser for new user sync:', {
    //   email,
    //   userId,
    //   foundSplashUser: !!splashUser,
    //   splashUserEmail: splashUser?.email,
    //   splashUserIsApproved: splashUser?.isApproved,
    //   splashUserHasProAccess: splashUser?.hasProAccess
    // });

    // Also check Wingman DB by email as fallback
    // Use case-insensitive email lookup to handle case variations
    let existingWingmanUserByEmail = null;
    if (email) {
      existingWingmanUserByEmail = await AppUser.findOne({ 
        email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      });
    }

    // If we found an existing Wingman user by email, update their userId to Discord ID
    if (existingWingmanUserByEmail) {
      // console.log('Found existing Wingman user by email, updating with Discord ID:', {
      //   existingUserId: existingWingmanUserByEmail.userId,
      //   discordUserId: userId,
      //   email: email,
      //   hasProAccess: existingWingmanUserByEmail.hasProAccess
      // });
      
      // Update the existing user with Discord userId
      await AppUser.findOneAndUpdate(
        { email },
        { 
          userId: userId, // Update with Discord userId
          $addToSet: { 
            linkedAccounts: { 
              platform: 'discord', 
              userId: userId,
              linkedAt: new Date()
            }
          }
        }
      );
      // console.log('Updated existing user with Discord ID');
      return; // User already exists, no need to create new one
    }

    if (splashUser) {
      // Check pro access eligibility
      // Handle both old format (user-1762023949745) and new format (user-1762029860357-0f08c4)
      let signupDate: Date | null = null;
      
      // Only try to parse date if userId contains a date format (not Discord IDs)
      if (splashUser.userId.includes('-') && splashUser.userId.split('-').length > 1) {
        try {
          // For both formats, the timestamp is always in split('-')[1]
          // Old: user-1762023949745 -> ["user", "1762023949745"]
          // New: user-1762029860357-0f08c4 -> ["user", "1762029860357", "0f08c4"]
          const datePart = splashUser.userId.split('-')[1];
          // Only parse if it's purely numeric (timestamp) or can be parsed as a date
          if (/^\d+$/.test(datePart) && !isNaN(Date.parse(datePart))) {
            signupDate = new Date(datePart);
          }
        } catch (error) {
          console.log('Could not parse date from userId:', splashUser.userId);
        }
      }
      
      const proDeadline = PRO_DEADLINE;
      const earlyAccessStartDate = EARLY_ACCESS_START_DATE;
      const earlyAccessEndDate = EARLY_ACCESS_END_DATE;
      
      const isEarlyUser = (typeof splashUser.position === 'number' && splashUser.position <= 5000);
      const isBeforeDeadline = signupDate ? signupDate <= proDeadline : false;
      const isApproved = splashUser.isApproved || splashUser.hasProAccess;
      const hasProAccess = isEarlyUser || isBeforeDeadline || isApproved;

      // console.log('Pro access eligibility check:', {
      //   userId: splashUser.userId,
      //   email: splashUser.email,
      //   isEarlyUser,
      //   isBeforeDeadline,
      //   isApproved,
      //   hasProAccess,
      //   position: splashUser.position,
      //   signupDate: signupDate?.toISOString()
      // });

      // Check if user already exists to handle requiresPasswordSetup correctly
      const existingUser = await AppUser.findOne({ userId: splashUser.userId });
      
      // Generate a unique username if user doesn't have one (for both new and existing users with null username)
      let username = existingUser?.username;
      const needsUsername = !username || username === null || username === '';
      
      if (needsUsername) {
        // Generate a unique username based on userId (extract numeric part or use full userId)
        // Use a format that's unique and valid for username requirements
        const userIdPart = splashUser.userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        username = `user${userIdPart}`;
        
        // Ensure username meets requirements (3-32 chars, valid format)
        if (username.length < 3) {
          username = username.padEnd(3, '0');
        }
        if (username.length > 32) {
          username = username.substring(0, 32);
        }
        
        // Check if this username is already taken and generate a unique one if needed
        let counter = 1;
        while (await AppUser.findOne({ username })) {
          const suffix = counter.toString();
          username = `user${userIdPart.substring(0, 32 - suffix.length)}${suffix}`;
          counter++;
          if (counter > 1000) {
            // Fallback to timestamp-based username if we can't find a unique one
            username = `user${Date.now()}`;
            break;
          }
        }
      }
      
      // Update or create user in Wingman DB with all required fields
      const updateFields: any = {
        userId: splashUser.userId,
        email: splashUser.email,
        hasProAccess, // Use the calculated hasProAccess value
        // Set requiresPasswordSetup only if user doesn't have a password
        // (for new users from splash page, or existing users without password)
        ...((!existingUser || !existingUser.password) && { requiresPasswordSetup: true }),
      };
      
      // If username needs to be set (new user or existing user with null username), include it in update
      if (needsUsername) {
        updateFields.username = username;
      }

      // Add subscription data for early access users - use $set to fully replace subscription object
      if (hasProAccess) {
        updateFields['subscription'] = {
          status: 'free_period',
          earlyAccessGranted: true,
          earlyAccessStartDate,
          earlyAccessEndDate,
          transitionToPaid: false,
          currentPeriodStart: earlyAccessStartDate,
          currentPeriodEnd: earlyAccessEndDate,
          billingCycle: 'monthly',
          currency: 'usd',
          cancelAtPeriodEnd: false
        };
      }

      await AppUser.findOneAndUpdate(
        { userId: splashUser.userId },
        {
          $set: updateFields,
          $setOnInsert: {
            conversationCount: 0,
            achievements: [],
            progress: {
              firstQuestion: 0,
              frequentAsker: 0,
              rpgEnthusiast: 0,
              bossBuster: 0,
              platformerPro: 0,
              survivalSpecialist: 0,
              strategySpecialist: 0,
              actionAficionado: 0,
              battleRoyaleMaster: 0,
              sportsChampion: 0,
              adventureAddict: 0,
              fightingFanatic: 0,
              simulationSpecialist: 0,
              shooterSpecialist: 0,
              puzzlePro: 0,
              racingRenegade: 0,
              stealthExpert: 0,
              horrorHero: 0,
              triviaMaster: 0,
              storySeeker: 0,
              beatEmUpBrawler: 0,
              rhythmMaster: 0,
              sandboxBuilder: 0,
              shootemUpSniper: 0,
              rogueRenegade: 0,
              totalQuestions: 0,
              dailyExplorer: 0,
              speedrunner: 0,
              collectorPro: 0,
              dataDiver: 0,
              performanceTweaker: 0,
              conversationalist: 0,
              proAchievements: {
                gameMaster: 0,
                speedDemon: 0,
                communityLeader: 0,
                achievementHunter: 0,
                proStreak: 0,
                expertAdvisor: 0,
                genreSpecialist: 0,
                proContributor: 0
              }
            }
          }
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );
    } else {
      // Handle case where user is not in Splash DB
      // This could be a new user, Discord user, or a user who signed up after the deadline
      // console.log('User not found in Splash DB, creating basic user record:', { userId, email });
      
      await AppUser.findOneAndUpdate(
        { userId },
        {
          userId,
          email: email || `discord-${userId}@example.com`,
          username: `discord-${userId}`, // Give Discord users a unique username
          hasProAccess: false, // Discord users start without Pro access
          conversationCount: 0,
          $setOnInsert: {
            achievements: [],
            progress: {
              firstQuestion: 0,
              frequentAsker: 0,
              rpgEnthusiast: 0,
              bossBuster: 0,
              platformerPro: 0,
              survivalSpecialist: 0,
              strategySpecialist: 0,
              actionAficionado: 0,
              battleRoyaleMaster: 0,
              sportsChampion: 0,
              adventureAddict: 0,
              fightingFanatic: 0,
              simulationSpecialist: 0,
              shooterSpecialist: 0,
              puzzlePro: 0,
              racingRenegade: 0,
              stealthExpert: 0,
              horrorHero: 0,
              triviaMaster: 0,
              storySeeker: 0,
              beatEmUpBrawler: 0,
              rhythmMaster: 0,
              sandboxBuilder: 0,
              shootemUpSniper: 0,
              rogueRenegade: 0,
              totalQuestions: 0,
              dailyExplorer: 0,
              speedrunner: 0,
              collectorPro: 0,
              dataDiver: 0,
              performanceTweaker: 0,
              conversationalist: 0,
              proAchievements: {
                gameMaster: 0,
                speedDemon: 0,
                communityLeader: 0,
                achievementHunter: 0,
                proStreak: 0,
                expertAdvisor: 0,
                genreSpecialist: 0,
                proContributor: 0
              }
            }
          }
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );
    }
  } catch (error) {
    console.error('Error syncing user data:', error);
    // Don't throw the error, just log it to prevent the callback from failing
    // The user can still proceed with Discord authentication
  }
};