import User from '../models/User';
import Forum from '../models/Forum';
import Question from '../models/Question';
import { fetchRecommendations } from './aiHelper';
import { Achievement } from '../types';

/**
 * Helper function to add timeout to promises
 * Prevents API calls from hanging indefinitely
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Get achievements for weekly digest
 * - First email: returns all current achievements
 * - Subsequent emails: returns only achievements earned in the past week
 * @param username - Username to get achievements for
 * @param isFirstEmail - Whether this is the first weekly digest email
 * @param userData - Optional pre-fetched user data to avoid duplicate queries
 */
export async function getWeeklyAchievements(
  username: string,
  isFirstEmail: boolean,
  userData?: any
): Promise<Array<{ name: string; dateEarned: Date }>> {
  try {
    // Use pre-fetched user data if available, otherwise fetch
    const user = userData || await User.findOne({ username }).select('achievements').lean();
    if (!user || !user.achievements || user.achievements.length === 0) {
      return [];
    }

    if (isFirstEmail) {
      // First email: return all achievements
      return user.achievements.map((ach: Achievement) => ({
        name: ach.name,
        dateEarned: ach.dateEarned
      }));
    } else {
      // Subsequent emails: only return achievements from the past week
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      return user.achievements
        .filter((ach: Achievement) => new Date(ach.dateEarned) >= oneWeekAgo)
        .map((ach: Achievement) => ({
          name: ach.name,
          dateEarned: ach.dateEarned
        }));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Weekly Digest] Error getting achievements for user', {
      username,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      operation: 'get-weekly-achievements'
    });
    return [];
  }
}

/**
 * Get forum activity for the past week
 * Returns posts created by the user in the past 7 days
 * Optimized query with better index usage
 */
export async function getWeeklyForumActivity(
  username: string
): Promise<Array<{
  forumTitle: string;
  gameTitle: string;
  message: string;
  timestamp: Date;
  likes: number;
}>> {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Optimized query: Use $elemMatch for nested array queries and better index usage
    // This query structure works better with MongoDB's indexing capabilities
    const forums = await Forum.find({
      $or: [
        { isPrivate: false },
        { allowedUsers: username }
      ],
      'metadata.status': 'active',
      posts: {
        $elemMatch: {
          username: username,
          timestamp: { $gte: oneWeekAgo },
          'metadata.status': 'active'
        }
      }
    })
      .select('title gameTitle posts')
      .lean();

    const activities: Array<{
      forumTitle: string;
      gameTitle: string;
      message: string;
      timestamp: Date;
      likes: number;
    }> = [];

    for (const forum of forums) {
      if (!forum.posts || !Array.isArray(forum.posts)) continue;

      const userPosts = forum.posts.filter((post: any) => {
        const postDate = new Date(post.timestamp);
        return (
          post.username === username &&
          postDate >= oneWeekAgo &&
          post.metadata?.status === 'active'
        );
      });

      for (const post of userPosts) {
        activities.push({
          forumTitle: forum.title || 'Untitled Forum',
          gameTitle: forum.gameTitle || 'Unknown Game',
          message: post.message || '',
          timestamp: new Date(post.timestamp),
          likes: post.metadata?.likes || 0
        });
      }
    }

    // Sort by timestamp (most recent first)
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Limit to top 10 most recent activities
    return activities.slice(0, 10);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Weekly Digest] Error getting forum activity for user', {
      username,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      operation: 'get-weekly-forum-activity'
    });
    return [];
  }
}

/**
 * Get game recommendations for the weekly digest
 * Prioritizes weekly activity (forum posts, questions, achievements) and uses
 * the 5 most recent questions as fallback when weekly activity is sparse
 * @param prefetchedForumActivity - Optional pre-fetched forum activity to avoid a duplicate DB query
 */
