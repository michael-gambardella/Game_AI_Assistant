import axios from 'axios';
import { getClientCredentialsAccessToken } from './twitchAuth';
import { LRUCache, cacheManager } from './cacheManager';
import { cleanAndMatchTitle, validateGameMatch } from './gameMetadata';
import { extractGameTitleFromQuestion } from './gameTitleExtractor';

// ============================================================================
// Model Selection for Smart Multi-Model Usage
// ============================================================================

/**
 * Interface for model selection results
 */
export interface ModelSelectionResult {
  model: string;
  reason: string;
  releaseDate?: Date;
  releaseYear?: number;
}

/**
 * Cache for game release dates to avoid repeated API calls
 * Uses LRU eviction with max size limit
 * Key: game title (lowercase), Value: Date
 */
const RELEASE_DATE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const RELEASE_DATE_CACHE_MAX_SIZE = 5000; // Max 5000 games (roughly 5-10MB)
const releaseDateCache = new LRUCache<Date>(
  RELEASE_DATE_CACHE_MAX_SIZE,
  RELEASE_DATE_CACHE_TTL,
  10 * 60 * 1000 // Cleanup every 10 minutes
);

// Register with cache manager for monitoring
cacheManager.registerCache('ReleaseDateCache', releaseDateCache);

/**
 * Request deduplication for release date fetches
 * Prevents cache stampedes when multiple parallel requests ask for the same game
 * Key: normalized game title, Value: Promise<Date | null>
 */
const pendingReleaseDateRequests = new Map<string, Promise<Date | null>>();
const RELEASE_DATE_DEDUP_TTL = 30 * 1000; // 30 seconds - cleanup completed requests

/**
 * Fetch release date for a game from IGDB (lightweight version)
 * Returns just the release date, not full game info
 */
async function fetchReleaseDateFromIGDB(gameTitle: string): Promise<Date | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();

    // Limit game title to 255 characters (IGDB API limit)
    const limitedTitle = gameTitle.length > 255 ? gameTitle.substring(0, 252) + '...' : gameTitle;

    // Escape special characters and quotes in the game title
    const sanitizedTitle = limitedTitle.replace(/"/g, '\\"');

    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      `search "${sanitizedTitle}";
       fields name,first_release_date;
       limit 5;`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (response.data && response.data.length > 0) {
      // Try to find exact match first
      let game = response.data.find((g: any) => cleanAndMatchTitle(gameTitle, g.name));

      // If exact match found, validate it has distinctive words
      if (game && !validateGameMatch(gameTitle, game.name)) {
        game = undefined;
      }

      // If no exact match, try to find a match with distinctive words
      if (!game) {
        game = response.data.find((g: any) => {
          const gameNameLower = g.name.toLowerCase();
          const queryLower = gameTitle.toLowerCase();
          const hasBasicMatch = gameNameLower.includes(queryLower) || queryLower.includes(gameNameLower);
          return hasBasicMatch && validateGameMatch(gameTitle, g.name);
        });
      }

      if (game && game.first_release_date) {
        return new Date(game.first_release_date * 1000);
      }
    }
    return null;
  } catch (error) {
    console.error('[Model Selection] Error fetching release date from IGDB:', error);
    return null;
  }
}

/**
 * Fetch release date for a game from RAWG (lightweight version)
 * Returns just the release date, not full game info
 */
