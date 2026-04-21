import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import Question from '../../models/Question';
import User from '../../models/User';
import { UserContextResponse } from '../../types';
import axios from 'axios';
import { LRUCache } from '../../utils/cacheManager';
import { cacheManager } from '../../utils/cacheManager';

// Cache for user context responses (10 minute TTL - balances freshness with cache efficiency)
// User context is aggregated from last 50 questions, so it's relatively stable
// 10 minutes provides good cache hit rate while maintaining acceptable data freshness
const USER_CONTEXT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes (increased from 5 minutes)
const USER_CONTEXT_CACHE_MAX_SIZE = 500; // Max 500 users
const userContextCache = new LRUCache<UserContextResponse>(
  USER_CONTEXT_CACHE_MAX_SIZE,
  USER_CONTEXT_CACHE_TTL,
  10 * 60 * 1000 // Cleanup every 10 minutes (matches TTL)
);

// Cache for game verification results (24 hour TTL - games don't change)
const GAME_VERIFICATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const GAME_VERIFICATION_CACHE_MAX_SIZE = 10000; // Max 10,000 games
const gameVerificationCache = new LRUCache<boolean>(
  GAME_VERIFICATION_CACHE_MAX_SIZE,
  GAME_VERIFICATION_CACHE_TTL,
  10 * 60 * 1000 // Cleanup every 10 minutes
);

