import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import Question from '../../models/Question';
import Forum from '../../models/Forum';
import User from '../../models/User';
import { leaderboardCache } from '../../utils/leaderboardCache';
import {
  LeaderboardType,
  Timeframe,
  LeaderboardResponse,
  LeaderboardEntry,
} from '../../types';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Map genre names to achievement names as stored in the database
 * The detectedGenre field stores achievement names, not plain genre names
 */
const GENRE_TO_ACHIEVEMENT_MAP: Record<string, string> = {
  'RPG': 'rpgEnthusiast',
  'Action': 'actionAficionado',
  'Adventure': 'adventureAddict',
  'Strategy': 'strategySpecialist',
  'Shooter': 'shooterSpecialist',
  'Platformer': 'platformerPro',
  'Puzzle': 'puzzlePro',
  'Racing': 'racingRenegade',
  'Sports': 'sportsChampion',
  'Simulation': 'simulationSpecialist',
  'Survival': 'survivalSpecialist',
  'Battle Royale': 'battleRoyaleMaster',
  'Stealth': 'stealthExpert',
  'Horror': 'horrorHero',
  'Fighting': 'fightingFanatic',
  'Story': 'storySeeker',
  'Beat Em Up': 'beatEmUpBrawler',
  'Rhythm': 'rhythmMaster',
  'Sandbox': 'sandboxBuilder',
  'Shootem Up': 'shootemUpSniper',
  'Roguelike': 'rogueRenegade',
};

/**
 * Get achievement name from genre name
 */
function getAchievementNameFromGenre(genre: string): string {
  return GENRE_TO_ACHIEVEMENT_MAP[genre] || genre.toLowerCase().replace(/\s+/g, '');
}

/**
 * Calculate date range based on timeframe
 */
function getDateRange(timeframe: Timeframe): { start: Date | null; end: Date | null } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let start: Date | null = null;

  switch (timeframe) {
    case 'weekly':
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'allTime':
      start = null; // No start date means all time
      break;
  }

  return { start, end };
}

/**
 * Get questions leaderboard
 */
async function getQuestionsLeaderboard(
  timeframe: Timeframe,
  limit: number
): Promise<LeaderboardEntry[]> {
  const { start, end } = getDateRange(timeframe);

  const matchStage: any = {};
  if (start) {
    matchStage.timestamp = { $gte: start };
    if (end) {
      matchStage.timestamp.$lte = end;
    }
  }

  const pipeline: any[] = [{ $match: matchStage }];

  pipeline.push({
    $group: {
      _id: '$username',
      count: { $sum: 1 },
    },
  });

  pipeline.push({
    $sort: { count: -1 },
  });

  pipeline.push({
    $limit: limit,
  });

  pipeline.push({
    $project: {
      _id: 0,
      username: '$_id',
      count: 1,
    },
  });

  const results = await Question.aggregate(pipeline);

  return results.map((entry, index) => ({
    username: entry.username,
    count: entry.count,
    rank: index + 1,
    metadata: {
      questionCount: entry.count,
    },
  }));
}

/**
 * Get achievements leaderboard
 */
async function getAchievementsLeaderboard(
  timeframe: Timeframe,
  limit: number
): Promise<LeaderboardEntry[]> {
  const { start, end } = getDateRange(timeframe);

  const matchStage: any = {};
  if (start) {
    matchStage['achievements.dateEarned'] = { $gte: start };
    if (end) {
      matchStage['achievements.dateEarned'].$lte = end;
    }
  }

  // Unwind achievements array and filter by date if needed
  const pipeline: any[] = [
    {
      $unwind: '$achievements',
    },
  ];

  if (start) {
    pipeline.push({
      $match: {
        'achievements.dateEarned': {
          $gte: start,
          ...(end ? { $lte: end } : {}),
        },
      },
    });
  }

  pipeline.push({
    $group: {
      _id: '$username',
      count: { $sum: 1 },
    },
  });

  pipeline.push({
    $sort: { count: -1 },
  });

  pipeline.push({
    $limit: limit,
  });

  pipeline.push({
    $project: {
      _id: 0,
      username: '$_id',
      count: 1,
    },
  });

  const results = await User.aggregate(pipeline);

  return results.map((entry, index) => ({
    username: entry.username,
    count: entry.count,
    rank: index + 1,
    metadata: {
      achievementCount: entry.count,
    },
  }));
}

/**
 * Get forum posts leaderboard
 */