async function fetchReleaseDateFromRAWG(gameTitle: string): Promise<Date | null> {
  try {
    const sanitizedTitle = gameTitle.toLowerCase().trim();
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(sanitizedTitle)}&search_precise=true&page_size=5`;

    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      // Find exact match or close match
      const game = response.data.results.find((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        return normalizedGameName === sanitizedTitle ||
               normalizedGameName.includes(sanitizedTitle);
      });

      if (game && game.released) {
        return new Date(game.released);
      }
    }
    return null;
  } catch (error) {
    console.error('[Model Selection] Error fetching release date from RAWG:', error);
    return null;
  }
}

/**
 * Normalize game title for cache key to handle variations
 * Removes leading "the", normalizes whitespace, and standardizes formatting
 * Handles Unicode diacritics (e.g., Ōkami → okami, Ragnarök → ragnarok)
 * This ensures "The Legend of Zelda: Breath of the Wild" and "Legend of Zelda: Breath of the Wild"
 * map to the same cache key
 */
function normalizeCacheKey(gameTitle: string): string {
  if (!gameTitle) return '';

  // Normalize to NFD (Normalization Form Decomposed) to separate base characters from diacritics
  // Then remove combining diacritical marks (Unicode category Mn: Mark, nonspacing)
  let normalized = gameTitle
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Remove combining diacritical marks
    .toLowerCase()
    .trim();

  // Remove leading "the" (case-insensitive) to handle variations
  // This handles: "The Legend of Zelda" vs "Legend of Zelda"
  normalized = normalized.replace(/^the\s+/i, '');

  // Normalize whitespace (multiple spaces/tabs/newlines to single space)
  normalized = normalized.replace(/\s+/g, ' ');

  // Normalize punctuation spacing (standardize spacing around colons)
  // "Title: Subtitle" and "Title : Subtitle" both become "title: subtitle"
  normalized = normalized.replace(/\s*:\s*/g, ': ');

  // Normalize periods (remove spaces before periods, standardize after)
  // "Super Mario Bros. Wonder" stays as is, but "Super Mario Bros . Wonder" becomes "Super Mario Bros. Wonder"
  normalized = normalized.replace(/\s+\./g, '.');
  normalized = normalized.replace(/\.\s+/g, '. ');

  // Normalize hyphens and dashes (standardize to single hyphen with no spaces)
  // "Super Mario Bros - Wonder" and "Super Mario Bros-Wonder" both become "super mario bros - wonder"
  normalized = normalized.replace(/\s*-\s*/g, ' - ');
  normalized = normalized.replace(/\s*—\s*/g, ' - '); // Em dash
  normalized = normalized.replace(/\s*–\s*/g, ' - '); // En dash

  // Remove trailing spaces and punctuation artifacts
  normalized = normalized.trim();

  return normalized;
}

/**
 * Get release date for a game with caching and request deduplication
 * Checks cache first, then tries IGDB, then RAWG
 * Uses request deduplication to prevent cache stampedes from parallel requests
 */
export async function getGameReleaseDate(gameTitle: string): Promise<Date | null> {
  // Use normalized cache key to handle title variations
  const cacheKey = normalizeCacheKey(gameTitle);

  // Check cache first with normalized key
  const cached = releaseDateCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Also check with original title format (lowercase, trimmed) in case it was cached differently
  const originalKey = gameTitle.toLowerCase().trim();
  if (originalKey !== cacheKey) {
    const cachedOriginal = releaseDateCache.get(originalKey);
    if (cachedOriginal) {
      // Cache hit with original format - also cache with normalized key for future lookups
      releaseDateCache.set(cacheKey, cachedOriginal, RELEASE_DATE_CACHE_TTL);
      return cachedOriginal;
    }
  }

  // Also check with "The" prefix variations (add/remove "The")
  // This handles cases where "The Legend of Zelda" vs "Legend of Zelda" are used
  const withTheKey = cacheKey.startsWith('the ') ? cacheKey : `the ${cacheKey}`;
  const withoutTheKey = cacheKey.replace(/^the\s+/i, '');

  if (withTheKey !== cacheKey && withTheKey !== originalKey) {
    const cachedWithThe = releaseDateCache.get(withTheKey);
    if (cachedWithThe) {
      releaseDateCache.set(cacheKey, cachedWithThe, RELEASE_DATE_CACHE_TTL);
      if (originalKey !== cacheKey) {
        releaseDateCache.set(originalKey, cachedWithThe, RELEASE_DATE_CACHE_TTL);
      }
      return cachedWithThe;
    }
  }

  if (withoutTheKey !== cacheKey && withoutTheKey !== originalKey) {
    const cachedWithoutThe = releaseDateCache.get(withoutTheKey);
    if (cachedWithoutThe) {
      releaseDateCache.set(cacheKey, cachedWithoutThe, RELEASE_DATE_CACHE_TTL);
      if (originalKey !== cacheKey) {
        releaseDateCache.set(originalKey, cachedWithoutThe, RELEASE_DATE_CACHE_TTL);
      }
      return cachedWithoutThe;
    }
  }

  // REQUEST DEDUPLICATION: Check if a request for this game is already in progress
  // Check with ALL key variations to catch parallel requests with different title formats
  // This prevents cache stampedes when multiple parallel calls happen for the same game
  const allKeysToCheck = [cacheKey, originalKey, withTheKey, withoutTheKey].filter(
    (key, index, self) => key && self.indexOf(key) === index // Remove duplicates
  );

  for (const key of allKeysToCheck) {
    if (pendingReleaseDateRequests.has(key)) {
      // Reuse the existing in-flight request
      return pendingReleaseDateRequests.get(key)!;
    }
  }

  // Create new request promise
  const requestPromise = (async (): Promise<Date | null> => {
    try {
      // Try IGDB first (more reliable)
      let releaseDate = await fetchReleaseDateFromIGDB(gameTitle);

      // Fallback to RAWG if IGDB fails
      if (!releaseDate) {
        releaseDate = await fetchReleaseDateFromRAWG(gameTitle);
      }

      // Cache the result if we got one
      // Cache with multiple key variations to maximize hit rate
      if (releaseDate) {
        // Primary cache key (normalized input title)
        releaseDateCache.set(cacheKey, releaseDate, RELEASE_DATE_CACHE_TTL);

        // Also cache with the original title format (in case it's different)
        if (originalKey !== cacheKey) {
          releaseDateCache.set(originalKey, releaseDate, RELEASE_DATE_CACHE_TTL);
        }

        // Cache with "The" prefix variations to handle title format differences
        if (withTheKey !== cacheKey && withTheKey !== originalKey) {
          releaseDateCache.set(withTheKey, releaseDate, RELEASE_DATE_CACHE_TTL);
        }
        if (withoutTheKey !== cacheKey && withoutTheKey !== originalKey) {
          releaseDateCache.set(withoutTheKey, releaseDate, RELEASE_DATE_CACHE_TTL);
        }
      }

      return releaseDate;
    } finally {
      // Clean up the pending request after a short delay
      // Clean up ALL key variations so any variation can be reused
      // This allows other parallel requests to reuse the result if they arrive just after completion
      setTimeout(() => {
        for (const key of allKeysToCheck) {
          pendingReleaseDateRequests.delete(key);
        }
      }, RELEASE_DATE_DEDUP_TTL);
    }
  })();

  // Store the promise with ALL key variations so any variation can find it
  // This ensures that "The War Thunder" and "War Thunder" share the same request
  for (const key of allKeysToCheck) {
    pendingReleaseDateRequests.set(key, requestPromise);
  }

  return requestPromise;
}

/**
 * Determine which OpenAI model to use based on game release date
 * - GPT-5.2 for games released 2024+ (better knowledge - cutoff Aug 2025 vs Apr 2024)
 * - GPT-4o for games released before 2024 (proven quality, cost-effective)
 *
 * Rationale: GPT-5.2 has knowledge through August 2025, making it much better
 * for newer games, but costs ~24% more with typical 1:2 input/output ratio.
 *
 * @param gameTitle - Optional game title to check release date
 * @param question - Question text (fallback if no game title)
 * @returns Model selection result
 */
export async function selectModelForQuestion(
  gameTitle?: string,
  question?: string
): Promise<ModelSelectionResult> {
  const CUTOFF_YEAR = 2024; // Games released 2024+ use GPT-5.2 (better knowledge cutoff)
  const DEFAULT_MODEL = 'gpt-4o-search-preview'; // Safe default

  // If no game title, try to extract from question
  let detectedGame = gameTitle;
  if (!detectedGame && question) {
    detectedGame = await extractGameTitleFromQuestion(question);
  }

  // If still no game, use default model
  if (!detectedGame) {
    return {
      model: DEFAULT_MODEL,
      reason: 'no_game_detected'
    };
  }

  // Get release date (with caching)
  try {
    const releaseDate = await getGameReleaseDate(detectedGame);

    if (releaseDate) {
      const releaseYear = releaseDate.getFullYear();

      // For remakes, the release date will be the remake date (already handled by API)
      // This ensures "Resident Evil 4 Remake" uses remake date (2023), not original (2005)

      if (releaseYear >= CUTOFF_YEAR) {
        return {
          model: 'gpt-5.2',
          reason: `game_released_${releaseYear}`,
          releaseDate: releaseDate,
          releaseYear: releaseYear
        };
      } else {
        return {
          model: DEFAULT_MODEL,
          reason: `game_released_${releaseYear}`,
          releaseDate: releaseDate,
          releaseYear: releaseYear
        };
      }
    }
  } catch (error) {
    console.error('[Model Selection] Error in selectModelForQuestion:', error);
  }

  // Default to 4o if we can't determine release date
  return {
    model: DEFAULT_MODEL,
    reason: 'release_date_unavailable'
  };
}

// Track model usage for cost monitoring
export const modelUsageStats: { [key: string]: number } = {
  'gpt-4o-search-preview': 0,
  'gpt-4o': 0,
  'gpt-4o-mini': 0,
  'gpt-5.2': 0
};

/**
 * Get model usage statistics
 */
export function getModelUsageStats() {
  return { ...modelUsageStats };
}

/**
 * Reset model usage statistics
 */
export function resetModelUsageStats() {
  modelUsageStats['gpt-4o-search-preview'] = 0;
  modelUsageStats['gpt-4o'] = 0;
  modelUsageStats['gpt-4o-mini'] = 0;
  modelUsageStats['gpt-5.2'] = 0;
}
