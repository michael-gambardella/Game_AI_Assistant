import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { hashPassword } from '../../../utils/passwordUtils';
import crypto from 'crypto';
import commonGamersData from '../../../data/gamers/common-gamers.json';
import expertGamersData from '../../../data/gamers/expert-gamers.json';

/**
 * Generate a secure random password for automated users
 */
const generateSecurePassword = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Create automated gamer account with Pro access and gamer profile
 */
const createGamerUser = async (
  gamerData: any,
  gamerType: 'common' | 'expert'
) => {
  const password = generateSecurePassword();
  const hashedPassword = await hashPassword(password);
  
  const userId = `auto-${gamerData.username.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  // Build game history from favorite games
  const gameHistory = gamerData.favoriteGames.map((game: any) => ({
    gameTitle: game.gameTitle,
    totalHours: game.hoursPlayed,
    completion: game.genre === 'Metroidvania' ? 40 : 50, // Default completion percentage
    achievements: game.achievements?.length || 0,
    notes: gamerType === 'common' 
      ? `Struggling with: ${game.currentStruggles?.join(', ') || 'general gameplay'}`
      : `Expertise: ${game.expertise?.join(', ') || 'general mastery'}`
  }));

  const user = new User({
    userId,
    email: gamerData.email,
    username: gamerData.username,
    password: hashedPassword,
    conversationCount: 0,
    hasProAccess: true, // Grant Pro access
    requiresPasswordSetup: false,
    achievements: [],
    weeklyDigest: {
      enabled: false // Disable weekly digest emails for automated users (emails don't exist)
    },
    progress: {
      firstQuestion: 0,
      frequentAsker: 0,
      rpgEnthusiast: 0,
      bossBuster: 0,
      platformerPro: 0,
      survivalSpecialist: 0,
      strategySpecialist: 0,
      actionAficionado: 0,
      fightingFanatic: 0,
      simulationSpecialist: 0,
      battleRoyaleMaster: 0,
      sportsChampion: 0,
      adventureAddict: 0,
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
    },
    subscription: {
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: oneYearFromNow,
      cancelAtPeriodEnd: false,
      billingCycle: 'monthly',
      currency: 'usd',
      earlyAccessGranted: false
    },
    gamerProfile: {
      type: gamerType,
      skillLevel: gamerData.skillLevel,
      favoriteGames: gamerData.favoriteGames.map((game: any) => ({
        gameTitle: game.gameTitle,
        genre: game.genre,
        hoursPlayed: game.hoursPlayed,
        achievements: game.achievements || [],
        ...(gamerType === 'common' 
          ? { currentStruggles: game.currentStruggles || [] }
          : { expertise: game.expertise || [] }
        )
      })),
      gameHistory,
      personality: {
        traits: gamerData.personality.traits,
        communicationStyle: gamerData.personality.communicationStyle
      },
      ...(gamerType === 'expert' && gamerData.helpsCommonGamer
        ? { helpsCommonGamer: gamerData.helpsCommonGamer }
        : {}
      )
    }
  });

  await user.save();
  
  // Return user without password
  const { password: _, ...userResponse } = user.toObject();
  return userResponse;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Connect to database

    const createdUsers: any = {
      common: {},
      expert: {}
    };
    const errors: string[] = [];

    // Create COMMON gamers
    for (const commonGamer of commonGamersData.commonGamers) {
      try {
        // Check if user already exists
        const existing = await User.findOne({ username: commonGamer.username });
        
        if (existing) {
          createdUsers.common[commonGamer.username] = {
            userId: existing.userId,
            username: existing.username,
            email: existing.email,
            hasProAccess: existing.hasProAccess,
            message: 'User already exists'
          };
        } else {
          const user = await createGamerUser(commonGamer, 'common');
          createdUsers.common[commonGamer.username] = {
            userId: user.userId,
            username: user.username,
            email: user.email,
            hasProAccess: user.hasProAccess,
            skillLevel: user.gamerProfile?.skillLevel,
            message: 'Created successfully'
          };
        }
      } catch (error) {
        const errorMsg = `Failed to create ${commonGamer.username}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
        createdUsers.common[commonGamer.username] = {
          error: errorMsg
        };
      }
    }

    // Create EXPERT gamers
    for (const expertGamer of expertGamersData.expertGamers) {
      try {
        // Check if user already exists
        const existing = await User.findOne({ username: expertGamer.username });
        
        if (existing) {
          createdUsers.expert[expertGamer.username] = {
            userId: existing.userId,
            username: existing.username,
            email: existing.email,
            hasProAccess: existing.hasProAccess,
            message: 'User already exists'
          };
        } else {
          const user = await createGamerUser(expertGamer, 'expert');
          createdUsers.expert[expertGamer.username] = {
            userId: user.userId,
            username: user.username,
            email: user.email,
            hasProAccess: user.hasProAccess,
            skillLevel: user.gamerProfile?.skillLevel,
            helpsCommonGamer: user.gamerProfile?.helpsCommonGamer,
            message: 'Created successfully'
          };
        }
      } catch (error) {
        const errorMsg = `Failed to create ${expertGamer.username}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg);
        createdUsers.expert[expertGamer.username] = {
          error: errorMsg
        };
      }
    }

    const successCount = 
      Object.values(createdUsers.common).filter((u: any) => !u.error).length +
      Object.values(createdUsers.expert).filter((u: any) => !u.error).length;

    return res.status(errors.length > 0 ? 207 : 201).json({
      message: errors.length > 0 
        ? `Created ${successCount} gamers with ${errors.length} errors`
        : 'All gamers created successfully',
      users: createdUsers,
      ...(errors.length > 0 && { errors })
    });

  } catch (error) {
    console.error('Error creating gamers:', error);
    return res.status(500).json({
      error: 'Failed to create gamers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
