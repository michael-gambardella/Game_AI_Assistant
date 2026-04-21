import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';

/**
 * API endpoint to disable weekly digest emails for automated users
 * This updates existing automated users to prevent email bounces
 * 
 * Automated users are identified by:
 * 1. Email addresses ending with @wingman.internal
 * 2. Specific usernames: MysteriousMrEnter, WaywardJammer, InterdimensionalHipster
 * 3. Users with gamerProfile (common/expert gamers)
 * 4. Specific fake email domains: @ymail.com, @smail.com, @rmail.com, @dmail.com
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

    // List of automated usernames (original automated users)
    const automatedUsernames = [
      'MysteriousMrEnter',
      'WaywardJammer',
      'InterdimensionalHipster',
      'PixelPuzzler',
      'RisingRaider',
      'CasualCrusher',
      'StrugglingSniper',
      'NovaNavigator',
      'BeginnerBrawler',
      'AudaciousAdventurer',
      'LamentingLooter',
      'VampireHunter',
      'RacingRookie',
      'PuzzleMaster',
      'RPGVeteran',
      'SimulationSavant',
      'FPSPro',
      'PlatformerManiac',
      'FightingChampion',
      'AdventureAce',
      'LootLegend',
      'MetroidVaniaMaster',
      'RacingRoyalty',
    ];

    // Fake email domains to exclude
    const fakeEmailDomains = ['@ymail.com', '@smail.com', '@rmail.com', '@dmail.com'];

    const results = {
      updated: [] as string[],
      alreadyDisabled: [] as string[],
      notFound: [] as string[],
      errors: [] as string[]
    };

    // Track processed user IDs to avoid duplicates
    const processedUserIds = new Set<string>();
    const processedUsernames = new Set<string>();

    // Update users with @wingman.internal emails
    try {
      const wingmanInternalUsers = await User.find({
        email: { $regex: /@wingman\.internal$/i }
      }).select('username email weeklyDigest');

      for (const user of wingmanInternalUsers) {
        try {
          const userId = user._id.toString();
          const username = user.username || user.email;
          
          // Skip if already processed
          if (processedUserIds.has(userId)) {
            continue;
          }
          
          processedUserIds.add(userId);
          if (user.username) {
            processedUsernames.add(user.username);
          }

          if (user.weeklyDigest?.enabled === false) {
            results.alreadyDisabled.push(username);
          } else {
            await User.findOneAndUpdate(
              { _id: user._id },
              {
                $set: {
                  'weeklyDigest.enabled': false
                }
              }
            );
            results.updated.push(username);
          }
        } catch (error) {
          const errorMsg = `Failed to update ${user.username || user.email}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          results.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }
    } catch (error) {
      console.error('Error updating @wingman.internal users:', error);
    }

    // Update users with gamerProfile (common/expert gamers)
    try {
      const gamerProfileUsers = await User.find({
        'gamerProfile.type': { $exists: true }
      }).select('username email weeklyDigest');

      for (const user of gamerProfileUsers) {
        try {
          const userId = user._id.toString();
          const username = user.username || user.email;
          
          // Skip if already processed
          if (processedUserIds.has(userId) || (user.username && processedUsernames.has(user.username))) {
            continue;
          }
          
          processedUserIds.add(userId);
          if (user.username) {
            processedUsernames.add(user.username);
          }

          if (user.weeklyDigest?.enabled === false) {
            results.alreadyDisabled.push(username);
          } else {
            await User.findOneAndUpdate(
              { _id: user._id },
              {
                $set: {
                  'weeklyDigest.enabled': false
                }
              }
            );
            results.updated.push(username);
          }
        } catch (error) {
          const errorMsg = `Failed to update ${user.username || user.email}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          results.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }
    } catch (error) {
      console.error('Error updating gamerProfile users:', error);
    }

    // Update specific automated usernames
    for (const username of automatedUsernames) {
      try {
        // Skip if already processed
        if (processedUsernames.has(username)) {
          continue;
        }
        
        const user = await User.findOne({ username });
        if (!user) {
          results.notFound.push(username);
          continue;
        }

        const userId = user._id.toString();
        processedUserIds.add(userId);
        processedUsernames.add(username);

        if (user.weeklyDigest?.enabled === false) {
          results.alreadyDisabled.push(username);
        } else {
          await User.findOneAndUpdate(
            { username },
            {
              $set: {
                'weeklyDigest.enabled': false
              }
            }
          );
          results.updated.push(username);
        }
      } catch (error) {
        const errorMsg = `Failed to update ${username}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Update users with fake email domains
    for (const domain of fakeEmailDomains) {
      try {
        const fakeEmailUsers = await User.find({
          email: { $regex: new RegExp(domain + '$', 'i') }
        }).select('username email weeklyDigest');

        for (const user of fakeEmailUsers) {
          try {
            const userId = user._id.toString();
            const username = user.username || user.email;
            
            // Skip if already processed
            if (processedUserIds.has(userId) || (user.username && processedUsernames.has(user.username))) {
              continue;
            }
            
            processedUserIds.add(userId);
            if (user.username) {
              processedUsernames.add(user.username);
            }

            if (user.weeklyDigest?.enabled === false) {
              results.alreadyDisabled.push(username);
            } else {
              await User.findOneAndUpdate(
                { _id: user._id },
                {
                  $set: {
                    'weeklyDigest.enabled': false
                  }
                }
              );
              results.updated.push(username);
            }
          } catch (error) {
            const errorMsg = `Failed to update ${user.username || user.email}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            results.errors.push(errorMsg);
            console.error(errorMsg);
          }
        }
      } catch (error) {
        console.error(`Error updating ${domain} users:`, error);
      }
    }

    // Update specific users mentioned by the user
    const specificUsers = [
      'CyberAngel27',
      'TacticalExpert8',
      'ZombieSlayerPD',
      'LandMasterPilot'
    ];

    for (const username of specificUsers) {
      try {
        // Skip if already processed
        if (processedUsernames.has(username)) {
          continue;
        }
        
        const user = await User.findOne({ username });
        if (!user) {
          results.notFound.push(username);
          continue;
        }

        const userId = user._id.toString();
        processedUserIds.add(userId);
        processedUsernames.add(username);

        if (user.weeklyDigest?.enabled === false) {
          results.alreadyDisabled.push(username);
        } else {
          await User.findOneAndUpdate(
            { username },
            {
              $set: {
                'weeklyDigest.enabled': false
              }
            }
          );
          results.updated.push(username);
        }
      } catch (error) {
        const errorMsg = `Failed to update ${username}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    const totalUpdated = results.updated.length;
    const totalAlreadyDisabled = results.alreadyDisabled.length;
    const totalNotFound = results.notFound.length;
    const totalErrors = results.errors.length;

    return res.status(totalErrors > 0 ? 207 : 200).json({
      success: totalErrors === 0,
      message: `Updated ${totalUpdated} user(s), ${totalAlreadyDisabled} already disabled, ${totalNotFound} not found${totalErrors > 0 ? `, ${totalErrors} error(s)` : ''}`,
      results: {
        updated: results.updated,
        alreadyDisabled: results.alreadyDisabled,
        notFound: results.notFound,
        ...(totalErrors > 0 && { errors: results.errors })
      },
      summary: {
        updated: totalUpdated,
        alreadyDisabled: totalAlreadyDisabled,
        notFound: totalNotFound,
        errors: totalErrors
      }
    });

  } catch (error) {
    console.error('Error disabling weekly digest for automated users:', error);
    return res.status(500).json({
      error: 'Failed to disable weekly digest for automated users',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