export async function getWeeklyGameRecommendations(
  username: string,
  prefetchedForumActivity?: Awaited<ReturnType<typeof getWeeklyForumActivity>>
): Promise<string[]> {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Step 1: Use pre-fetched forum activity if provided, otherwise fetch it
    const weeklyForumActivity = prefetchedForumActivity ?? await getWeeklyForumActivity(username);

    // Step 2: Get weekly questions (past 7 days) and recent questions in parallel
    // This reduces sequential queries
    const [weeklyQuestionsRaw, recentQuestionsRaw, userDoc] = await Promise.all([
      Question.find({
        username,
        timestamp: { $gte: oneWeekAgo }
      })
        .sort({ timestamp: -1 })
        .select('detectedGame detectedGenre question timestamp')
        .lean(),
      Question.find({ username })
        .sort({ timestamp: -1 })
        .limit(5)
        .select('detectedGame detectedGenre question timestamp')
        .lean(),
      User.findOne({ username }).select('weeklyDigest progress').lean()
    ]);

    const weeklyQuestions = weeklyQuestionsRaw
      .filter((q: any) => q && q.timestamp)
      .map((q: any) => ({
        detectedGame: q.detectedGame || undefined,
        detectedGenre: Array.isArray(q.detectedGenre) ? q.detectedGenre : undefined,
        question: q.question || undefined,
        timestamp: new Date(q.timestamp)
      }));

    // Step 3: Get weekly achievements (using pre-fetched user data if available)
    const weeklyAchievements = await getWeeklyAchievements(username, false, userDoc);

    // Step 4: Process recent questions (already fetched above)
    const recentQuestions = recentQuestionsRaw
      .filter((q: any) => q && q.timestamp)
      .map((q: any) => ({
        detectedGame: q.detectedGame || undefined,
        detectedGenre: Array.isArray(q.detectedGenre) ? q.detectedGenre : undefined,
        question: q.question || undefined,
        timestamp: new Date(q.timestamp)
      }));

    // Step 5: Extract games and genres from weekly activity
    const weeklyGames = new Set<string>();
    const weeklyGenreCounts: { [key: string]: number } = {};

    // From weekly forum posts
    for (const activity of weeklyForumActivity) {
      if (activity.gameTitle) {
        weeklyGames.add(activity.gameTitle);
      }
    }

    // From weekly questions
    for (const q of weeklyQuestions) {
      if (q.detectedGame) {
        weeklyGames.add(q.detectedGame);
      }
      if (q.detectedGenre && Array.isArray(q.detectedGenre)) {
        for (const genre of q.detectedGenre) {
          weeklyGenreCounts[genre] = (weeklyGenreCounts[genre] || 0) + 1;
        }
      }
    }

    // Step 6: Map genre names to standardized genre names
    const normalizeGenre = (genre: string): string => {
      const genreLower = genre.toLowerCase();

      // Map specific genre variations to standard names
      const genreMap: { [key: string]: string } = {
        // Shooter variations
        'third person shooter': 'Shooter',
        'third-person shooter': 'Shooter',
        'first person shooter': 'Shooter',
        'first-person shooter': 'Shooter',
        'fps': 'Shooter',
        'tps': 'Shooter',
        'shoot em up': 'Shooter',
        'shoot-em-up': 'Shooter',
        'run-and-gun': 'Shooter',
        'run and gun': 'Shooter',

        // Action variations
        'action-adventure': 'Action',
        'action adventure': 'Action',
        'action rpg': 'Action',
        'action-rpg': 'Action',

        // RPG variations
        'role-playing': 'RPG',
        'role playing': 'RPG',
        'jrpg': 'RPG',
        'wrpg': 'RPG',
        'mmorpg': "MMORPG",

        // Platformer variations
        'platform': 'Platformer',
        'platform game': 'Platformer',
        'puzzle-platformer': 'Puzzle-Platformer',

        // Other variations
        'puzzle game': 'Puzzle',
        'racing game': 'Racing',
        'fighting game': 'Fighting',
        'sports game': 'Sports',
        'horror game': 'Horror',
        'stealth game': 'Stealth',
        'simulation game': 'Simulation',
        'survival game': 'Survival',
        'battle royale': 'Battle Royale',
        'moba': 'Multiplayer Online Battle Arena',
      };

      // Check exact match first
      if (genreMap[genreLower]) {
        return genreMap[genreLower];
      }

      // Check if genre contains any of the mapped terms
      for (const [key, value] of Object.entries(genreMap)) {
        if (genreLower.includes(key)) {
          return value;
        }
      }

      // Capitalize first letter of each word for standard genres
      return genre.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    // Map achievement names to genre names
    const achievementToGenreMap: { [key: string]: string } = {
      'actionAficionado': 'Action',
      'adventureAddict': 'Adventure',
      'rpgEnthusiast': 'RPG',
      'platformerPro': 'Platformer',
      'strategySpecialist': 'Strategy',
      'shooterSpecialist': 'Shooter',
      'puzzlePro': 'Puzzle',
      'racingRenegade': 'Racing',
      'racing': 'Racing',
      'fightingFanatic': 'Fighting',
      'sportsChampion': 'Sports',
      'horrorHero': 'Horror',
      'stealthExpert': 'Stealth',
      'simulationSpecialist': 'Simulation',
      'survivalSpecialist': 'Survival',
      'sandboxBuilder': 'Simulation',
      'shootemUpSniper': 'Shooter',
      'rogueRenegade': 'Roguelike',
      'bossBuster': 'Action',
      'rhythmMaster': 'Rhythm',
    };

    // Normalize and count genres from weekly activity
    const normalizedGenreCounts: { [key: string]: number } = {};
    for (const [genre, count] of Object.entries(weeklyGenreCounts)) {
      const normalized = normalizeGenre(genre);
      normalizedGenreCounts[normalized] = (normalizedGenreCounts[normalized] || 0) + count;
    }

    // Extract genres from weekly achievements
    for (const achievement of weeklyAchievements) {
      const achievementName = achievement.name;
      const genre = achievementToGenreMap[achievementName];
      if (genre) {
        normalizedGenreCounts[genre] = (normalizedGenreCounts[genre] || 0) + 1;
      }
    }

    // Step 7: Determine if we have enough weekly activity
    const hasForumActivity = weeklyForumActivity.length > 0;
    const hasWeeklyQuestions = weeklyQuestions.length > 0;
    const hasEnoughGenres = Object.keys(normalizedGenreCounts).length >= 2;

    // If weekly activity is sparse, use the 5 most recent questions
    const useRecentQuestions = !hasForumActivity &&
      (!hasWeeklyQuestions || weeklyQuestions.length < 3) &&
      (!hasEnoughGenres || weeklyAchievements.length < 2);

    // Step 8: Extract data from the appropriate source
    let sourceGames = new Set<string>(weeklyGames);
    let sourceGenreCounts: { [key: string]: number } = { ...normalizedGenreCounts };

    if (useRecentQuestions) {
      // Use 5 most recent questions
      console.log(`[Weekly Digest] Using 5 most recent questions for ${username} (insufficient weekly activity)`);
      for (const q of recentQuestions) {
        if (q.detectedGame) {
          sourceGames.add(q.detectedGame);
        }
        if (q.detectedGenre && Array.isArray(q.detectedGenre)) {
          for (const genre of q.detectedGenre) {
            const normalized = normalizeGenre(genre);
            sourceGenreCounts[normalized] = (sourceGenreCounts[normalized] || 0) + 1;
          }
        }
      }
    } else if (!hasEnoughGenres && recentQuestions.length > 0) {
      // Supplement with recent questions if we don't have enough genres
      console.log(`[Weekly Digest] Supplementing weekly activity with recent questions for ${username}`);
      for (const q of recentQuestions) {
        if (q.detectedGame) {
          sourceGames.add(q.detectedGame);
        }
        if (q.detectedGenre && Array.isArray(q.detectedGenre)) {
          for (const genre of q.detectedGenre) {
            const normalized = normalizeGenre(genre);
            sourceGenreCounts[normalized] = (sourceGenreCounts[normalized] || 0) + 0.5; // Lower weight for supplement
          }
        }
      }
    }

    // Step 9: Determine primary genres with variety mechanism
    const sortedGenres = Object.entries(sourceGenreCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([genre]) => genre);

    // Get previously recommended games to identify genre patterns
    const userForGenreAnalysis = Array.isArray(userDoc) ? null : userDoc;
    const previouslyRecommendedGames = (userForGenreAnalysis as any)?.weeklyDigest?.previouslyRecommendedGames || [];

    // Analyze genre patterns from previously recommended games
    // This helps us avoid recommending the same genres repeatedly
    const allAvailableGenres = [
      'Action-Adventure', 'RPG', 'Action', 'Adventure', 'Shooter', 'Platformer',
      'Puzzle', 'Racing', 'Fighting', 'Sports', 'Horror', 'Stealth',
      'Simulation', 'Survival', 'Strategy', 'MOBA', 'Battle Royale', 'MMORPG',
      'Rhythm', 'Sandbox', 'Shoot em Up', 'Visual Novel', 'Beat Em Up', 'Trivia', 'Roguelike'
    ];

    // Track genre usage patterns to ensure variety
    // If user has many previously recommended games, we should prioritize less-used genres
    const recentGenrePattern: { [key: string]: number } = {};

    // Initialize all genres to 0
    allAvailableGenres.forEach(genre => {
      recentGenrePattern[genre] = 0;
    });

    // Count genre usage: if user has many recommendations, assume common genres were overused
    // This is a heuristic since we don't store genre info with recommended games
    if (previouslyRecommendedGames.length > 0) {
      // Heuristic: If user has 10+ previously recommended games, 
      // assume common genres (Action, Shooter, Action-Adventure) were likely overused
      const hasManyRecommendations = previouslyRecommendedGames.length >= 10;

      if (hasManyRecommendations) {
        // Deprioritize commonly overused genres
        const commonlyOverusedGenres = ['Action', 'Shooter', 'Action-Adventure'];
        commonlyOverusedGenres.forEach(genre => {
          if (recentGenrePattern.hasOwnProperty(genre)) {
            recentGenrePattern[genre] += 2; // Higher number = more overused
          }
        });
      }

      // Also deprioritize genres that match user's top activity genres
      // (since those are likely already well-represented)
      sortedGenres.slice(0, 3).forEach(genre => {
        if (recentGenrePattern.hasOwnProperty(genre)) {
          recentGenrePattern[genre] += 1;
        }
      });
    }

    let primaryGenres: string[] = [];
    if (sortedGenres.length > 0) {
      // Enhanced variety: Mix top genres with less-used genres
      // Take top 1-2 genres from activity, then add 2-3 diverse genres
      const topGenres = sortedGenres.slice(0, 2);

      // Create a pool of diverse genres (excluding top genres)
      // Prioritize genres that haven't been overused recently
      const diverseGenres = allAvailableGenres.filter(
        genre => !topGenres.includes(genre) &&
          !sortedGenres.slice(0, 5).includes(genre) // Exclude top 5 to ensure variety
      );

      // Sort diverse genres by usage pattern (lower = less used = more variety)
      // This ensures we prioritize genres that haven't been recommended recently
      const sortedDiverse = diverseGenres.sort((a, b) => {
        const usageA = recentGenrePattern[a] || 0;
        const usageB = recentGenrePattern[b] || 0;
        if (usageA !== usageB) {
          return usageA - usageB; // Lower usage first
        }
        // If usage is equal, randomize for variety
        return Math.random() - 0.5;
      });

      // Take 2-3 least-used diverse genres for maximum variety
      const selectedDiverse = sortedDiverse.slice(0, 3);

      // Combine: 1-2 from activity + 2-3 diverse = 3-5 total genres
      // This ensures variety even if user always asks about same genres
      primaryGenres = [...topGenres, ...selectedDiverse].slice(0, 5);

      console.log(`[Weekly Digest] Genre selection for ${username}:`, {
        topGenresFromActivity: topGenres,
        diverseGenresAdded: selectedDiverse,
        finalPrimaryGenres: primaryGenres,
        totalGenresInActivity: sortedGenres.length
      });
    } else {
      // Final fallback: try to infer from user progress (use pre-fetched user data)
      // Type guard: ensure userDoc is a single object, not an array
      const user = Array.isArray(userDoc) ? null : userDoc;
      if (user?.progress) {
        const progress = user.progress;
        const progressGenreCounts: { [key: string]: number } = {
          'RPG': progress.rpgEnthusiast || 0,
          'Action': progress.actionAficionado || 0,
          'Adventure': progress.adventureAddict || 0,
          'Strategy': progress.strategySpecialist || 0,
          'Racing': progress.racingRenegade || 0,
          'Shooter': progress.shooterSpecialist || 0,
          'Platformer': progress.platformerPro || 0,
          'Puzzle': progress.puzzlePro || 0,
          'Fighting': progress.fightingFanatic || 0,
          'Sports': progress.sportsChampion || 0,
          'Horror': progress.horrorHero || 0,
          'Stealth': progress.stealthExpert || 0,
          'Simulation': progress.simulationSpecialist || 0,
          'Survival': progress.survivalSpecialist || 0,
          'Rhythm': progress.rhythmMaster || 0,
          'Sandbox': progress.sandboxBuilder || 0,
          'Shoot em Up': progress.shootemUpSniper || 0,
          'Roguelike': progress.rogueRenegade || 0,
          'Battle Royale': progress.battleRoyaleMaster || 0,
          'Story': progress.storySeeker || 0,
          'Beat Em Up': progress.beatEmUpBrawler || 0,
          'Trivia': progress.triviaMaster || 0,
        };
        const topProgressGenre = Object.entries(progressGenreCounts)
          .sort(([, a], [, b]) => b - a)
          .find(([, count]) => count > 0);
        if (topProgressGenre) {
          primaryGenres = [topProgressGenre[0]];
        }
      }

      // Absolute fallback: rotate through a diverse genre pool weekly per user
      // This ensures different game recommendations each week instead of always the same genres
      if (primaryGenres.length === 0) {
        const allFallbackGenres = [
          'Action-Adventure', 'RPG', 'Action', 'Adventure', 'Shooter',
          'Platformer', 'Puzzle', 'Fighting', 'Sports', 'Horror', 'Stealth', 'Simulation',
          'Survival', 'Rhythm', 'Sandbox', 'Shoot em Up', 'Battle Royale',
          'Visual Novel', 'Beat Em Up', 'Trivia', 'MOBA', 'MMORPG', 'Roguelike'
        ];
        // Rotate start position based on current week + username so different genres are tried each week
        const wn = Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7));
        const uh = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const offset = (wn * 3 + uh) % allFallbackGenres.length;
        const rotated = [...allFallbackGenres.slice(offset), ...allFallbackGenres.slice(0, offset)];
        primaryGenres = rotated.slice(0, 6);
      }
    }

    // Step 10: Helper function to extract base game series name for duplicate checking
    // 
    // ⚠️ IMPORTANT: This function is ONLY used for duplicate checking within a single email.
    // The FULL game name (e.g., "Final Fantasy IX", "Super Mario Galaxy 2") is ALWAYS shown in the email.
    // This function extracts the series name to check: "Have we already recommended a game from this series?"
    // 
    // Example: If "Final Fantasy IX" is recommended, we extract "Final Fantasy" to check if we've
    // already recommended a game from that series. If "Final Fantasy VII" comes up next, we skip it
    // because "Final Fantasy" is already in seenSeries. But the email shows "Final Fantasy IX", not "Final Fantasy".
    // 
    // Rules:
    // 1. Games with colons containing "Episode" → extract base name (e.g., "Half-Life 2: Episode One" → "Half-Life 2")
    // 2. Games with colons (no Episode) → extract base name (e.g., "The Legend of Zelda: Breath of the Wild" → "The Legend of Zelda")
    // 3. Games without colons → remove trailing numbers/Roman numerals to get base series (e.g., "Super Mario Galaxy 2" → "Super Mario Galaxy")
    // 4. Handle "and the" pattern (e.g., "Ori and the Will of the Wisps" → "Ori")
    // 5. Remove edition names (Remastered, Definitive Edition, etc.)
    //
    // Examples:
    // - "Super Mario Galaxy" → "Super Mario Galaxy" (no number to remove)
    // - "Super Mario Galaxy 2" → "Super Mario Galaxy" (remove trailing number - 3 words, same series, won't appear together)
    // - "Final Fantasy IX" → "Final Fantasy" (remove Roman numeral)
    // - "Final Fantasy VII" → "Final Fantasy" (remove Roman numeral - same series, won't appear together)
    // - "Half-Life 2: Episode One" → "Half-Life 2" (extract because Episode, keep number)
    // - "Half-Life 2" → "Half-Life 2" (keep number - 2 words, matches with Episode games, same series)
    // - "The Legend of Zelda: Breath of the Wild" → "The Legend of Zelda" (extract because colon)
    // - "The Legend of Zelda: Ocarina of Time" → "The Legend of Zelda" (same series)
    // - "Ori and the Will of the Wisps" → "Ori" (extract "and the" pattern)
    // - "Ori and the Blind Forest" → "Ori" (same series)
    // Note: Games in the same series won't appear together in the same email, but can appear in different weeks
    const extractSeriesName = (gameName: string): string => {
      let series = gameName
        .replace(/\s*\([^)]*\)/g, '') // Remove parenthetical content (years, subtitles)
        .replace(/\s*Game\s+of\s+the\s+Year\s+Edition/gi, '')
        .replace(/\s*Remastered/gi, '')
        .replace(/\s*Remaster/gi, '')
        .replace(/\s*Definitive\s+Edition/gi, '')
        .replace(/\s*Enhanced\s+Edition/gi, '')
        .replace(/\s*Ultimate\s+Edition/gi, '')
        .replace(/\s*Deluxe\s+Edition/gi, '')
        .replace(/\s*Complete\s+Edition/gi, '')
        .trim();

      // Handle "and the [subtitle]" pattern: extract series name before " and the "
      // Examples: "Ori and the Will of the Wisps" -> "Ori", "Ori and the Blind Forest" -> "Ori"
      const andThePattern = /\s+and\s+the\s+/i;
      if (andThePattern.test(series)) {
        const match = series.match(/^(.+?)\s+and\s+the\s+/i);
        if (match && match[1]) {
          series = match[1].trim();
        }
      }

      // Handle colons: check if it contains "Episode" or is a regular subtitle
      const colonIndex = series.indexOf(':');
      let hadColonWithEpisode = false;
      if (colonIndex > 0) {
        const afterColon = series.substring(colonIndex + 1).trim();
        const hasEpisode = /\bepisode\b/i.test(afterColon);

        if (hasEpisode) {
          // Game has "Episode" in the colon content - extract base name (e.g., "Half-Life 2: Episode One" → "Half-Life 2")
          // Keep the number because episodes are part of a numbered game
          series = series.substring(0, colonIndex).trim();
          hadColonWithEpisode = true; // Mark that we should keep the number
        } else {
          // Regular colon subtitle - extract base name (e.g., "The Legend of Zelda: Breath of the Wild" → "The Legend of Zelda")
          series = series.substring(0, colonIndex).trim();
        }
      }

      // For games without colons, or after extracting colon content:
      // Remove trailing numbers and Roman numerals to get the base series name
      // This ensures games in the same series (e.g., "Super Mario Galaxy" and "Super Mario Galaxy 2")
      // are treated as the same series and won't appear together in the same email
      // Exception: If the game had a colon with "Episode", keep the number (already extracted above)
      if (!hadColonWithEpisode) {
        // Strip "Part N" or "Part [Roman numeral]" suffix first
        // e.g., "The Last of Us Part II" → "The Last of Us", "Half Life 2 Part 1" → "Half Life 2"
        const withoutPart = series.replace(/\s+Part\s+[IVXLCDM\d]+$/i, '').trim();
        if (withoutPart.length > 0) {
          series = withoutPart;
        }

        // Always remove trailing numbers to treat sequels as the same series
        // e.g., "Portal 2" → "Portal", "Halo 3" → "Halo", "Forza Horizon 5" → "Forza Horizon"
        // This prevents same-series games from appearing in the same email
        const withoutNumber = series.replace(/\s+\d+$/, '').trim();
        if (withoutNumber.length > 0) {
          series = withoutNumber;
        }

        // Remove trailing Roman numerals
        // e.g., "Final Fantasy IX" → "Final Fantasy", "Resident Evil VII" → "Resident Evil"
        const withoutRoman = series.replace(/\s+[IVXLCDM]+$/i, '').trim();
        if (withoutRoman.length > 0) {
          series = withoutRoman;
        }
      }
      // If it had a colon with Episode, we keep the number (e.g., "Half-Life 2: Episode One" → "Half-Life 2")
      // This allows "Half-Life 2" (base game, 2 words, keeps number) to match with "Half-Life 2: Episode One"

      let result = series.trim();
      result = result.replace(/\s+/g, ' '); // Multiple spaces to single space
      result = result.replace(/\s*-\s*/g, '-'); // Normalize hyphens

      return result || gameName; // Fallback to original if empty
    };

    // Checks whether a series is excluded, using prefix matching to handle cases where
    // extractSeriesName produces different-length strings for the same franchise.
    // Example: "Half-Life 2" → "half-life" (trailing number stripped), but
    // "Half-Life 2: Episode Two" → "half-life 2" (number kept due to Episode rule).
    // Without prefix matching, "half-life" !== "half-life 2" and both slip through.
    // Prefix matching only activates when the shorter name has 2+ word-parts (split on
    // space or hyphen), preventing single-word series like "halo" from matching "halo wars".
    const isSeriesExcluded = (seriesLower: string, seen: Set<string>): boolean => {
      if (seen.has(seriesLower)) return true;
      for (const s of seen) {
        const shorter = s.length <= seriesLower.length ? s : seriesLower;
        const longer  = s.length <= seriesLower.length ? seriesLower : s;
        const parts = shorter.split(/[\s-]+/).filter(Boolean);
        if (parts.length >= 2 && longer.startsWith(shorter + ' ')) return true;
      }
      return false;
    };

    // Step 11: Get all games user has asked about (for exclusion)
    // Optimize: Only fetch detectedGame field, and use lean() for better performance
    const allUserQuestions = await Question.find({ username })
      .select('detectedGame')
      .lean();
    const gamesAskedAbout = new Set<string>();
    for (const q of allUserQuestions) {
      if ((q as any).detectedGame && typeof (q as any).detectedGame === 'string') {
        // Normalize: lowercase and trim for consistent comparison
        gamesAskedAbout.add((q as any).detectedGame.toLowerCase().trim());
      }
    }

    // Step 11b: Get previously recommended games (to avoid repeats)
    // Use pre-fetched userDoc if available
    const previouslyRecommended = new Set<string>();
    const previouslyRecommendedSeries = new Set<string>(); // Track series from previously recommended games
    // Type guard: ensure userDoc is a single object, not an array
    const userForRecommendations = Array.isArray(userDoc) ? null : userDoc;
    if (userForRecommendations && (userForRecommendations as any).weeklyDigest?.previouslyRecommendedGames) {
      // Limit to last 25 games to prevent the list from growing too large
      const recentRecommendations = (userForRecommendations as any).weeklyDigest.previouslyRecommendedGames.slice(-25);
      for (const game of recentRecommendations) {
        if (game && typeof game === 'string') {
          const gameLower = game.toLowerCase().trim();
          previouslyRecommended.add(gameLower);
          // Also track the series name to prevent recommending games from the same series
          const series = extractSeriesName(game);
          previouslyRecommendedSeries.add(series.toLowerCase().trim());
        }
      }
      console.log(`[Weekly Digest] Loaded ${previouslyRecommended.size} previously recommended games for ${username}:`, Array.from(previouslyRecommended).slice(0, 5));
      console.log(`[Weekly Digest] Loaded ${previouslyRecommendedSeries.size} previously recommended series for ${username}:`, Array.from(previouslyRecommendedSeries).slice(0, 5));
    } else {
      console.log(`[Weekly Digest] No previously recommended games found for ${username}`);
    }

    // Step 12: Fetch recommendations for each primary genre IN PARALLEL
    const allRecommendations: string[] = [];
    // Combine exclusion sets: games asked about + previously recommended
    const seenGames = new Set<string>();
    gamesAskedAbout.forEach(game => seenGames.add(game));
    previouslyRecommended.forEach(game => seenGames.add(game));
    const seenSeries = new Set<string>(); // Series already in this email
    // Also exclude series from previously recommended games
    previouslyRecommendedSeries.forEach(series => seenSeries.add(series));

    // Log exclusion summary for debugging with detailed breakdown
    const sampleAskedAbout = Array.from(gamesAskedAbout).slice(0, 3);
    const samplePreviouslyRecommended = Array.from(previouslyRecommended).slice(0, 3);
    console.log(`[Weekly Digest] Exclusion summary for ${username}:`, {
      gamesAskedAbout: gamesAskedAbout.size,
      previouslyRecommended: previouslyRecommended.size,
      previouslyRecommendedSeries: previouslyRecommendedSeries.size,
      totalExcludedGames: seenGames.size,
      totalExcludedSeries: seenSeries.size,
      sampleAskedAbout,
      samplePreviouslyRecommended,
      sampleExcludedSeries: Array.from(previouslyRecommendedSeries).slice(0, 3)
    });

    // Get recommendations for each genre with enhanced randomization
    const weekNumber = Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7));
    // Add extra randomization factor based on username hash for more variation
    const usernameHash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const randomSeed = (weekNumber * 7 + usernameHash) % 1000; // Creates variation per user per week

    // OPTIMIZATION: Fetch all genres in parallel instead of sequentially
    // This reduces total time from (15s * N genres) to (15s max for all genres)
    const genreFetchStartTime = Date.now();
    console.log(`[Weekly Digest] Fetching recommendations for ${primaryGenres.length} genres in parallel for ${username}...`);

    const genreFetchPromises = primaryGenres.map(async (genre, i) => {
      const genreStartTime = Date.now();
      try {
        // Wrap fetchRecommendations with timeout (15 seconds per genre)
        const genreRecs = await withTimeout(
          fetchRecommendations(genre, {
            currentPopular: true
          }),
          15000, // 15 seconds timeout for RAWG API call
          `Fetch recommendations for genre ${genre}`
        );

        // Filter out games user has already asked about or previously recommended
        // Also filter out games from series that were previously recommended
        // Normalize game names (trim whitespace, lowercase) for consistent comparison
        const filteredRecs = genreRecs.filter(game => {
          const gameLower = game.toLowerCase().trim();
          const series = extractSeriesName(game);
          const seriesLower = series.toLowerCase().trim();

          // Check if game is excluded
          const isExcludedGame = seenGames.has(gameLower);
          const isExcludedSeries = isSeriesExcluded(seriesLower, seenSeries);

          if (isExcludedGame) {
            const reason = gamesAskedAbout.has(gameLower) ? 'user asked about it' : 'previously recommended';
            console.log(`[Weekly Digest] Filtered out "${game}" - ${reason}`);
          } else if (isExcludedSeries) {
            console.log(`[Weekly Digest] Filtered out "${game}" - series "${series}" was previously recommended (e.g., "${Array.from(previouslyRecommended).find(g => extractSeriesName(g).toLowerCase() === seriesLower)}")`);
          }

          return !isExcludedGame && !isExcludedSeries;
        });

        // Enhanced variation: combine week number, genre index, and random seed
        // Increased rotation offset for more variety
        const rotationMultiplier = 3; // Rotate by 3x the week number for more variation
        const baseOffset = (weekNumber * rotationMultiplier + i * 2 + randomSeed) % Math.max(1, filteredRecs.length);

        // Add additional randomization: shuffle a portion of the list
        const shuffleSize = Math.min(10, Math.floor(filteredRecs.length * 0.3)); // Shuffle top 30% or 10 games, whichever is smaller
        const shuffledPortion = [...filteredRecs.slice(0, shuffleSize)].sort(() => Math.random() - 0.5);
        const restOfList = filteredRecs.slice(shuffleSize);

        // Combine shuffled portion with rest, then rotate
        const combinedRecs = [...shuffledPortion, ...restOfList];
        const startIndex = baseOffset % Math.max(1, combinedRecs.length);
        const rotatedRecs = [
          ...combinedRecs.slice(startIndex),
          ...combinedRecs.slice(0, startIndex)
        ];

        const duration = Date.now() - genreStartTime;
        console.log(`[Weekly Digest] ✅ Genre ${genre} fetched in ${duration}ms (${filteredRecs.length} games after filtering)`);

        return {
          genre,
          recommendations: rotatedRecs,
          duration
        };
      } catch (error) {
        const duration = Date.now() - genreStartTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Weekly Digest] Error fetching recommendations for genre', {
          username,
          genre,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
          operation: 'fetch-recommendations',
          duration,
          isTimeout: errorMessage.includes('timed out')
        });
        return {
          genre,
          recommendations: [],
          duration,
          error: errorMessage
        };
      }
    });

    // Wait for all genre fetches to complete in parallel
    const genreResults = await Promise.all(genreFetchPromises);
    const totalFetchDuration = Date.now() - genreFetchStartTime;
    console.log(`[Weekly Digest] ✅ All ${primaryGenres.length} genres fetched in parallel in ${totalFetchDuration}ms for ${username}`);

    // Process results - take 1 game per genre to guarantee each recommendation is from a different genre
    for (const result of genreResults) {
      if (allRecommendations.length >= 5) break;

      for (const rec of result.recommendations) {
        const recLower = rec.toLowerCase();
        const series = extractSeriesName(rec);
        const seriesLower = series.toLowerCase();

        const isExcludedGame = seenGames.has(recLower);
        const isExcludedSeries = isSeriesExcluded(seriesLower, seenSeries);

        if (!isExcludedGame && !isExcludedSeries) {
          allRecommendations.push(rec);
          seenGames.add(recLower);
          seenSeries.add(seriesLower);
          break; // One game per genre — ensures variety across all 5 recommendations
        } else {
          if (isExcludedGame) {
            const reason = gamesAskedAbout.has(recLower) ? 'user asked about it' : 'previously recommended';
            console.log(`[Weekly Digest] Skipped "${rec}" - ${reason}`);
          } else if (isExcludedSeries) {
            console.log(`[Weekly Digest] Skipped "${rec}" - series "${series}" already in email or previously recommended`);
          }
        }
      }
    }

    // Step 13: If we don't have enough recommendations, try additional genres IN PARALLEL
    if (allRecommendations.length < 5) {
      const fallbackGenres = [
        'Action-Adventure', 'RPG', 'Action', 'Adventure', 'Shooter', 'Platformer',
        'Puzzle', 'Racing', 'Fighting', 'Sports', 'Horror', 'Stealth', 'Roguelike',
        'Simulation', 'Survival', 'Strategy', 'MOBA', 'Battle Royale', 'MMORPG'
      ].filter(genre => !primaryGenres.includes(genre)); // Exclude genres we already tried

      // Limit to first 6 fallback genres to avoid too many parallel requests
      const genresToTry = fallbackGenres.slice(0, 6);

      console.log(`[Weekly Digest] Fetching ${genresToTry.length} fallback genres in parallel for ${username} (have ${allRecommendations.length} recommendations so far)`);
      const fallbackStartTime = Date.now();

      // Fetch all fallback genres in parallel
      const fallbackPromises = genresToTry.map(async (genre) => {
        const genreStartTime = Date.now();
        try {
          // Wrap fetchRecommendations with timeout (15 seconds per genre)
          const fallbackRecs = await withTimeout(
            fetchRecommendations(genre, {
              currentPopular: true
            }),
            15000, // 15 seconds timeout for RAWG API call
            `Fetch fallback recommendations for genre ${genre}`
          );

          // Filter and shuffle fallback recommendations for variety
          // Normalize game names (trim whitespace, lowercase) for consistent comparison
          // Also filter out games from previously recommended series
          const filteredFallback = fallbackRecs.filter(game => {
            const gameLower = game.toLowerCase().trim();
            const series = extractSeriesName(game);
            const seriesLower = series.toLowerCase().trim();

            const isExcludedGame = seenGames.has(gameLower);
            const isExcludedSeries = isSeriesExcluded(seriesLower, seenSeries);

            if (isExcludedGame) {
              const reason = gamesAskedAbout.has(gameLower) ? 'user asked about it' : 'previously recommended';
              console.log(`[Weekly Digest] Filtered out "${game}" (fallback) - ${reason}`);
            } else if (isExcludedSeries) {
              console.log(`[Weekly Digest] Filtered out "${game}" (fallback) - series "${series}" was previously recommended`);
            }

            return !isExcludedGame && !isExcludedSeries;
          });

          // Shuffle fallback recommendations for more randomization
          const shuffledFallback = [...filteredFallback].sort(() => Math.random() - 0.5);

          const duration = Date.now() - genreStartTime;
          console.log(`[Weekly Digest] ✅ Fallback genre ${genre} fetched in ${duration}ms (${filteredFallback.length} games after filtering)`);

          return {
            genre,
            recommendations: shuffledFallback,
            duration
          };
        } catch (error) {
          const duration = Date.now() - genreStartTime;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('[Weekly Digest] Error with fallback genre', {
            username,
            genre,
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            operation: 'fetch-fallback-recommendations',
            duration,
            isTimeout: errorMessage.includes('timed out')
          });
          return {
            genre,
            recommendations: [],
            duration,
            error: errorMessage
          };
        }
      });

      // Wait for all fallback fetches to complete
      const fallbackResults = await Promise.all(fallbackPromises);
      const totalFallbackDuration = Date.now() - fallbackStartTime;
      console.log(`[Weekly Digest] ✅ All ${genresToTry.length} fallback genres fetched in parallel in ${totalFallbackDuration}ms for ${username}`);

      // Process fallback results - take 1 game per fallback genre to maintain variety
      for (const result of fallbackResults) {
        if (allRecommendations.length >= 5) break;

        for (const rec of result.recommendations) {
          const recLower = rec.toLowerCase().trim();
          const series = extractSeriesName(rec);
          const seriesLower = series.toLowerCase().trim();

          const isExcludedGame = seenGames.has(recLower);
          const isExcludedSeries = isSeriesExcluded(seriesLower, seenSeries);

          if (!isExcludedGame && !isExcludedSeries) {
            allRecommendations.push(rec);
            seenGames.add(recLower);
            seenSeries.add(seriesLower);
            break; // One game per fallback genre — maintains variety
          } else {
            if (isExcludedGame) {
              const reason = gamesAskedAbout.has(recLower) ? 'user asked about it' : 'previously recommended';
              console.log(`[Weekly Digest] Excluded "${rec}" (fallback) - ${reason}`);
            } else if (isExcludedSeries) {
              console.log(`[Weekly Digest] Excluded "${rec}" (fallback) - series "${series}" already in email or previously recommended`);
            }
          }
        }
      }
    }

    // Log what we're using for recommendations
    console.log(`[Weekly Digest] Recommendations for ${username}:`, {
      weeklyForumPosts: weeklyForumActivity.length,
      weeklyQuestions: weeklyQuestions.length,
      weeklyAchievements: weeklyAchievements.length,
      primaryGenres,
      gamesExcluded: gamesAskedAbout.size,
      previouslyRecommendedExcluded: previouslyRecommended.size,
      recommendationsCount: allRecommendations.length,
      usedRecentQuestions: useRecentQuestions
    });

    // Return 5 recommendations
    // NOTE: allRecommendations contains the FULL game names (e.g., "Final Fantasy IX", "Super Mario Galaxy 2")
    // These are what will be displayed in the email. extractSeriesName() is only used for duplicate checking.
    const finalRecommendations = allRecommendations.slice(0, 5);

    // Save recommended games to user's weeklyDigest for future exclusion
    // This ensures we don't recommend the same games in consecutive weeks
    // IMPORTANT: Save BEFORE returning to ensure it completes
    if (finalRecommendations.length > 0) {
      try {
        // Use pre-fetched userDoc if available, otherwise fetch
        // Type guard: ensure userDoc is a single object, not an array
        const preFetchedUser = Array.isArray(userDoc) ? null : userDoc;
        const fetchedUser = preFetchedUser || await User.findOne({ username });
        // Type guard: ensure fetchedUser is a single object, not an array
        const currentUser = Array.isArray(fetchedUser) ? null : fetchedUser;
        if (currentUser) {
          // Ensure weeklyDigest object exists
          if (!currentUser.weeklyDigest) {
            currentUser.weeklyDigest = {};
          }

          const currentRecommended = (currentUser.weeklyDigest.previouslyRecommendedGames as string[]) || [];
          // Add new recommendations and keep only last 25 to prevent list from growing too large
          const updatedRecommended = [...currentRecommended, ...finalRecommendations].slice(-25);

          // Save using $set to ensure atomic update
          // Also ensure weeklyDigest object exists if it doesn't
          const updateResult = await User.findOneAndUpdate(
            { username },
            {
              $set: {
                'weeklyDigest.previouslyRecommendedGames': updatedRecommended,
                // Ensure weeklyDigest object exists
                ...(currentUser.weeklyDigest.enabled === undefined && { 'weeklyDigest.enabled': true })
              }
            },
            {
              new: false // Don't need the updated document
            }
          );

          if (updateResult) {
            console.log(`[Weekly Digest] ✅ Saved ${finalRecommendations.length} recommended games for ${username}. Total tracked: ${updatedRecommended.length}`);
            console.log(`[Weekly Digest] New recommendations saved:`, finalRecommendations);
            console.log(`[Weekly Digest] Previously recommended (will be excluded next time):`, updatedRecommended.slice(0, 10));

            // Verify the save worked by reading it back
            const verifyUser = await User.findOne({ username }).select('weeklyDigest.previouslyRecommendedGames').lean();
            if (verifyUser && !Array.isArray(verifyUser) && (verifyUser as any).weeklyDigest?.previouslyRecommendedGames) {
              const savedCount = ((verifyUser as any).weeklyDigest.previouslyRecommendedGames as string[]).length;
              console.log(`[Weekly Digest] ✅ Verified save: ${savedCount} games now in database for ${username}`);
            } else {
              console.error(`[Weekly Digest] ❌ VERIFICATION FAILED: Could not read back saved games for ${username}`);
            }
          } else {
            console.error(`[Weekly Digest] ❌ Failed to save recommended games for ${username} - user not found or update failed`);
          }
        } else {
          console.error(`[Weekly Digest] ❌ User ${username} not found when trying to save recommendations`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Weekly Digest] Error saving recommended games for user', {
          username,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
          operation: 'save-recommended-games',
          recommendationsCount: finalRecommendations.length
        });
        // Don't fail the whole process if saving fails, but log it prominently
      }
    } else {
      console.warn(`[Weekly Digest] ⚠️ No recommendations to save for ${username} - allRecommendations was empty`);
    }

    return finalRecommendations;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Weekly Digest] Error getting game recommendations for user', {
      username,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      operation: 'get-weekly-game-recommendations'
    });

    // Fallback to default recommendations with timeout
    // Try multiple genres for variety instead of just Action-Adventure
    const fallbackGenres = [
      'Action-Adventure', 'RPG', 'Platformer', 'Shooter', 'Puzzle', 'Adventure', 'Action', 'Strategy',
      'Racing', 'Fighting', 'Sports', 'Horror', 'Stealth', 'Simulation', 'Survival',
      'MOBA', 'Battle Royale', 'MMORPG', 'Rhythm', 'Sandbox', 'Roguelike'
    ];
    const fallbackRecommendations: string[] = [];

    try {
      // OPTIMIZATION: Fetch first 6 genres in parallel instead of sequentially
      const genresToTry = fallbackGenres.slice(0, 6);
      console.log(`[Weekly Digest] Fetching ${genresToTry.length} fallback genres in parallel for ${username} (error fallback)`);
      const fallbackStartTime = Date.now();

      const fallbackPromises = genresToTry.map(async (genre) => {
        const genreStartTime = Date.now();
        try {
          const genreRecs = await withTimeout(
            fetchRecommendations(genre, { currentPopular: true }),
            10000, // 10 seconds timeout per genre (shorter since we're trying multiple)
            `Fetch fallback recommendations for genre ${genre}`
          );

          const duration = Date.now() - genreStartTime;
          console.log(`[Weekly Digest] ✅ Fallback genre ${genre} fetched in ${duration}ms`, {
            username,
            genre,
            recommendationsCount: genreRecs.length,
            duration,
            timestamp: new Date().toISOString(),
            operation: 'get-weekly-game-recommendations-fallback'
          });

          return {
            genre,
            recommendations: genreRecs,
            duration
          };
        } catch (genreError) {
          const duration = Date.now() - genreStartTime;
          const genreErrorMessage = genreError instanceof Error ? genreError.message : 'Unknown error';
          console.warn(`[Weekly Digest] Fallback genre ${genre} failed`, {
            username,
            genre,
            error: genreErrorMessage,
            duration,
            timestamp: new Date().toISOString(),
            operation: 'get-weekly-game-recommendations-fallback-genre'
          });
          return {
            genre,
            recommendations: [],
            duration,
            error: genreErrorMessage
          };
        }
      });

      // Wait for all fallback fetches to complete
      const fallbackResults = await Promise.all(fallbackPromises);
      const totalFallbackDuration = Date.now() - fallbackStartTime;
      console.log(`[Weekly Digest] ✅ All ${genresToTry.length} fallback genres fetched in parallel in ${totalFallbackDuration}ms for ${username}`);

      // Process results and add unique recommendations
      for (const result of fallbackResults) {
        if (fallbackRecommendations.length >= 5) break;

        // Add unique recommendations (avoid duplicates)
        for (const rec of result.recommendations) {
          if (fallbackRecommendations.length >= 5) break;
          const recLower = rec.toLowerCase().trim();
          if (!fallbackRecommendations.some(r => r.toLowerCase().trim() === recLower)) {
            fallbackRecommendations.push(rec);
          }
        }
      }

      if (fallbackRecommendations.length > 0) {
        console.log('[Weekly Digest] Fallback recommendations fetched successfully', {
          username,
          genresTried: fallbackGenres.slice(0, Math.ceil(fallbackRecommendations.length / 5)),
          recommendationsCount: fallbackRecommendations.length,
          timestamp: new Date().toISOString(),
          operation: 'get-weekly-game-recommendations-fallback'
        });
        return fallbackRecommendations.slice(0, 5); // Return up to 5 recommendations
      } else {
        console.warn('[Weekly Digest] All fallback genres failed, returning empty array', {
          username,
          genresTried: fallbackGenres,
          timestamp: new Date().toISOString(),
          operation: 'get-weekly-game-recommendations-fallback'
        });
        return [];
      }
    } catch (fallbackError) {
      const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
      console.error('[Weekly Digest] Error with fallback recommendations', {
        username,
        error: fallbackErrorMessage,
        stack: fallbackError instanceof Error ? fallbackError.stack : undefined,
        timestamp: new Date().toISOString(),
        operation: 'get-weekly-game-recommendations-fallback',
        isTimeout: fallbackErrorMessage.includes('timed out')
      });
      return [];
    }
  }
}