async function getForumPostsLeaderboard(
  timeframe: Timeframe,
  limit: number
): Promise<LeaderboardEntry[]> {
  const { start, end } = getDateRange(timeframe);

  // Unwind posts array
  const pipeline: any[] = [
    {
      $unwind: '$posts',
    },
  ];

  // Filter by timeframe and active status
  const matchConditions: any = {
    'posts.metadata.status': { $ne: 'deleted' }, // Exclude deleted posts
  };

  if (start) {
    matchConditions['posts.timestamp'] = { $gte: start };
    if (end) {
      matchConditions['posts.timestamp'].$lte = end;
    }
  }

  pipeline.push({
    $match: matchConditions,
  });

  pipeline.push({
    $group: {
      _id: '$posts.username',
      count: { $sum: 1 },
    },
  });

  pipeline.push({
    $sort: { count: -1 },
  });

  pipeline.push({
    $limit: limit,
  });

  pipeline.push({
    $project: {
      _id: 0,
      username: '$_id',
      count: 1,
    },
  });

  const results = await Forum.aggregate(pipeline);

  return results.map((entry, index) => ({
    username: entry.username,
    count: entry.count,
    rank: index + 1,
    metadata: {
      forumPostCount: entry.count,
    },
  }));
}

/**
 * Get top contributors (combines questions, achievements, and forum posts)
 */