// Register caches with cache manager for monitoring
cacheManager.registerCache('UserContextCache', userContextCache);
cacheManager.registerCache('GameVerificationCache', gameVerificationCache);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserContextResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username } = req.query;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  // Check cache first (bypass cache if ?refresh=true is provided)
  const shouldRefresh = req.query.refresh === 'true';
  if (!shouldRefresh) {
    const cachedResponse = userContextCache.get(username);
    if (cachedResponse) {
      return res.status(200).json(cachedResponse);
    }
  }

  try {
    // Connect to database

    // Get user's recent questions with detected games and genres
    // Optimized: Only fetch what we need, limit to 50 questions (sufficient for analysis)
    const recentQuestions = await Question.find({ username })
      .sort({ timestamp: -1 })
      .limit(50) // Reduced from 100 to 50 for better performance
      .select('detectedGame detectedGenre timestamp questionCategory interactionType question')
      .lean();

    /**
     * Check if a title is a bundle, DLC, cosmetic pack, or expansion (not a base game)
     */
    const isBundleOrDLC = (title: string): boolean => {
      const lower = title.toLowerCase();
      const bundleIndicators = [
        'bundle',
        'expansion pass',
        'expansion pack',
        'dlc',
        'twin pack',
        'double pack',
        'collection',
        'cosmetic pack',
        'cosmetic',
        'pack',
        'edition',
        'remastered twin',
        '&',
        'and expansion',
        'season pass',
        'complete edition',
        'ultimate edition',
        'deluxe edition',
        'add-on',
        'addon',
        'expansion',
      ];
      
      return bundleIndicators.some(indicator => lower.includes(indicator));
    };

    /**
     * Extract base game title from DLC/bundle name
     * Example: "Saints Row: Going Commando Cosmetic Pack" -> "Saints Row"
     */
    const extractBaseGameFromDLC = (dlcTitle: string): string => {
      // Pattern: "Game Name: Subtitle Cosmetic Pack" -> "Game Name"
      // Pattern: "Game Name and Expansion Pass" -> "Game Name"
      // Pattern: "Game Name DLC" -> "Game Name"
      
      // Remove common DLC/pack suffixes
      let cleaned = dlcTitle
        .replace(/\s+and\s+.*?(?:expansion|pass|bundle|pack|dlc|cosmetic).*$/i, '')
        .replace(/\s+&\s+.*?(?:remastered|twin|double|pack).*$/i, '')
        .replace(/\s+(?:expansion|pass|bundle|pack|dlc|cosmetic|collection|remastered|edition).*$/i, '')
        .trim();
      
      // If it's a pattern like "Game: Subtitle Pack", extract just "Game"
      const colonMatch = cleaned.match(/^([^:]+):/);
      if (colonMatch && colonMatch[1]) {
        cleaned = colonMatch[1].trim();
      }
      
      // Only return if we extracted something meaningful (at least 5 chars)
      if (cleaned.length >= 5 && cleaned.length < dlcTitle.length * 0.8) {
        return cleaned;
      }
      
      // If extraction didn't work well, return original
      return dlcTitle;
    };

    /**
     * Verify if a detected game title exists in game databases
     * Returns true if it exists (including DLC), false if it doesn't exist at all
     * Uses caching to avoid repeated API calls
     */
    const verifyGameExists = async (gameTitle: string): Promise<boolean> => {
      if (!gameTitle || gameTitle.trim().length < 3) {
        return false;
      }

      const sanitizedTitle = gameTitle.trim();
      const cacheKey = sanitizedTitle.toLowerCase();
      
      // Check cache first
      const cachedResult = gameVerificationCache.get(cacheKey);
      if (cachedResult !== null) {
        return cachedResult;
      }

      try {
        const lowerTitle = sanitizedTitle.toLowerCase();

        // Quick heuristic: Very short names (1-2 words, < 10 chars) are likely not games
        const wordCount = sanitizedTitle.split(/\s+/).length;
        if (wordCount === 1 && sanitizedTitle.length < 5) {
          // Single word, very short - likely a character/boss name
          gameVerificationCache.set(cacheKey, false, GAME_VERIFICATION_CACHE_TTL);
          return false;
        }

        // Try RAWG first (simpler API, no auth needed)
        try {
          const rawgUrl = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(sanitizedTitle)}&page_size=5`;
          const rawgResponse = await axios.get(rawgUrl, { timeout: 3000 });
          
          if (rawgResponse.data && rawgResponse.data.results && rawgResponse.data.results.length > 0) {
            // Check for exact or close match (DLC/packs are OK - user might have asked about them)
            const exactMatch = rawgResponse.data.results.find((g: any) => {
              const gameName = g.name.toLowerCase().trim();
              return gameName === lowerTitle || 
                     gameName.includes(lowerTitle) || 
                     lowerTitle.includes(gameName);
            });
            
            if (exactMatch) {
              // Cache positive result
              gameVerificationCache.set(cacheKey, true, GAME_VERIFICATION_CACHE_TTL);
              return true; // Game/DLC exists in RAWG
            }
          }
        } catch (rawgError) {
          // RAWG failed, continue
        }

        // If RAWG didn't find it, it's likely not a real game/DLC
        // Cache negative result
        gameVerificationCache.set(cacheKey, false, GAME_VERIFICATION_CACHE_TTL);
        return false;
      } catch (error) {
        // On error, be conservative and include it (don't cache errors)
        console.error(`Error verifying game "${gameTitle}":`, error);
        return true; // Default to true to avoid filtering out real games on API errors
      }
    };

    // Extract unique recent games with timestamps (before verification)
    const gamesMapWithTimestamps = new Map<string, Date>();
    for (const q of recentQuestions) {
      const game = (q as any).detectedGame;
      if (game && typeof game === 'string' && game.trim()) {
        const gameTrimmed = game.trim();
        const timestamp = (q as any).timestamp || new Date(0);
        // Keep the most recent timestamp for each game
        if (!gamesMapWithTimestamps.has(gameTrimmed) || gamesMapWithTimestamps.get(gameTrimmed)! < timestamp) {
          gamesMapWithTimestamps.set(gameTrimmed, timestamp);
        }
      }
    }

    // Verify all unique games in parallel to filter out boss/character names
    // Limit to top 10 games to avoid too many API calls
    const uniqueGames = Array.from(gamesMapWithTimestamps.keys()).slice(0, 10);
    const verificationResults = await Promise.all(
      uniqueGames.map(async (game) => ({
        game,
        isValid: await verifyGameExists(game),
        isDLC: isBundleOrDLC(game),
        timestamp: gamesMapWithTimestamps.get(game)!
      }))
    );

    // Filter to only valid base games (exclude DLC/packs to avoid confusion)
    // Only include games that were directly detected as base games
    // This ensures we only show games the user actually asked about
    const gamesMap = new Map<string, Date>();
    for (const result of verificationResults) {
      if (result.isValid && !result.isDLC) {
        // Only include base games (not DLC/packs)
        // This prevents extracted base games from appearing when user only asked about DLC
        if (!gamesMap.has(result.game) || gamesMap.get(result.game)! < result.timestamp) {
          gamesMap.set(result.game, result.timestamp);
        }
      }
      // Skip DLC/packs entirely - if user asked about DLC, they should ask about the base game separately
    }

    // Sort by most recent and get top 5
    const recentGames = Array.from(gamesMap.entries())
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .slice(0, 5)
      .map(([game]) => game);

    // Extract and count genres
    const genreCounts = new Map<string, number>();
    for (const q of recentQuestions) {
      const genres = (q as any).detectedGenre;
      if (Array.isArray(genres)) {
        for (const genre of genres) {
          if (genre && typeof genre === 'string') {
            genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
          }
        }
      }
    }

    // Get top 3 genres by frequency
    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre]) => genre);

    // Fetch user preferences from User model
    let preferences = undefined;
    try {
      const user = await User.findOne({ username })
        .select('personalized')
        .lean();

      if (user && (user as any).personalized?.preferenceProfile) {
        const profile = (user as any).personalized.preferenceProfile;
        preferences = {
          dominantGenres: profile.dominantGenres && profile.dominantGenres.length > 0
            ? profile.dominantGenres
            : undefined,
          learningStyle: profile.learningStyle || undefined,
          difficultyPreference: profile.difficultyPreference || undefined,
          playstyleTags: profile.playstyleTags && profile.playstyleTags.length > 0
            ? profile.playstyleTags
            : undefined,
          recentInterests: profile.recentInterests && profile.recentInterests.length > 0
            ? profile.recentInterests
            : undefined,
        };

        // Remove undefined fields
        if (Object.values(preferences).every(v => v === undefined)) {
          preferences = undefined;
        }
      }
    } catch (prefError) {
      // If preferences fetch fails, continue without them (not critical)
      console.error('Error fetching user preferences:', prefError);
    }

    // Calculate activity patterns
    let activity = undefined;
    if (recentQuestions.length > 0) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const lastQuestion = recentQuestions[0]?.timestamp;
      const questionsToday = recentQuestions.filter((q: any) => {
        const qDate = new Date(q.timestamp);
        return qDate >= today;
      }).length;

      const questionsThisWeek = recentQuestions.filter((q: any) => {
        const qDate = new Date(q.timestamp);
        return qDate >= weekAgo;
      }).length;

      // Calculate peak activity hours (hours 0-23 when user asks most questions)
      const hourCounts = new Map<number, number>();
      recentQuestions.forEach((q: any) => {
        if (q.timestamp) {
          const hour = new Date(q.timestamp).getHours();
          hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        }
      });

      // Get top 3 peak hours
      const peakActivityHours = Array.from(hourCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hour]) => hour);

      activity = {
        lastQuestionTime: lastQuestion ? new Date(lastQuestion).toISOString() : undefined,
        questionsToday: questionsToday > 0 ? questionsToday : undefined,
        questionsThisWeek: questionsThisWeek > 0 ? questionsThisWeek : undefined,
        peakActivityHours: peakActivityHours.length > 0 ? peakActivityHours : undefined,
      };

      // Remove undefined fields
      if (Object.values(activity).every(v => v === undefined)) {
        activity = undefined;
      }
    }

    // Calculate question patterns
    let questionPatterns = undefined;
    if (recentQuestions.length > 0) {
      // Count question categories
      const categoryCounts = new Map<string, number>();
      const interactionTypeCounts = new Map<string, number>();
      const questionTypeKeywords: string[] = [];

      recentQuestions.forEach((q: any) => {
        // Count categories
        if (q.questionCategory && typeof q.questionCategory === 'string') {
          categoryCounts.set(
            q.questionCategory,
            (categoryCounts.get(q.questionCategory) || 0) + 1
          );
        }

        // Count interaction types
        if (q.interactionType && typeof q.interactionType === 'string') {
          interactionTypeCounts.set(
            q.interactionType,
            (interactionTypeCounts.get(q.interactionType) || 0) + 1
          );
        }

        // Extract question type keywords from recent questions (last 10)
        if (q.question && typeof q.question === 'string' && recentQuestions.indexOf(q) < 10) {
          const questionLower = q.question.toLowerCase();
          if (questionLower.includes('how to') || questionLower.includes('how do')) {
            questionTypeKeywords.push('how to');
          } else if (questionLower.includes('best') || questionLower.includes('top')) {
            questionTypeKeywords.push('best');
          } else if (questionLower.includes('tip') || questionLower.includes('advice')) {
            questionTypeKeywords.push('tips');
          } else if (questionLower.includes('build') || questionLower.includes('setup')) {
            questionTypeKeywords.push('build');
          } else if (questionLower.includes('beat') || questionLower.includes('defeat')) {
            questionTypeKeywords.push('beat');
          } else if (questionLower.includes('secret') || questionLower.includes('hidden')) {
            questionTypeKeywords.push('secrets');
          }
        }
      });

      // Get top categories and interaction types
      const commonCategories = Array.from(categoryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([category]) => category);

      const commonInteractionTypes = Array.from(interactionTypeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type]) => type);

      // Get unique question type keywords
      const recentQuestionTypes = Array.from(new Set(questionTypeKeywords));

      questionPatterns = {
        commonCategories: commonCategories.length > 0 ? commonCategories : undefined,
        commonInteractionTypes: commonInteractionTypes.length > 0 ? commonInteractionTypes : undefined,
        recentQuestionTypes: recentQuestionTypes.length > 0 ? recentQuestionTypes : undefined,
      };

      // Remove undefined fields
      if (Object.values(questionPatterns).every(v => v === undefined)) {
        questionPatterns = undefined;
      }
    }

    const response: UserContextResponse = {
      recentGames: recentGames.length > 0 ? recentGames : undefined,
      topGenres: topGenres.length > 0 ? topGenres : undefined,
      preferences,
      activity,
      questionPatterns,
    };

    // Cache the response
    userContextCache.set(username, response, USER_CONTEXT_CACHE_TTL);

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in user-context API:', error);
    return res.status(500).json({
      error: 'Failed to fetch user context'
    });
  }
}

export default withDatabase(handler);