async function getTopContributors(
  timeframe: Timeframe,
  limit: number
): Promise<LeaderboardEntry[]> {
  const { start, end } = getDateRange(timeframe);

  // Get questions count
  const questionsMatch: any = {};
  if (start) {
    questionsMatch.timestamp = { $gte: start };
    if (end) {
      questionsMatch.timestamp.$lte = end;
    }
  }

  const questionsPipeline: any[] = [
    { $match: questionsMatch },
    {
      $group: {
        _id: '$username',
        questionCount: { $sum: 1 },
      },
    },
  ];

  const questionsData = await Question.aggregate(questionsPipeline);
  const questionsMap = new Map(
    questionsData.map((item) => [item._id, item.questionCount])
  );

  // Get achievements count
  const achievementsPipeline: any[] = [
    { $unwind: '$achievements' },
  ];

  if (start) {
    achievementsPipeline.push({
      $match: {
        'achievements.dateEarned': {
          $gte: start,
          ...(end ? { $lte: end } : {}),
        },
      },
    });
  }

  achievementsPipeline.push({
    $group: {
      _id: '$username',
      achievementCount: { $sum: 1 },
    },
  });

  const achievementsData = await User.aggregate(achievementsPipeline);
  const achievementsMap = new Map(
    achievementsData.map((item) => [item._id, item.achievementCount])
  );

  // Get forum posts count
  const forumPostsPipeline: any[] = [
    { $unwind: '$posts' },
    {
      $match: {
        'posts.metadata.status': { $ne: 'deleted' },
        ...(start
          ? {
              'posts.timestamp': {
                $gte: start,
                ...(end ? { $lte: end } : {}),
              },
            }
          : {}),
      },
    },
    {
      $group: {
        _id: '$posts.username',
        forumPostCount: { $sum: 1 },
      },
    },
  ];

  const forumPostsData = await Forum.aggregate(forumPostsPipeline);
  const forumPostsMap = new Map(
    forumPostsData.map((item) => [item._id, item.forumPostCount])
  );

  // Combine all scores
  const combinedScores = new Map<string, LeaderboardEntry>();

  // Helper function to get or create entry with properly typed metadata
  const getOrCreateEntry = (username: string): LeaderboardEntry => {
    const existing = combinedScores.get(username);
    if (existing) {
      // Ensure metadata exists for existing entries
      if (!existing.metadata) {
        existing.metadata = {
          questionCount: 0,
          achievementCount: 0,
          forumPostCount: 0,
        };
      }
      return existing;
    }
    return {
      username,
      count: 0,
      rank: 0,
      metadata: {
        questionCount: 0,
        achievementCount: 0,
        forumPostCount: 0,
      },
    };
  };

  // Add questions
  questionsMap.forEach((count, username) => {
    const entry = getOrCreateEntry(username);
    entry.count += count;
    // getOrCreateEntry ensures metadata exists, but TypeScript needs explicit check
    if (entry.metadata) {
      entry.metadata.questionCount = count;
    }
    combinedScores.set(username, entry);
  });

  // Add achievements
  achievementsMap.forEach((count, username) => {
    const entry = getOrCreateEntry(username);
    entry.count += count;
    // getOrCreateEntry ensures metadata exists, but TypeScript needs explicit check
    if (entry.metadata) {
      entry.metadata.achievementCount = count;
    }
    combinedScores.set(username, entry);
  });

  // Add forum posts
  forumPostsMap.forEach((count, username) => {
    const entry = getOrCreateEntry(username);
    entry.count += count;
    // getOrCreateEntry ensures metadata exists, but TypeScript needs explicit check
    if (entry.metadata) {
      entry.metadata.forumPostCount = count;
    }
    combinedScores.set(username, entry);
  });

  // Sort by total count and limit
  const sortedEntries = Array.from(combinedScores.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  return sortedEntries;
}

/**
 * Get genre specialists leaderboard
 */
async function getGenreSpecialistsLeaderboard(
  genre: string,
  timeframe: Timeframe,
  limit: number
): Promise<LeaderboardEntry[]> {
  const { start, end } = getDateRange(timeframe);

  // Convert genre name to achievement name (as stored in database)
  // The database stores achievement names like "adventureAddict", not "Adventure"
  const achievementName = getAchievementNameFromGenre(genre);
  
  // detectedGenre is an array, so we need to check if the achievement name is in the array
  // Try both the mapped achievement name and the original genre (for backwards compatibility)
  const matchConditions: any[] = [
    // Exact match with achievement name (most common case)
    { detectedGenre: achievementName },
    // Also try the original genre name (for backwards compatibility)
    { detectedGenre: genre },
    // Case-insensitive match for achievement name
    {
      detectedGenre: {
        $elemMatch: {
          $regex: new RegExp(`^${achievementName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        }
      }
    },
    // Case-insensitive match for original genre name
    {
      detectedGenre: {
        $elemMatch: {
          $regex: new RegExp(`^${genre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        }
      }
    }
  ];

  const matchStage: any = {
    $and: [
      {
        $or: matchConditions
      }
    ]
  };

  // Add timestamp filter if needed
  if (start) {
    matchStage.$and.push({
      timestamp: { $gte: start, ...(end ? { $lte: end } : {}) }
    });
  }

  // Also ensure detectedGenre exists and is not empty
  matchStage.$and.push({
    detectedGenre: { $exists: true, $ne: [], $not: { $size: 0 } }
  });

  const pipeline: any[] = [
    { $match: matchStage },
    // Debug: Uncomment to see what genres are being matched
    // { $project: { username: 1, detectedGenre: 1, timestamp: 1 } },
    {
      $group: {
        _id: '$username',
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 0,
        username: '$_id',
        count: 1,
      },
    },
  ];

  const results = await Question.aggregate(pipeline);

  return results.map((entry, index) => ({
    username: entry.username,
    count: entry.count,
    rank: index + 1,
    metadata: {
      genre,
      questionCount: entry.count,
    },
  }));
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LeaderboardResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

    // Parse query parameters
    const type = (req.query.type as LeaderboardType) || 'questions';
    const timeframe = (req.query.timeframe as Timeframe) || 'weekly';
    const limit = Math.min(
      parseInt(req.query.limit as string) || DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const genre = req.query.genre as string | undefined;

    // Validate type
    const validTypes: LeaderboardType[] = [
      'questions',
      'achievements',
      'forumPosts',
      'contributors',
      'genreSpecialists',
    ];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Validate timeframe
    const validTimeframes: Timeframe[] = ['weekly', 'monthly', 'allTime'];
    if (!validTimeframes.includes(timeframe)) {
      return res.status(400).json({
        error: `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`,
      });
    }

    // Genre specialists requires genre parameter
    if (type === 'genreSpecialists' && !genre) {
      return res.status(400).json({
        error: 'Genre parameter is required for genreSpecialists leaderboard',
      });
    }

    // Check cache first
    const cacheKey = `${type}:${timeframe}${genre ? `:${genre}` : ''}:${limit}`;
    const cached = leaderboardCache.get<LeaderboardEntry[]>(
      type,
      timeframe,
      genre,
      limit
    );

    if (cached) {
      return res.status(200).json({
        type,
        timeframe,
        entries: cached,
        generatedAt: new Date(),
        cached: true,
        ...(genre ? { genre } : {}),
      });
    }

    // Fetch from database
    let entries: LeaderboardEntry[];

    switch (type) {
      case 'questions':
        entries = await getQuestionsLeaderboard(timeframe, limit);
        break;
      case 'achievements':
        entries = await getAchievementsLeaderboard(timeframe, limit);
        break;
      case 'forumPosts':
        entries = await getForumPostsLeaderboard(timeframe, limit);
        break;
      case 'contributors':
        entries = await getTopContributors(timeframe, limit);
        break;
      case 'genreSpecialists':
        if (!genre) {
          return res.status(400).json({
            error: 'Genre parameter is required',
          });
        }
        entries = await getGenreSpecialistsLeaderboard(genre, timeframe, limit);
        break;
      default:
        return res.status(400).json({ error: 'Invalid leaderboard type' });
    }

    // Cache the results
    leaderboardCache.set(type, timeframe, entries, CACHE_TTL_SECONDS, genre, limit);

    // Return response
    const response: LeaderboardResponse = {
      type,
      timeframe,
      entries,
      generatedAt: new Date(),
      cached: false,
      ...(genre ? { genre } : {}),
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Error fetching leaderboard:', error);
    return res.status(500).json({
      error: 'Failed to fetch leaderboard',
      ...(process.env.NODE_ENV === 'development' ? { details: error.message } : {}),
    });
  }
}

export default withDatabase(handler);
