import axios from 'axios';
import { externalApiClient } from './axiosConfig';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { getClientCredentialsAccessToken } from './twitchAuth';
import { LRUCache, cacheManager } from './cacheManager';

// Load environment variables from both .env and .env.local
dotenv.config(); // Loads .env by default
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') }); // Also load .env.local if it exists

// Lazy initialization of OpenAI client to avoid errors on server startup
// Only initializes when actually needed
let openaiInstance: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is missing or empty. Please set it in your .env or .env.local file.');
    }
    openaiInstance = new OpenAI({
      apiKey: apiKey,
      timeout: 28000, // Default for fast models; gpt-4o-search-preview uses a longer per-request timeout (see openaiRequestOptionsForModel)
      maxRetries: 1, // Reduce retries to avoid compounding delays
    });
  }
  return openaiInstance;
}

/** gpt-4o-search-preview runs browsing/search and often exceeds the default client timeout. */
const OPENAI_SEARCH_PREVIEW_TIMEOUT_MS = 120_000;

/**
 * Per-request options for models that need more time. Avoids doubling wall-clock on timeout
 * (SDK retries timeouts by default).
 */
export function openaiRequestOptionsForModel(model: string | undefined): { timeout: number; maxRetries: number } | undefined {
  if (model === 'gpt-4o-search-preview') {
    return { timeout: OPENAI_SEARCH_PREVIEW_TIMEOUT_MS, maxRetries: 0 };
  }
  if (model === 'gpt-5.2') {
    return { timeout: OPENAI_SEARCH_PREVIEW_TIMEOUT_MS, maxRetries: 0 };
  }
  return undefined;
}

// Cache implementation for API responses with LRU eviction

export class AICacheMetrics {
  private cache: LRUCache<any>;
  private static instance: AICacheMetrics;
  
  // Default max size: 2000 entries (adjust based on memory constraints)
  // Each entry is roughly 1-5KB, so 2000 entries = ~2-10MB
  private readonly MAX_CACHE_SIZE = 2000;
  private readonly DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

  private constructor() {
    this.cache = new LRUCache<any>(
      this.MAX_CACHE_SIZE,
      this.DEFAULT_TTL,
      5 * 60 * 1000 // Cleanup every 5 minutes
    );
    
    // Register with cache manager for monitoring
    cacheManager.registerCache('AICache', this.cache);
  }

  public static getInstance(): AICacheMetrics {
    if (!AICacheMetrics.instance) {
      AICacheMetrics.instance = new AICacheMetrics();
    }
    return AICacheMetrics.instance;
  }

  // Set the cache value with TTL
  set(key: string, value: any, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, value, ttl);
  }

  // Get the cache value
  get(key: string): any {
    return this.cache.get(key);
  }

  getMetrics() {
    const metrics = this.cache.getMetrics();
    return {
      hits: metrics.hits,
      misses: metrics.misses,
      hitRate: metrics.hitRate,
      cacheSize: metrics.size,
      maxSize: metrics.maxSize,
      evictions: metrics.evictions,
      expiredRemovals: metrics.expiredRemovals,
      utilization: this.cache.getUtilization().toFixed(2) + '%'
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  // Expose cache for direct access if needed
  getCache(): LRUCache<any> {
    return this.cache;
  }
}

// Get the singleton instance
const aiCache = AICacheMetrics.getInstance();

// ============================================================================
// Model Selection for Smart Multi-Model Usage
// ============================================================================

/**
 * Interface for model selection results
 */
interface ModelSelectionResult {
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
    .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks
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
const modelUsageStats: { [key: string]: number } = {
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

// Utility function to clean and match titles
function cleanAndMatchTitle(queryTitle: string, recordTitle: string): boolean {
  const cleanQuery = queryTitle.toLowerCase().trim();
  const cleanRecord = recordTitle.toLowerCase().trim();
  return cleanQuery === cleanRecord; // Simple exact match
}

// Validate that a game result matches distinctive words from the query title
function validateGameMatch(queryTitle: string, resultTitle: string): boolean {
  const queryLower = queryTitle.toLowerCase();
  const resultLower = resultTitle.toLowerCase();
  
  // Extract distinctive words from query (numbers, remake, HD, etc.)
  const distinctiveWords = queryLower
    .split(/\s+/)
    .filter(w => {
      if (/^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return true;
      if (/remake|remaster|reimagined/i.test(w)) return true;
      if (/world|part|sequel/i.test(w)) return true;
      if (/^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w)) return true;
      return false;
    })
    .map(w => w.replace(/[^a-z0-9]/g, ''));
  
  // If query has distinctive words, they MUST be in the result
  if (distinctiveWords.length > 0) {
    const allDistinctivePresent = distinctiveWords.every(dw => {
      if (dw.length > 0) {
        const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
        return wordPattern.test(resultLower);
      }
      return true;
    });
    return allDistinctivePresent;
  }
  
  // If no distinctive words, do basic matching
  return true;
}

// Example IGDB Fetch Function with Improved Filtering
export async function fetchFromIGDB(gameTitle: string): Promise<string | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();
    
    // Limit game title to 255 characters (IGDB API limit)
    const limitedTitle = gameTitle.length > 255 ? gameTitle.substring(0, 252) + '...' : gameTitle;
    
    // Escape special characters and quotes in the game title
    const sanitizedTitle = limitedTitle.replace(/"/g, '\\"');

    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      // Fetch comprehensive metadata: name, release date, platforms, developers, publishers, genres, rating
      // Increase limit to search through multiple results to find the correct match
      `search "${sanitizedTitle}";
       fields name,first_release_date,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,genres.name,rating,aggregated_rating;
       limit 10;`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (response.data && response.data.length > 0) {
      // First, try exact match
      let game = response.data.find((g: any) => cleanAndMatchTitle(gameTitle, g.name));
      
      // If exact match found, validate it has distinctive words
      if (game && !validateGameMatch(gameTitle, game.name)) {
        game = undefined; // Reject if distinctive words don't match
      }
      
      // If no exact match or exact match failed validation, try to find a match with distinctive words
      if (!game) {
        game = response.data.find((g: any) => {
          // Check if result contains the query title (or vice versa) and has distinctive words
          const gameNameLower = g.name.toLowerCase();
          const queryLower = gameTitle.toLowerCase();
          const hasBasicMatch = gameNameLower.includes(queryLower) || queryLower.includes(gameNameLower);
          return hasBasicMatch && validateGameMatch(gameTitle, g.name);
        });
      }
      
      // Check if game was found before accessing properties
      if (!game) {
        return null;
      }
      
      // Get comprehensive metadata: developers, publishers, platforms, release date, genres, rating
      const developers = game.involved_companies?.filter((ic: any) => ic.developer)
        .map((ic: any) => ic.company?.name).filter(Boolean).join(", ") || "unknown developers";
      const publishers = game.involved_companies?.filter((ic: any) => ic.publisher)
        .map((ic: any) => ic.company?.name).filter(Boolean).join(", ") || "unknown publishers";
      const platforms = game.platforms?.map((p: any) => p.name).filter(Boolean).join(", ") || "unknown platforms";
      const genres = game.genres?.map((g: any) => g.name).filter(Boolean).join(", ") || null;
      const rating = game.aggregated_rating ? Math.round(game.aggregated_rating) : (game.rating ? Math.round(game.rating) : null);
      const releaseDate = game.first_release_date 
        ? new Date(game.first_release_date * 1000).toLocaleDateString()
        : "unknown release date";

      // Build comprehensive response with all available metadata
      let gameInfo = `${game.name} was released on ${releaseDate}. It was developed by ${developers} and published by ${publishers} for ${platforms}.`;
      
      if (genres) {
        gameInfo += ` Genres: ${genres}.`;
      }
      
      if (rating) {
        gameInfo += ` Rating: ${rating}/100.`;
      }

      return gameInfo;
    }
    return null;
  } catch (error) {
    console.error("Error fetching data from IGDB:", error);
    if (axios.isAxiosError(error)) {
      console.error("IGDB API Response:", error.response?.data);
    }
    return null;
  }
}

// Fetch series data from IGDB
async function fetchSeriesFromIGDB(seriesTitle: string): Promise<any[] | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken(); // Use the correct function

    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      `fields name, release_dates.date, platforms.name; where series.name ~ "${seriesTitle}";`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`, // Use the dynamic access token
        }
      }
    );

    if (response.data && response.data.length > 0) {
      return response.data; // Return the array of game objects
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching series data from IGDB:", error);
    return null;
  }
}

// Fetch data from RAWG with enhanced matching logic
async function fetchFromRAWG(gameTitle: string): Promise<string | null> {
  try {
    // Sanitize and exact match the game title
    const sanitizedTitle = gameTitle.toLowerCase().trim();
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(sanitizedTitle)}&search_precise=true`;
    
    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      // Find exact match or close match using title comparison
      const game = response.data.results.find((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        return normalizedGameName === sanitizedTitle || 
               normalizedGameName.includes(sanitizedTitle);
      });

      if (game) {
        return `${game.name} (Released: ${game.released}, Genres: ${game.genres.map((g: any) => g.name).join(', ')}, ` +
               `Platforms: ${game.platforms.map((p: any) => p.platform.name).join(', ')}, ` +
               `URL: https://rawg.io/games/${game.slug})`;
      }
    }
    return null;
  } catch (error) {
    console.error("Error fetching data from RAWG:", error);
    return null;
  }
}

/**
 * Fetch version/release information for a game from IGDB and RAWG
 * Returns information about different platform releases, versions, and updates
 */
async function fetchVersionInfo(gameTitle: string): Promise<string | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();
    const sanitizedTitle = gameTitle.replace(/"/g, '\\"');
    
    // Fetch game with release dates for different platforms (these can indicate different versions)
    // Also fetch summary and storyline for context about the game
    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      `search "${sanitizedTitle}";
       fields name,summary,storyline,release_dates.date,release_dates.platform.name,release_dates.region,platforms.name,version_parent.name;
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
      const games = response.data.filter((g: any) => cleanAndMatchTitle(gameTitle, g.name));
      
      if (games.length === 0) {
        return null;
      }

      const mainGame = games[0];
      const versionInfo: string[] = [];
      
      // Add game summary/storyline for context (helps understand what the game is about)
      if (mainGame.summary) {
        versionInfo.push(`Game Summary: ${mainGame.summary.substring(0, 300)}${mainGame.summary.length > 300 ? '...' : ''}`);
      }
      
      // Collect platform-specific release information
      if (mainGame.release_dates && mainGame.release_dates.length > 0) {
        const platformReleases = new Map<string, string[]>();
        
        for (const release of mainGame.release_dates) {
          if (release.platform && release.date) {
            const platformName = release.platform.name || 'Unknown Platform';
            const releaseDate = new Date(release.date * 1000).toLocaleDateString();
            const region = release.region ? ` (${release.region})` : '';
            
            if (!platformReleases.has(platformName)) {
              platformReleases.set(platformName, []);
            }
            platformReleases.get(platformName)!.push(`${releaseDate}${region}`);
          }
        }
        
        if (platformReleases.size > 0) {
          versionInfo.push('Platform Releases:');
          for (const [platform, dates] of Array.from(platformReleases.entries())) {
            versionInfo.push(`- ${platform}: ${dates.join(', ')}`);
          }
        }
      }
      
      // Check for version parent (indicates this is a version/DLC of another game)
      if (mainGame.version_parent) {
        versionInfo.push(`This is a version/DLC of: ${mainGame.version_parent.name}`);
      }
      
      // Check for other versions (games with same version_parent)
      if (games.length > 1) {
        versionInfo.push(`Found ${games.length} related entries for this game.`);
      }
      
      // Also try RAWG for additional version info
      const rawgInfo = await fetchVersionInfoFromRAWG(gameTitle);
      if (rawgInfo) {
        versionInfo.push(rawgInfo);
      }
      
      // If we have platform information, add a note about potential differences
      if (mainGame.platforms && mainGame.platforms.length > 1) {
        const platformList = mainGame.platforms.map((p: any) => p.name).join(', ');
        versionInfo.push(`Note: This game is available on multiple platforms (${platformList}). Platform versions may differ in graphics, performance, controls, or features due to hardware capabilities.`);
      }
      
      return versionInfo.length > 0 ? versionInfo.join('\n') : null;
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching version info from IGDB:", error);
    return null;
  }
}

/**
 * Fetch version information from RAWG API
 */
async function fetchVersionInfoFromRAWG(gameTitle: string): Promise<string | null> {
  try {
    const sanitizedTitle = gameTitle.toLowerCase().trim();
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(sanitizedTitle)}`;
    
    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      // Get all matches (might be different versions/platforms)
      const matches = response.data.results.filter((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        return normalizedGameName === sanitizedTitle || 
               normalizedGameName.includes(sanitizedTitle) ||
               sanitizedTitle.includes(normalizedGameName);
      });

      if (matches.length > 1) {
        const versionList = matches.map((g: any) => {
          const platforms = g.platforms?.map((p: any) => p.platform.name).join(', ') || 'Unknown';
          const description = g.description_raw ? ` - ${g.description_raw.substring(0, 150)}...` : '';
          return `- ${g.name} (${platforms}, Released: ${g.released || 'TBA'})${description}`;
        }).join('\n');
        
        return `RAWG found multiple versions:\n${versionList}`;
      } else if (matches.length === 1) {
        const game = matches[0];
        const platforms = game.platforms?.map((p: any) => p.platform.name).join(', ') || 'Unknown';
        const description = game.description_raw ? `\nDescription: ${game.description_raw.substring(0, 200)}...` : '';
        return `RAWG: Available on ${platforms} (Released: ${game.released || 'TBA'})${description}`;
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching version info from RAWG:", error);
    return null;
  }
}

// Fetch series data from RAWG
async function fetchSeriesFromRAWG(seriesTitle: string): Promise<any[] | null> {
  try {
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(seriesTitle)}`;
    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      return response.data.results; // Return the array of game objects
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching series data from RAWG:", error);
    return null;
  }
}

/**
 * Extract game title from question text and/or image analysis data
 * Combines question parsing with image text/labels to find game title
 * Can identify games from screenshots even when not mentioned in question
 */
export async function extractGameTitleFromImageContext(
  question: string,
  imageLabels?: string[],
  imageText?: string
): Promise<string | undefined> {
  // First, try to extract from question (most reliable)
  const questionGameTitle = await extractGameTitleFromQuestion(question);
  if (questionGameTitle) {
    return questionGameTitle;
  }

  // If no game title in question, try to identify from image
  // Use AI to identify game from visual description
  if (imageLabels && imageLabels.length > 0 || imageText) {
    // Build a description of the image for game identification
    const imageDescription: string[] = [];
    
    if (imageLabels && imageLabels.length > 0) {
      imageDescription.push(`Visual elements detected: ${imageLabels.slice(0, 10).join(', ')}`);
    }
    
    if (imageText) {
      imageDescription.push(`Text in image: ${imageText.substring(0, 200)}`);
    }
    
    // Create a prompt to identify the game from the image
    const identificationPrompt = `Based on the following screenshot analysis, identify which video game this screenshot is from. 
    
${imageDescription.join('\n')}

Provide only the game title. If you cannot identify it with confidence, respond with "UNKNOWN".`;

    try {
      // Select model - for image identification, use default (4o) since we don't know the game yet
      // This is a lightweight operation, so 4o is sufficient
      const modelSelection = await selectModelForQuestion(undefined, question);
      
      // Log model selection for monitoring
      console.log(`[Model Selection] Using ${modelSelection.model} for image game identification (reason: ${modelSelection.reason})`);
      
      // Track model usage
      modelUsageStats[modelSelection.model] = (modelUsageStats[modelSelection.model] || 0) + 1;
      
      // Use OpenAI to identify the game from the image description
      // Note: gpt-4o-search-preview doesn't support temperature parameter
      const completionParams: any = {
        model: modelSelection.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at identifying video games from screenshots. Analyze visual elements, UI styles, character designs, art styles, and any text to determine the game title. Respond with only the game title, or "UNKNOWN" if uncertain.'
          },
          {
            role: 'user',
            content: identificationPrompt
          }
        ],
        max_completion_tokens: 100,
      };
      
      // Only include temperature for models that support it
      if (modelSelection.model !== 'gpt-4o-search-preview') {
        completionParams.temperature = 0.3; // Lower temperature for more consistent identification
      }
      
      const reqOpts = openaiRequestOptionsForModel(modelSelection.model);
      const completion = reqOpts
        ? await getOpenAIClient().chat.completions.create(completionParams, reqOpts)
        : await getOpenAIClient().chat.completions.create(completionParams);

      const identifiedGame = completion.choices[0].message.content?.trim();
      
      if (identifiedGame && 
          identifiedGame !== 'UNKNOWN' && 
          !identifiedGame.toLowerCase().includes('cannot') &&
          !identifiedGame.toLowerCase().includes('unable')) {
        
        // Validate the identified game against IGDB/RAWG
        const validated = await extractGameTitleFromQuestion(identifiedGame);
        if (validated) {
          console.log(`Game identified from image: ${validated} (original: ${identifiedGame})`);
          return validated;
        }
      }
    } catch (error) {
      console.error('Error identifying game from image:', error);
      // Fall through to text-based extraction
    }
  }

  // Fallback: Try to extract from image text directly
  if (imageText) {
    // Look for game title patterns in image text
    // Common patterns: "SONIC UNLEASHED", "Level: Eggmanland", etc.
    const gameTitlePatterns = [
      /(?:game|title|from|in)\s*:?\s*([A-Z][A-Za-z0-9\s&:'-]+?)(?:\s|$|,|\.)/i,
      /([A-Z][A-Za-z0-9\s&:'-]{3,30})\s*(?:level|stage|chapter|area|boss)/i,
    ];

    for (const pattern of gameTitlePatterns) {
      const match = imageText.match(pattern);
      if (match && match[1]) {
        const candidate = match[1].trim();
        // Skip if it's clearly not a game title
        if (candidate.length < 3 || 
            candidate.length > 50 ||
            candidate.toLowerCase().match(/^(level|stage|chapter|area|boss|item|character|time|score|rings|energy|speed)/i)) {
          continue;
        }
        
        // Validate against IGDB/RAWG
        const validated = await extractGameTitleFromQuestion(candidate);
        if (validated) {
          return validated;
        }
      }
    }
    
    // Also try to find capitalized phrases that might be game titles
    const capitalizedPhrases = imageText.match(/\b([A-Z][A-Za-z0-9\s&:'-]{2,40})\b/g);
    if (capitalizedPhrases) {
      for (const phrase of capitalizedPhrases) {
        const candidate = phrase.trim();
        // Skip if it's clearly not a game title
        if (candidate.length < 3 || 
            candidate.length > 50 ||
            candidate.toLowerCase().match(/^(level|stage|chapter|area|boss|item|character|time|score|rings|energy|speed|the|a|an|and|or|but|in|on|at|to|for|of|with|from)/i)) {
          continue;
        }
        
        // Validate against IGDB/RAWG
        const validated = await extractGameTitleFromQuestion(candidate);
        if (validated) {
          return validated;
        }
      }
    }
  }

  return undefined;
}

/**
 * Fetch game levels/items from IGDB using game ID
 * Note: IGDB doesn't have a direct "levels" endpoint, but we can search for game guides/walkthroughs
 * For now, we'll use the game's name and let the AI correlate with image context
 */
export async function fetchGameLevelsFromIGDB(gameTitle: string): Promise<string | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();
    
    // Limit game title to 255 characters (IGDB API limit)
    const limitedTitle = gameTitle.length > 255 ? gameTitle.substring(0, 252) + '...' : gameTitle;
    
    // Escape special characters and quotes in the game title
    const sanitizedTitle = limitedTitle.replace(/"/g, '\\"');

    // Search for the game first to get its ID
    const gameResponse = await axios.post(
      'https://api.igdb.com/v4/games',
      `search "${sanitizedTitle}";
       fields name,id,summary;
       limit 1;`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (gameResponse.data && gameResponse.data.length > 0) {
      const game = gameResponse.data[0];
      // Return game info that can help identify levels
      return `Game: ${game.name}. ${game.summary ? `Summary: ${game.summary.substring(0, 200)}...` : ''}`;
    }

    return null;
  } catch (error) {
    console.error("Error fetching game levels from IGDB:", error);
    return null;
  }
}

/**
 * Fetch game information from RAWG including level/item data
 * RAWG has game details that can help identify levels
 */
export async function fetchGameDetailsFromRAWG(gameTitle: string): Promise<string | null> {
  try {
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(gameTitle)}&search_precise=true`;
    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      const game = response.data.results[0];
      
      // Get detailed game info
      const detailUrl = `https://api.rawg.io/api/games/${game.id}?key=${process.env.RAWG_API_KEY}`;
      const detailResponse = await axios.get(detailUrl);
      const gameDetails = detailResponse.data;

      let info = `Game: ${gameDetails.name}`;
      if (gameDetails.description_raw) {
        // Include more of the description as it may contain level information
        info += `\nDescription: ${gameDetails.description_raw.substring(0, 500)}...`;
      }
      if (gameDetails.released) {
        info += `\nReleased: ${gameDetails.released}`;
      }
      if (gameDetails.platforms && gameDetails.platforms.length > 0) {
        info += `\nPlatforms: ${gameDetails.platforms.map((p: any) => p.platform.name).join(', ')}`;
      }
      // Include genres and tags which might help identify level themes
      if (gameDetails.genres && gameDetails.genres.length > 0) {
        info += `\nGenres: ${gameDetails.genres.map((g: any) => g.name).join(', ')}`;
      }
      if (gameDetails.tags && gameDetails.tags.length > 0) {
        const relevantTags = gameDetails.tags
          .filter((t: any) => t.language === 'eng')
          .slice(0, 5)
          .map((t: any) => t.name);
        if (relevantTags.length > 0) {
          info += `\nTags: ${relevantTags.join(', ')}`;
        }
      }

      return info;
    }

    return null;
  } catch (error) {
    console.error("Error fetching game details from RAWG:", error);
    return null;
  }
}

/**
 * Match image context to specific levels/items using game data and AI
 * This function enhances the question with game-specific context
 */
export async function enhanceQuestionWithGameContext(
  question: string,
  gameTitle: string | undefined,
  imageLabels?: string[],
  imageText?: string
): Promise<string> {
  if (!gameTitle) {
    // No game title, return original question with image context
    const imageContext: string[] = [];
    if (imageLabels && imageLabels.length > 0) {
      imageContext.push(`Visual elements: ${imageLabels.slice(0, 5).join(', ')}`);
    }
    if (imageText) {
      imageContext.push(`Text in image: ${imageText.substring(0, 200)}${imageText.length > 200 ? '...' : ''}`);
    }
    return imageContext.length > 0 
      ? `${question}\n\n[Image context: ${imageContext.join('. ')}]`
      : question;
  }

  // Fetch game data from IGDB and RAWG
  const [igdbData, rawgData] = await Promise.allSettled([
    fetchGameLevelsFromIGDB(gameTitle),
    fetchGameDetailsFromRAWG(gameTitle)
  ]);

  const igdbInfo = igdbData.status === 'fulfilled' ? igdbData.value : null;
  const rawgInfo = rawgData.status === 'fulfilled' ? rawgData.value : null;

  // Build enhanced context with specific instructions for level/item identification
  const contextParts: string[] = [];
  
  // Add instruction for level/item identification
  const isLevelQuestion = question.toLowerCase().includes('level') || 
                         question.toLowerCase().includes('stage') ||
                         question.toLowerCase().includes('area') ||
                         question.toLowerCase().includes('chapter');
  const isItemQuestion = question.toLowerCase().includes('item') ||
                        question.toLowerCase().includes('weapon') ||
                        question.toLowerCase().includes('equipment');
  const isGameQuestion = question.toLowerCase().includes('what game') ||
                        question.toLowerCase().includes('which game') ||
                        question.toLowerCase().includes('what is this from');
  
  if (isLevelQuestion) {
    contextParts.push(`IMPORTANT: The user is asking about a specific level/stage. Use the image analysis and game information below to identify the exact level name shown in the image.`);
  } else if (isItemQuestion) {
    contextParts.push(`IMPORTANT: The user is asking about a specific item. Use the image analysis and game information below to identify the exact item shown in the image.`);
  } else if (isGameQuestion || !question.toLowerCase().includes(gameTitle.toLowerCase())) {
    contextParts.push(`IMPORTANT: The user wants to identify the game from the screenshot. Use the visual elements, UI styles, character designs, and text to determine the game title.`);
  }
  
  contextParts.push(`Game: ${gameTitle}`);
  
  if (imageLabels && imageLabels.length > 0) {
    // Include more labels for better visual context (up to 15 for detailed analysis)
    const relevantLabels = imageLabels.slice(0, 15);
    contextParts.push(`Image visual analysis (detailed): ${relevantLabels.join(', ')}`);
    // Also provide a summary of key visual elements
    const keyElements = imageLabels.filter(label => 
      !label.toLowerCase().includes('game') && 
      !label.toLowerCase().includes('software') &&
      !label.toLowerCase().includes('technology')
    ).slice(0, 10);
    if (keyElements.length > 0) {
      contextParts.push(`Key visual elements: ${keyElements.join(', ')}`);
    }
  }
  
  if (imageText) {
    const textPreview = imageText.substring(0, 400);
    contextParts.push(`Text extracted from image: "${textPreview}${imageText.length > 400 ? '...' : ''}"`);
    // Also extract any potential level names or identifiers from the text
    const levelNamePatterns = [
      /(?:level|stage|area|act|chapter)[\s:]+([A-Z][A-Za-z0-9\s&:'-]+)/i,
      /([A-Z][A-Za-z0-9\s&:'-]{3,30})(?:\s+(?:act|part|chapter|level|stage))/i,
    ];
    for (const pattern of levelNamePatterns) {
      const match = imageText.match(pattern);
      if (match && match[1]) {
        const potentialLevelName = match[1].trim();
        if (potentialLevelName.length > 2 && potentialLevelName.length < 50) {
          contextParts.push(`Potential level identifier found in text: "${potentialLevelName}"`);
        }
      }
    }
  }

  if (igdbInfo) {
    contextParts.push(`Game information (IGDB): ${igdbInfo}`);
  }

  if (rawgInfo) {
    contextParts.push(`Game details (RAWG): ${rawgInfo}`);
  }

  // Add specific instruction for level identification
  if (isLevelQuestion) {
    contextParts.push(`CRITICAL: Identify the exact level name by analyzing the specific visual features shown in the image. Do not make generic guesses based on UI elements alone. Focus on:
- Specific environment details (futuristic city vs desert vs ruins vs ice, etc.)
- Distinctive landmarks or structures visible in the image
- Unique color palettes and lighting
- Architecture style and setting
- Any text that might indicate the level name
- Character appearances and their context
Compare these specific visual details against your knowledge of the game's levels. Be precise and base your answer on the actual visual content, not general patterns.`);
  }

  return `${question}\n\n[Context for identification: ${contextParts.join('. ')}]`;
}

// Extract series name from question
function extractSeriesName(question: string): string | null {
  const seriesPattern = /list all of the games in the (.+?) series/i;
  const match = question.match(seriesPattern);
  return match ? match[1] : null;
}

// Filter the game list to only include the games from the correct series
function filterGameSeries(games: any[], seriesPrefix: string): any[] {
  return games.filter((game) => game.name.toLowerCase().startsWith(seriesPrefix.toLowerCase()));
}

/**
 * Get chat completion with vision support (like ChatGPT)
 * Can accept images directly for multimodal analysis
 */
export const getChatCompletionWithVision = async (
  question: string,
  imageUrl?: string,
  imageBase64?: string,
  systemMessage?: string
): Promise<string | null> => {
  try {
    const messages: any[] = [
      {
        role: 'system',
        content: systemMessage || 'You are an expert video game assistant specializing in identifying games, levels, stages, items, and locations from screenshots. Analyze images carefully and provide detailed, accurate information.'
      },
      {
        role: 'user',
        content: []
      }
    ];

    // Add image if provided
    if (imageUrl || imageBase64) {
      const imageContent: any = {
        type: 'image_url',
        image_url: {}
      };

      if (imageUrl) {
        imageContent.image_url.url = imageUrl;
      } else if (imageBase64) {
        // Format: data:image/jpeg;base64,{base64_string}
        imageContent.image_url.url = imageBase64.startsWith('data:') 
          ? imageBase64 
          : `data:image/jpeg;base64,${imageBase64}`;
      }

      messages[1].content.push(imageContent);
    }

    // Add text question
    messages[1].content.push({
      type: 'text',
      text: question
    });

    // For vision requests, we MUST use a model that supports images
    // gpt-4o-search-preview does NOT support image inputs
    // Use gpt-4o or gpt-4o-mini for vision requests instead
    const VISION_MODELS = {
      'gpt-4o': 'gpt-4o',           // Full vision support
      'gpt-4o-mini': 'gpt-4o-mini', // Full vision support, cheaper
      'gpt-5.2': 'gpt-5.2'          // If available, supports vision
    };
    
    // Select model based on game release date (extract from question if possible)
    const modelSelection = await selectModelForQuestion(undefined, question);
    
    // Override to vision-capable model if the selected model doesn't support images
    let visionModel = modelSelection.model;
    if (visionModel === 'gpt-4o-search-preview') {
      // Fallback to gpt-4o for vision (it supports images and has good knowledge)
      visionModel = 'gpt-4o';
      console.log(`[Model Selection] Overriding to gpt-4o for vision request (gpt-4o-search-preview doesn't support images)`);
    } else if (!Object.values(VISION_MODELS).includes(visionModel as any)) {
      // If selected model isn't in our vision-capable list, use gpt-4o as safe default
      visionModel = 'gpt-4o';
      console.log(`[Model Selection] Overriding to gpt-4o for vision request (${modelSelection.model} may not support images)`);
    }
    
    // Log model selection for monitoring
    console.log(`[Model Selection] Using ${visionModel} for vision request (reason: ${modelSelection.reason}, original: ${modelSelection.model})`);
    
    // Track model usage
    modelUsageStats[visionModel] = (modelUsageStats[visionModel] || 0) + 1;

    // Note: gpt-4o-search-preview doesn't support temperature parameter, but we're not using it for vision
    const completionParams: any = {
      model: visionModel,
      messages: messages as any,
      max_completion_tokens: 1000,
      temperature: 0.7, // Vision models support temperature
    };

    try {
      const completion = await getOpenAIClient().chat.completions.create(completionParams);
      return completion.choices[0].message.content;
    } catch (apiError: any) {
      // Handle rate limit errors specifically
      if (apiError?.status === 429 && apiError?.error?.type === 'input-images') {
        console.error('[Vision API] Rate limit error for image inputs. Model may not support images:', visionModel);
        
        // Try fallback to gpt-4o if we're not already using it
        if (visionModel !== 'gpt-4o') {
          console.log('[Vision API] Retrying with gpt-4o fallback...');
          try {
            const fallbackParams = {
              ...completionParams,
              model: 'gpt-4o',
            };
            const fallbackCompletion = await getOpenAIClient().chat.completions.create(fallbackParams);
            modelUsageStats['gpt-4o'] = (modelUsageStats['gpt-4o'] || 0) + 1;
            return fallbackCompletion.choices[0].message.content;
          } catch (fallbackError) {
            console.error('[Vision API] Fallback also failed:', fallbackError);
            throw new Error('Unable to process image. The selected AI model does not support image inputs. Please try again or contact support if this persists.');
          }
        } else {
          throw new Error('Rate limit exceeded for image processing. Please try again in a moment.');
        }
      }
      // Re-throw other errors
      throw apiError;
    }
  } catch (error: any) {
    console.error('Error in getChatCompletionWithVision:', error);
    
    // Provide user-friendly error message
    if (error?.message?.includes('rate limit') || error?.message?.includes('Rate limit')) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    } else if (error?.message?.includes('does not support image')) {
      throw error; // Already user-friendly
    } else {
      throw new Error('Failed to process image. Please try again or contact support if this persists.');
    }
  }
};

// Get chat completion for user questions
export const getChatCompletion = async (question: string, systemMessage?: string): Promise<string | null> => {
  try {
    // Normalize question for cache key (lowercase, trim) to match usage in assistant.ts
    // This ensures consistent cache keys across the codebase
    const normalizedQuestion = question.toLowerCase().trim();
    const normalizedSystemMessage = (systemMessage || 'default').toLowerCase().trim();
    
    // Generate a cache key based on the normalized question and system message
    const cacheKey = `chat:${normalizedQuestion}:${normalizedSystemMessage}`;
    
    // Check if we have a cached response
    const cachedResponse = aiCache.get(cacheKey);
    if (cachedResponse) {
      // console.log('Cache hit for chat completion:', question.substring(0, 30) + '...'); // Commented out for production
      return cachedResponse;
    }

    if (question.toLowerCase().includes("list all of the games in the")) {
      const seriesTitle = extractSeriesName(question);
      if (seriesTitle) {
        let games = await fetchSeriesFromIGDB(seriesTitle);
        if (!games) {
          games = await fetchSeriesFromRAWG(seriesTitle);
        }

        if (games && games.length > 0) {
          const filteredGames = filterGameSeries(games, seriesTitle);
          if (filteredGames.length > 0) {
            const gameList = filteredGames.map((game, index) => 
              `${index + 1}. ${game.name} (Released: ${game.release_dates ? new Date(game.release_dates[0].date * 1000).toLocaleDateString() : "Unknown release date"}, Platforms: ${game.platforms ? game.platforms.map((p: any) => p.name).join(", ") : "Unknown platforms"})`
            );
            return gameList.join("\n");
          }
        }
        return "Sorry, I couldn't find any information about that series.";
      } else {
        return "Sorry, I couldn't identify the series name from your question.";
      }
    }

    // Determine if this is a factual metadata question (can use IGDB/RAWG) or a specific gameplay question (needs OpenAI)
    const lowerQuestion = question.toLowerCase();
    
    // Factual metadata questions that IGDB/RAWG can answer:
    // - Release dates, platforms, developers, publishers, genres, ratings, etc.
    const isMetadataQuestion = /when (was|is|did)|release date|released|came out|what (platform|system|console|developer|publisher|studio|company|year|genre|genres|rating|score|metacritic)|who (developed|published|made|created)|which (platform|system|console|genre)|is.*available (on|for)|can.*play (on|for)/i.test(lowerQuestion);
    
    // Check for specific gameplay questions (items, mechanics, strategies, etc.)
    // This includes questions about brands, items, characters, strategies, unlocks, comparisons, etc.
    // These need OpenAI's knowledge base, not just metadata APIs
    const isSpecificQuestion = /(what|which|how|where|who|list|name|are|is).*(brand|brands|item|items|weapon|weapons|armor|equipment|character|characters|strategy|strategies|tip|tips|unlock|unlocks|obtain|get|find|catch|defeat|beat|complete|solve|build|class|classes|skill|skills|ability|abilities|mechanic|mechanics|feature|features|difference|differences|compare|comparison|version|versions|edition|editions|best|fastest|strongest|weakest|available|different|types|kinds|ways|methods|approaches|location|locations|boss|bosses|enemy|enemies|quest|quests|mission|missions)/i.test(lowerQuestion) || 
                               /(difference|differences|compare|comparison|between|versus|vs).*(version|versions|edition|editions|platform|platforms|console|consoles)/i.test(lowerQuestion);
    
    let response: string | null = null;
    let apiResultQuality: 'good' | 'questionable' | 'none' = 'none';
    
    // For factual metadata questions, try IGDB/RAWG first (they have accurate metadata)
    if (isMetadataQuestion && !isSpecificQuestion) {
      const extractedGameTitle = await extractGameTitleFromQuestion(question);
      const searchQuery = extractedGameTitle || question;
      
      // Limit search query to 255 characters (IGDB limit) and extract just the game title part
      const limitedQuery = searchQuery.length > 255 
        ? (extractedGameTitle || searchQuery.substring(0, 252) + '...')
        : searchQuery;
      
      // Try IGDB first
      response = await fetchFromIGDB(limitedQuery);
      if (response) {
        // Validate that the result matches the extracted game title
        const questionLower = question.toLowerCase();
        const responseLower = response.toLowerCase();
        const extractedTitleLower = (extractedGameTitle || '').toLowerCase();
        
        // Extract key words from the game title (excluding common words)
        const extractKeyWords = (title: string): string[] => {
          const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by']);
          return title
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 2 && !commonWords.has(w))
            .map(w => w.replace(/[^a-z0-9]/g, ''));
        };
        
        const titleKeyWords = extractKeyWords(extractedTitleLower || questionLower);
        const responseKeyWords = extractKeyWords(responseLower);
        
        // Check if response contains key words from the game title
        const matchingWords = titleKeyWords.filter(word => 
          responseKeyWords.some(rw => rw.includes(word) || word.includes(rw))
        );
        
        // Check if response starts with or prominently contains the game name
        // The response format from fetchFromIGDB is: "[Game Name] was released on..."
        const responseStartsWithTitle = responseLower.startsWith(extractedTitleLower) || 
                                       responseLower.includes(` ${extractedTitleLower} `) ||
                                       responseLower.includes(` ${extractedTitleLower} was`);
        
        // Require at least 2 matching key words (or 1 if title is short)
        // OR response starts with the game title (strong indicator)
        const minMatches = titleKeyWords.length <= 3 ? 1 : 2;
        const hasTitleMatch = responseStartsWithTitle || matchingWords.length >= minMatches;
        
        // Check if question or extracted title mentions remake/remaster/sequel/version but response doesn't match
        const hasRemake = /remake|remaster|reimagined/i.test(questionLower) || /remake|remaster|reimagined/i.test(extractedTitleLower);
        const hasSequel = /\b(2|ii|3|iii|4|iv|world\s*2|world\s*ii)\b/i.test(questionLower) || /\b(2|ii|3|iii|4|iv|world\s*2|world\s*ii)\b/i.test(extractedTitleLower);
        const hasVersion = /\b(hd|4k|definitive|edition|deluxe|ultimate|complete|collection)\b/i.test(questionLower) || /\b(hd|4k|definitive|edition|deluxe|ultimate|complete|collection)\b/i.test(extractedTitleLower);
        const responseHasRemake = /remake|remaster|reimagined/i.test(responseLower);
        const responseHasSequel = /\b(2|ii|3|iii|4|iv|world\s*2|world\s*ii)\b/i.test(responseLower);
        const responseHasVersion = /\b(hd|4k|definitive|edition|deluxe|ultimate|complete|collection)\b/i.test(responseLower);
        
        // Check for conflicting game titles - if response mentions a different game that shares some words
        // but is clearly different (e.g., "Resident Evil Archives" vs "Resident Evil 4 Remake")
        // Extract distinctive words from the title (numbers, remake/remaster, version indicators, specific identifiers)
        const distinctiveWords = extractedTitleLower
          .split(/\s+/)
          .filter(w => /^\d+$/.test(w) || /remake|remaster|reimagined|world|part|ii|iii|iv|v|^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w))
          .map(w => w.replace(/[^a-z0-9]/g, ''));
        
        // Check if response is missing distinctive words that should be present
        const missingDistinctive = distinctiveWords.some(dw => {
          if (dw.length > 0) {
            // Check if this distinctive word appears in the response
            const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
            return !wordPattern.test(responseLower);
          }
          return false;
        });
        
        // Also check if response contains words that contradict the title
        // (e.g., if title has "4" but response has "Archives" without "4")
        const hasConflict = missingDistinctive && distinctiveWords.length > 0;
        
        // Mark as questionable if:
        // 1. Response doesn't match the game title key words
        // 2. Question mentions remake/sequel/version but response doesn't
        // 3. Response contains conflicting game titles
        if (!hasTitleMatch || (hasRemake && !responseHasRemake) || (hasSequel && !responseHasSequel) || (hasVersion && !responseHasVersion) || hasConflict) {
          apiResultQuality = 'questionable';
        } else {
          apiResultQuality = 'good';
        }
      }
      
      // Try RAWG if IGDB failed or returned questionable result
      if (!response || apiResultQuality === 'questionable') {
        const rawgResponse = await fetchFromRAWG(limitedQuery);
        if (rawgResponse && !rawgResponse.includes("Failed") && !rawgResponse.includes("No games found")) {
          // Validate RAWG result with the same logic as IGDB
          const questionLower = question.toLowerCase();
          const rawgLower = rawgResponse.toLowerCase();
          const extractedTitleLower = (extractedGameTitle || '').toLowerCase();
          
          // Extract key words from the game title
          const extractKeyWords = (title: string): string[] => {
            const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by']);
            return title
              .toLowerCase()
              .split(/\s+/)
              .filter(w => w.length > 2 && !commonWords.has(w))
              .map(w => w.replace(/[^a-z0-9]/g, ''));
          };
          
          const titleKeyWords = extractKeyWords(extractedTitleLower || questionLower);
          const rawgKeyWords = extractKeyWords(rawgLower);
          
          // Check if response contains key words from the game title
          const matchingWords = titleKeyWords.filter(word => 
            rawgKeyWords.some(rw => rw.includes(word) || word.includes(rw))
          );
          
          // Check if response starts with or prominently contains the game name
          const rawgStartsWithTitle = rawgLower.startsWith(extractedTitleLower) || 
                                     rawgLower.includes(` ${extractedTitleLower} `) ||
                                     rawgLower.includes(`(${extractedTitleLower}`);
          
          const minMatches = titleKeyWords.length <= 3 ? 1 : 2;
          const hasTitleMatch = rawgStartsWithTitle || matchingWords.length >= minMatches;
          
          const hasRemake = /remake|remaster|reimagined/i.test(questionLower) || /remake|remaster|reimagined/i.test(extractedTitleLower);
          const hasSequel = /\b(2|ii|3|iii|4|iv|world\s*2|world\s*ii)\b/i.test(questionLower) || /\b(2|ii|3|iii|4|iv|world\s*2|world\s*ii)\b/i.test(extractedTitleLower);
          const hasVersion = /\b(hd|4k|definitive|edition|deluxe|ultimate|complete|collection)\b/i.test(questionLower) || /\b(hd|4k|definitive|edition|deluxe|ultimate|complete|collection)\b/i.test(extractedTitleLower);
          const rawgHasRemake = /remake|remaster|reimagined/i.test(rawgLower);
          const rawgHasSequel = /\b(2|ii|3|iii|4|iv|world\s*2|world\s*ii)\b/i.test(rawgLower);
          const rawgHasVersion = /\b(hd|4k|definitive|edition|deluxe|ultimate|complete|collection)\b/i.test(rawgLower);
          
          // Check for conflicting game titles using the same logic as IGDB
          const distinctiveWords = extractedTitleLower
            .split(/\s+/)
            .filter(w => /^\d+$/.test(w) || /remake|remaster|reimagined|world|part|ii|iii|iv|v|^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w))
            .map(w => w.replace(/[^a-z0-9]/g, ''));
          
          const missingDistinctive = distinctiveWords.some(dw => {
            if (dw.length > 0) {
              const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
              return !wordPattern.test(rawgLower);
            }
            return false;
          });
          
          const hasConflict = missingDistinctive && distinctiveWords.length > 0;
          
          if (hasTitleMatch && !((hasRemake && !rawgHasRemake) || (hasSequel && !rawgHasSequel) || (hasVersion && !rawgHasVersion)) && !hasConflict) {
            response = rawgResponse;
            apiResultQuality = 'good';
          } else {
            apiResultQuality = 'questionable';
          }
        }
      }
    }
    
    // For specific gameplay questions, or if IGDB/RAWG didn't return good data, use OpenAI
    // Also use OpenAI for factual questions if API results are questionable or missing
    // This ensures we get accurate, up-to-date answers
    if (!response || isSpecificQuestion || apiResultQuality === 'questionable') {
      // For specific questions or metadata questions with questionable API results, enhance the prompt
      let enhancedQuestion = question;
      let gameTitleForContext: string | undefined;
      
      // For metadata questions with questionable/missing API results, use OpenAI with enhanced prompt
      if (isMetadataQuestion && !isSpecificQuestion && (apiResultQuality === 'questionable' || !response)) {
        const extractedGameTitle = await extractGameTitleFromQuestion(question);
        gameTitleForContext = extractedGameTitle;
        
        if (extractedGameTitle) {
          // Check if the game title contains remake/remaster/sequel/version indicators
          const titleLower = extractedGameTitle.toLowerCase();
          const hasRemake = /remake|remaster|reimagined/i.test(titleLower);
          const hasSequel = /\b(2|ii|3|iii|4|iv|5|v|world\s*2|world\s*ii|sequel|part\s*2|part\s*ii)\b/i.test(titleLower);
          const hasVersion = /\b(hd|4k|definitive|edition|deluxe|ultimate|complete|collection)\b/i.test(titleLower);
          
          // Build a dynamic prompt that emphasizes accuracy and correct game identification
          // Make it VERY explicit and repetitive to prevent confusion
          let instructions = `⚠️ CRITICAL: The user is asking about "${extractedGameTitle}" ⚠️

YOU MUST ANSWER ABOUT THIS EXACT GAME: "${extractedGameTitle}"

DO NOT confuse "${extractedGameTitle}" with:
- Other games in the same series
- Earlier or later versions
- Remakes, remasters, or ports of different games
- Games with similar names

IMPORTANT INSTRUCTIONS:
1. The game you MUST answer about is: "${extractedGameTitle}"
2. Answer ONLY about "${extractedGameTitle}" - nothing else
3. If you see any information about a different game, IGNORE IT and answer only about "${extractedGameTitle}"`;
          
          if (hasRemake) {
            instructions += `\n4. The title "${extractedGameTitle}" contains "Remake/Remaster/Reimagined" - you MUST answer about THIS specific remake/remaster, NOT the original game
5. Do NOT provide information about the original game - only about "${extractedGameTitle}"`;
          }
          
          if (hasSequel) {
            instructions += `\n4. The title "${extractedGameTitle}" contains a sequel indicator - you MUST answer about THIS specific sequel, NOT earlier games
5. Do NOT provide information about earlier games in the series - only about "${extractedGameTitle}"`;
          }
          
          if (hasVersion) {
            instructions += `\n4. The title "${extractedGameTitle}" contains a version indicator (HD, 4K, Definitive Edition, etc.) - you MUST answer about THIS specific version, NOT other versions
5. Do NOT provide information about other versions of the game - only about "${extractedGameTitle}"`;
          }
          
          if (hasRemake || hasSequel || hasVersion) {
            instructions += `\n6. If you find information about multiple games, ONLY use information that specifically matches "${extractedGameTitle}"
7. Reject any information that is about a different game, even if it's in the same series
8. If the title contains "HD", the answer MUST be about the HD version, NOT the original or other versions`;
          }
          
          instructions += `\n8. Provide accurate release dates, platforms, developers, and publishers for "${extractedGameTitle}" ONLY
9. If you're not certain about information for "${extractedGameTitle}", clearly state that rather than guessing or providing information about a different game
10. Be precise - the game title is "${extractedGameTitle}" - use this exact title in your response
11. IGNORE any information you might have about similar-sounding games - only use information that is specifically about "${extractedGameTitle}"
12. If you find yourself thinking about a different game, STOP and refocus on "${extractedGameTitle}" ONLY

REMEMBER: Answer ONLY about "${extractedGameTitle}". Do not confuse it with any other game. The user's question is specifically about "${extractedGameTitle}".`;
          
          enhancedQuestion = `User's Question: ${question}

${instructions}

⚠️ FINAL REMINDER: The user is asking about "${extractedGameTitle}". Answer ONLY about this game. Do not mention or provide information about any other game, even if it has a similar name.

RESPONSE FORMAT:
- Start your response by confirming you're answering about "${extractedGameTitle}"
- Then provide the factual information requested
- Do NOT say "I understand your question is about [different game]" - the question is about "${extractedGameTitle}"

Now please provide a detailed, accurate answer about "${extractedGameTitle}" based on the user's question above.`;
        } else {
          enhancedQuestion = `Question: ${question}

Please provide accurate, factual information. Make sure to identify the correct game title from the question and answer about that specific game. If the question mentions a remake, remaster, or sequel, make sure your answer is about that specific version.`;
        }
      } else if (isSpecificQuestion) {
        const extractedGameTitle = await extractGameTitleFromQuestion(question);
        gameTitleForContext = extractedGameTitle;
        
        // Check if this is a version comparison question
        const isVersionQuestion = /(version|versions|edition|editions|difference|differences|compare|comparison|between).*(version|versions|edition|editions|platform|platforms)/i.test(lowerQuestion);
        
        if (extractedGameTitle) {
          // For version questions, fetch detailed version information
          if (isVersionQuestion) {
            const versionInfo = await fetchVersionInfo(extractedGameTitle);
            const gameContext = await fetchFromIGDB(extractedGameTitle) || await fetchFromRAWG(extractedGameTitle);
            
            if (versionInfo || gameContext) {
              let contextParts = [];
              if (gameContext) contextParts.push(`Game Context: ${gameContext}`);
              if (versionInfo) contextParts.push(`Version/Release Information:\n${versionInfo}`);
              
              enhancedQuestion = `Question: ${question}\n\nGame: ${extractedGameTitle}\n${contextParts.join('\n\n')}\n\nPlease provide a detailed answer about the differences between versions/editions/platforms of ${extractedGameTitle}. 

IMPORTANT INSTRUCTIONS:
- Use the platform and release information provided above to identify which platforms/versions exist
- For each platform/version mentioned, explain specific differences in:
  * Gameplay mechanics (controls, features, mechanics)
  * Graphics and performance (visual quality, frame rate, resolution)
  * Content (exclusive features, DLC, updates)
  * Hardware requirements and capabilities
- Be specific and factual - base your answer on the platform information provided
- If the version information shows different platforms, explain how hardware differences affect gameplay mechanics
- Avoid generic statements - use the actual platform names and release dates from the information above`;
            } else {
              enhancedQuestion = `Question: ${question}\n\nGame: ${extractedGameTitle}\n\nPlease provide a detailed answer about the differences between versions/editions/platforms of ${extractedGameTitle}. If you don't have specific information about version differences, clearly state that rather than providing generic information.`;
            }
          } else {
            // For non-version questions, use standard game context
            const gameContext = await fetchFromIGDB(extractedGameTitle) || await fetchFromRAWG(extractedGameTitle);
            if (gameContext) {
              // Add game context to help the AI provide accurate answers
              enhancedQuestion = `Question: ${question}\n\nGame: ${extractedGameTitle}\nGame Context: ${gameContext}\n\nPlease provide a detailed, accurate answer to the question about ${extractedGameTitle}. Focus on the specific game mentioned and be factual.`;
            } else {
              // Even without API context, emphasize the game title
              enhancedQuestion = `Question: ${question}\n\nGame: ${extractedGameTitle}\n\nPlease provide a detailed answer about ${extractedGameTitle}. Be specific and factual. If you don't have specific information about this game or its versions, clearly state that rather than providing generic information.`;
            }
          }
        }
      }
      
      // Enhanced system message for better answer quality
      const enhancedSystemMessage = systemMessage || `You are Video Game Wingman, an expert AI assistant specializing in video games.

RESPONSE FORMAT - ALWAYS follow this structure:
- Use ## for main section headings (e.g., ## Recommended Loadout, ## Phase One, ## General Tips)
- Use - for bullet points under each section
- Use **bold** only for key terms or sub-labels within a bullet (e.g., "- **Weapon:** Spread Shot")
- Do NOT use bold for standalone section headings — use ## instead
- Keep each section clearly separated; do not run sections together as plain paragraphs
- For boss guides or multi-phase content, give each phase its own ## section

CRITICAL INSTRUCTIONS - READ CAREFULLY:
- ALWAYS identify and use the EXACT game title from the question - do NOT substitute it with a different game
- If the question specifies a game title (especially in the user's message), you MUST answer about THAT exact game, nothing else
- If the question mentions "Remake", "Remaster", or a specific sequel number (like "2", "World 2", "II", "4"), answer about THAT specific version ONLY
- NEVER confuse similar game titles - if asked about "Resident Evil 4 Remake", do NOT answer about "Resident Evil Archives" or any other Resident Evil game
- If you see conflicting information or are unsure, use the EXACT game title from the user's question
- ALWAYS prioritize the game title as specified in the question over any other information you might have
- For factual metadata questions (release dates, platforms, developers), provide precise, up-to-date information for the EXACT game asked about
- Be specific and factual - cite specific features, mechanics, or details when possible
- If you don't have specific information about the exact game asked about, clearly state that rather than providing information about a different game
- NEVER provide information about a different game, even if it's in the same series or has a similar name
- Pay special attention to remakes, remasters, and sequels - make sure you're answering about the EXACT version specified
${gameTitleForContext ? `\n⚠️ IMPORTANT: The user is asking about "${gameTitleForContext}" - you MUST answer about this exact game, not any other game with a similar name ⚠️` : ''}`;
      
      // Select model based on game release date
      const modelSelection = await selectModelForQuestion(gameTitleForContext, question);
      
      // Log model selection for monitoring
      console.log(`[Model Selection] Using ${modelSelection.model} for "${gameTitleForContext || 'unknown game'}" (reason: ${modelSelection.reason}${modelSelection.releaseYear ? `, released: ${modelSelection.releaseYear}` : ''})`);
      
      // Track model usage
      modelUsageStats[modelSelection.model] = (modelUsageStats[modelSelection.model] || 0) + 1;
      
      const completionParams = {
        model: modelSelection.model,
        messages: [
          { role: 'system' as const, content: enhancedSystemMessage },
          { role: 'user' as const, content: enhancedQuestion },
        ],
        max_completion_tokens: 800,
      };
      const reqOpts = openaiRequestOptionsForModel(modelSelection.model);
      const completion = reqOpts
        ? await getOpenAIClient().chat.completions.create(completionParams, reqOpts)
        : await getOpenAIClient().chat.completions.create(completionParams);

      response = completion.choices[0].message.content;

      // If primary model returned no content, fall back to gpt-4o-search-preview
      // (which can browse the web for very new games the primary model may not know)
      if (!response && modelSelection.model !== 'gpt-4o-search-preview') {
        console.log(`[Model Selection] ${modelSelection.model} returned no content, falling back to gpt-4o-search-preview`);
        const fallbackCompletion = await getOpenAIClient().chat.completions.create(
          { ...completionParams, model: 'gpt-4o-search-preview' },
          { timeout: 120_000, maxRetries: 0 }
        );
        response = fallbackCompletion.choices[0].message.content;
      }
    }

    // Cache the response if we got one
    if (response) {
      aiCache.set(cacheKey, response);
    }

    return response;
  } catch (error) {
    console.error('Error in getChatCompletion:', error);
    return null;
  }
};

// Analyze user questions and map them to game genres
export const analyzeUserQuestions = (questions: Array<{ question: string, response: string }>): string[] => {
  const genres: { [key: string]: number } = {};

  // Genre mapping object
  const genreMapping: { [key: string]: string } = {
    "rpg": "Role-Playing Game",
    "role-playing": "Role-Playing Game",
    "first-person shooter": "First-Person Shooter",
    "third-person shooter": "Third-Person Shooter",
    "top-down shooter": "Top-Down Shooter",
    "fps": "First-Person Shooter",
    "action-adventure": "Action-Adventure",
    "platformer": "Platformer",
    "strategy": "Strategy",
    "puzzle": "Puzzle",
    "puzzle-platformer": "Puzzle-Platformer",
    "simulation": "Simulation",
    "sports": "Sports",
    "racing": "Racing",
    "fighting": "Fighting",
    "adventure": "Adventure",
    "horror": "Horror",
    "survival": "Survival",
    "sandbox": "Sandbox",
    "mmo": "Massively Multiplayer Online",
    "mmorpg": "Massively Multiplayer Online Role-Playing Game",
    "battle royale": "Battle Royale",
    "open world": "Open World",
    "stealth": "Stealth",
    "rhythm": "Rhythm",
    "party": "Party",
    "visual novel": "Visual Novel",
    "indie": "Indie",
    "arcade": "Arcade",
    "shooter": "Shooter",
    "text-based": "Text Based",
    "turn-based tactics": "Turn-Based Tactics",
    "real-time strategy": "Real-Time Strategy",
    "tactical rpg": "Tactical RPG",
    "tactical role-playing game": "Tactical Role-Playing Game",
    "artillery": "Artillery",
    "endless runner": "Endless Runner",
    "tile-matching": "Tile-Matching",
    "hack and slash": "Hack and Slash",
    "4X": "4X",
    "moba": "Multiplayer Online Battle Arena",
    "multiplayer online battle arena": "Multiplayer Online Battle Arena",
    "maze": "Maze",
    "tower defense": "Tower Defense",
    "digital collectible card game": "Digital Collectible Card Game",
    "roguelike": "Roguelike",
    "point and click": "Point and Click",
    "social simulation": "Social Simulation",
    "interactive story": "Interactive Story",
    "level editor": "Level Editor",
    "game creation system": "Game Creation System",
    "exergaming": "Exergaming",
    "exercise": "Exergaming",
    "run and gun": "Run and Gun",
    "rail shooter": "Rail Shooter",
    "beat 'em up": "Beat 'em up",
    "metroidvania": "Metroidvania",
    "survival horror": "Survival Horror",
    "action rpg": "Action Role-Playing Game",
    "action role-playing game": "Action Role-Playing Game",
    "immersive sim": "Immersive Sim",
    "Construction and management simulation": "Construction and Management Simulation",
    "vehicle simulation": "Vehicle Simulation",
    "real-time tactics": "Real-Time Tactics",
    "grand strategy": "Grand Strategy",
    "gacha": "Gacha",
    "photography": "Photography",
    "idle": "Incremental",
    "incremental": "Incremental",
    "mmofps": "Massively Multiplayer Online First-Person Shooter",
    "mmorts": "Massively Multiplayer Online Real-Time Strategy",
    "mmotbs": "Massively Multiplayer Online Turn-Based Strategy",
  };

  // Loop through each question and count the occurrences of each genre based on keywords
  questions.forEach(({ question }) => {
    Object.keys(genreMapping).forEach(keyword => {
      if (question.toLowerCase().includes(keyword.toLowerCase())) {
        const genre = genreMapping[keyword];
        genres[genre] = (genres[genre] || 0) + 1;
      }
    });
  });

  // Sort genres by frequency in descending order
  return Object.keys(genres).sort((a, b) => genres[b] - genres[a]);
};

/**
 * Check if a game is released (not in the future)
 */
function isGameReleased(game: any): boolean {
  if (!game.released) {
    return false; // No release date = likely unreleased
  }
  
  try {
    const releaseDate = new Date(game.released);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of today
    
    // Game is released if release date is today or in the past
    return releaseDate <= today;
  } catch (error) {
    return false; // Invalid date = assume unreleased
  }
}

// Fetch game recommendations based on genre
// Note: RAWG API accepts genre slugs (e.g., "racing", "action", "rpg") or genre IDs
// Filters out unreleased games
export const fetchRecommendations = async (
  genre: string, 
  options?: { 
    forBeginners?: boolean; 
    currentPopular?: boolean;
    userQuery?: string;
  }
): Promise<string[]> => {
  const { forBeginners = false, currentPopular = false, userQuery } = options || {};
  
  // Map genre names to RAWG genre slugs
  const genreSlugMap: { [key: string]: string } = {
    'Platformer': 'platformer',
    'RPG': 'role-playing-games-rpg',
    'Action': 'action',
    'Adventure': 'adventure',
    'Strategy': 'strategy',
    'Puzzle': 'puzzle',
    'Racing': 'racing',
    'Fighting': 'fighting',
    'Shooter': 'shooter',
    'Horror': 'horror',
    'Simulation': 'simulation',
    'Sports': 'sports',
    'Indie': 'indie',
    'Casual': 'casual',
  };
  
  const genreSlug = genreSlugMap[genre] || genre.toLowerCase();
  
  // Build RAWG API URL with sorting
  let url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&genres=${encodeURIComponent(genreSlug)}&page_size=50`;
  
  // Sort by rating (highest first) for better recommendations
  url += '&ordering=-rating';
  
  // If looking for current/popular games, prioritize recent releases
  if (currentPopular) {
    url += ',-released';
  }

  const startTime = Date.now();
  try {
    // Use externalApiClient which has timeout (15s) and retry logic built in
    const response = await externalApiClient.get(url);
    if (response.data && response.data.results && response.data.results.length > 0) {
      // Filter out unreleased games and include genre information
      let games = response.data.results
        .filter((game: any) => isGameReleased(game))
        .map((game: any) => ({
          name: game.name,
          rating: game.rating || 0,
          released: game.released,
          tags: game.tags?.map((t: any) => t.slug || t.name).filter(Boolean) || [],
          platforms: game.platforms?.map((p: any) => p.platform?.name || p.name).filter(Boolean) || [],
          genres: game.genres?.map((g: any) => ({
            name: g.name || '',
            slug: g.slug || ''
          })).filter((g: any) => g.name) || []
        }));
      
      // Validate that games actually have the requested genre
      const genreNameVariations = [
        genre.toLowerCase(),
        genreSlug.toLowerCase(),
        ...(genreSlug.includes('-') ? [genreSlug.replace(/-/g, ' ')] : [])
      ];
      
      // Map genre names to common variations and related terms to avoid
      const genreExclusions: { [key: string]: string[] } = {
        'adventure': [
          'rpg', 'role-playing', 'roguelike', 'rogue-like', 
          'visual novel', 'visual-novel', 'novel',
          'first-person shooter', 'fps', 'shooter',
          'strategy', 'simulation', 'puzzle',
          'fighting', 'racing', 'sports'
        ],
        'action': [
          'rpg', 'role-playing', 
          'visual novel', 'visual-novel',
          'strategy', 'simulation', 'puzzle'
        ],
        'rpg': [
          'action', 'adventure',
          'first-person shooter', 'fps', 'shooter',
          'fighting', 'racing', 'sports'
        ],
        'platformer': [
          'rpg', 'role-playing',
          'visual novel', 'visual-novel',
          'first-person shooter', 'fps', 'shooter'
        ]
      };
      
      const exclusions = genreExclusions[genre.toLowerCase()] || [];
      
      // Filter games to only include those that have the requested genre as a PRIMARY genre
      // The requested genre must be in the first 2 genres (primary or secondary)
      games = games.filter((game: any) => {
        if (game.genres.length === 0) return false;
        
        const gameGenres = game.genres.map((g: any) => g.name.toLowerCase());
        const gameGenreSlugs = game.genres.map((g: any) => g.slug.toLowerCase());
        
        // Check if the requested genre is in the PRIMARY position (first 2 genres)
        const primaryGenres = gameGenres.slice(0, 2);
        const primaryGenreSlugs = gameGenreSlugs.slice(0, 2);
        
        const hasRequestedGenreAsPrimary = genreNameVariations.some(variation => 
          primaryGenres.some((g: string) => {
            // Exact match preferred, but allow close matches
            return g === variation || 
                   (g.includes(variation) && variation.length > 3) || 
                   (variation.includes(g) && g.length > 3);
          }) ||
          primaryGenreSlugs.some((g: string) => {
            return g === variation || 
                   (g.includes(variation) && variation.length > 3) || 
                   (variation.includes(g) && g.length > 3);
          })
        );
        
        if (!hasRequestedGenreAsPrimary) return false;
        
        // Check that excluded genres are not in the PRIMARY position (first 2 genres)
        if (exclusions.length > 0) {
          const hasExcludedPrimary = exclusions.some(exclusion => 
            primaryGenres.some((g: string) => 
              g === exclusion || 
              g.includes(exclusion) || 
              exclusion.includes(g)
            ) ||
            primaryGenreSlugs.some((g: string) => 
              g === exclusion || 
              g.includes(exclusion) || 
              exclusion.includes(g)
            )
          );
          
          // If an excluded genre is in primary position, don't include this game
          if (hasExcludedPrimary) return false;
        }
        
        return true;
      });
      
      // If asking for beginners, use AI to filter and rank games
      if (forBeginners || (userQuery && /beginner|new to|starting|first time/i.test(userQuery))) {
        // Use AI to identify beginner-friendly games from the list
        // Include genre information to help AI validate
        const gamesWithGenres = games.slice(0, 30).map((g: any) => ({
          name: g.name,
          genres: g.genres.map((gen: any) => gen.name).join(', ')
        }));
        const gameNames = gamesWithGenres.map((g: any) => g.name);
        const aiPrompt = `You are a gaming expert. From this list of ${genre} games, identify which ones are best for beginners (accessible, not too difficult, good tutorials, forgiving gameplay). 

CRITICAL GENRE REQUIREMENTS - READ CAREFULLY:
- Only recommend games where ${genre} is the PRIMARY genre (one of the first 2 genres listed)
- DO NOT recommend games that are primarily: RPG, Role-Playing, Roguelike, Visual Novel, First-Person Shooter, FPS, Strategy, Simulation, Puzzle, Fighting, Racing, or Sports
- If a game's first genre is NOT ${genre} or a close variation, EXCLUDE it
- Visual novels, FPS games, RPGs, and other genres should be EXCLUDED even if they have ${genre} as a secondary genre

Games with their genres (genres are listed in order of importance):
${gamesWithGenres.map((g: any) => `- ${g.name} (Genres: ${g.genres})`).join('\n')}

Return ONLY a JSON array of 5-10 game names that are:
1. Best for beginners (accessible, not too difficult, good tutorials, forgiving gameplay)
2. ACTUALLY ${genre} games where ${genre} is the PRIMARY genre (first or second genre)

Format: ["Game 1", "Game 2", "Game 3", ...]

ONLY include games where ${genre} is clearly the primary genre. If unsure, EXCLUDE the game.`;

        try {
          // For recommendation filtering, use default model (4o) since we're filtering a list
          // This is a lightweight operation and doesn't need game-specific knowledge
          const modelSelection = await selectModelForQuestion(undefined, `best ${genre} games for beginners`);
          
          // Log model selection for monitoring
          console.log(`[Model Selection] Using ${modelSelection.model} for recommendation filtering (beginner) (reason: ${modelSelection.reason})`);
          
          // Track model usage
          modelUsageStats[modelSelection.model] = (modelUsageStats[modelSelection.model] || 0) + 1;
          
          const beginnerFilterParams = {
            model: modelSelection.model,
            messages: [
              {
                role: 'system' as const,
                content: 'You are a gaming expert. Return only valid JSON arrays of game names.'
              },
              {
                role: 'user' as const,
                content: aiPrompt
              }
            ],
            max_tokens: 500
          };
          const beginnerOpts = openaiRequestOptionsForModel(modelSelection.model);
          const aiResponse = beginnerOpts
            ? await getOpenAIClient().chat.completions.create(beginnerFilterParams, beginnerOpts)
            : await getOpenAIClient().chat.completions.create(beginnerFilterParams);

          const aiText = aiResponse.choices[0]?.message?.content?.trim() || '';
          // Extract JSON array from response
          const jsonMatch = aiText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const recommendedGames = JSON.parse(jsonMatch[0]);
            // Filter to only include games that exist in our list AND have the correct genre as PRIMARY
            const validGames = recommendedGames
              .filter((name: string) => {
                const game = games.find((g: any) => g.name.toLowerCase() === name.toLowerCase());
                if (!game || game.genres.length === 0) return false;
                
                // Double-check genre match - must be in primary position (first 2 genres)
                const gameGenres = game.genres.map((g: any) => g.name.toLowerCase());
                const gameGenreSlugs = game.genres.map((g: any) => g.slug.toLowerCase());
                const primaryGenres = gameGenres.slice(0, 2);
                const primaryGenreSlugs = gameGenreSlugs.slice(0, 2);
                
                // Check if requested genre is in primary position
                const hasRequestedGenreAsPrimary = genreNameVariations.some(variation => 
                  primaryGenres.some((g: string) => 
                    g === variation || 
                    (g.includes(variation) && variation.length > 3) || 
                    (variation.includes(g) && g.length > 3)
                  ) ||
                  primaryGenreSlugs.some((g: string) => 
                    g === variation || 
                    (g.includes(variation) && variation.length > 3) || 
                    (variation.includes(g) && g.length > 3)
                  )
                );
                
                if (!hasRequestedGenreAsPrimary) return false;
                
                // Check that excluded genres are not in primary position
                if (exclusions.length > 0) {
                  const hasExcludedPrimary = exclusions.some(exclusion => 
                    primaryGenres.some((g: string) => 
                      g === exclusion || g.includes(exclusion) || exclusion.includes(g)
                    ) ||
                    primaryGenreSlugs.some((g: string) => 
                      g === exclusion || g.includes(exclusion) || exclusion.includes(g)
                    )
                  );
                  if (hasExcludedPrimary) return false;
                }
                
                return true;
              });
            if (validGames.length > 0) {
              return validGames.slice(0, 10);
            }
          }
        } catch (aiError) {
          console.error('[Recommendations] AI filtering error:', aiError);
          // Fall through to default filtering
        }
        
        // Fallback: Filter by tags that suggest beginner-friendliness
        const beginnerTags = ['easy', 'casual', 'family-friendly', 'educational', 'tutorial', 'beginner-friendly'];
        games = games.filter((game: any) => {
          const gameTags = game.tags.map((t: string) => t.toLowerCase());
          return beginnerTags.some(tag => gameTags.some((gt: string) => gt.includes(tag)));
        });
      }
      
      // If asking for current/popular games, prioritize recent releases
      if (currentPopular || (userQuery && /right now|currently|popular|trending|recent/i.test(userQuery || ''))) {
        // Sort by release date (most recent first), then by rating
        games.sort((a: any, b: any) => {
          const dateA = new Date(a.released || '1900-01-01').getTime();
          const dateB = new Date(b.released || '1900-01-01').getTime();
          if (dateB !== dateA) {
            return dateB - dateA; // Most recent first
          }
          return b.rating - a.rating; // Then by rating
        });
        
        // Use AI to identify currently popular/trending games
        // Include genre information to help AI validate
        const gamesWithGenres = games.slice(0, 30).map((g: any) => ({
          name: g.name,
          genres: g.genres.map((gen: any) => gen.name).join(', '),
          released: g.released
        }));
        const gameNames = gamesWithGenres.map((g: any) => g.name);
        const aiPrompt = `You are a gaming expert with knowledge of current gaming trends (as of 2024). From this list of ${genre} games, identify which ones are currently popular, trending, or highly recommended right now.

CRITICAL GENRE REQUIREMENTS - READ CAREFULLY:
- Only recommend games where ${genre} is the PRIMARY genre (one of the first 2 genres listed)
- DO NOT recommend games that are primarily: RPG, Role-Playing, Roguelike, Visual Novel, First-Person Shooter, FPS, Strategy, Simulation, Puzzle, Fighting, Racing, or Sports
- If a game's first genre is NOT ${genre} or a close variation, EXCLUDE it
- Visual novels, FPS games, RPGs, and other genres should be EXCLUDED even if they have ${genre} as a secondary genre

Games with their genres and release dates (genres are listed in order of importance):
${gamesWithGenres.map((g: any) => `- ${g.name} (Genres: ${g.genres}, Released: ${g.released})`).join('\n')}

Return ONLY a JSON array of 5-10 game names that are:
1. Currently popular or trending (recently released 2023-2024, trending in gaming communities, highly rated, popular on streaming platforms)
2. ACTUALLY ${genre} games where ${genre} is the PRIMARY genre (first or second genre)

Format: ["Game 1", "Game 2", "Game 3", ...]

ONLY include games where ${genre} is clearly the primary genre. If unsure, EXCLUDE the game.`;

        try {
          // For recommendation filtering with currentPopular=true, use GPT-5.2 for better knowledge of recent games
          // For other cases, use default model (4o) since we're filtering a list
          let modelSelection;
          if (currentPopular) {
            // Use GPT-5.2 for current/popular games to leverage better knowledge cutoff (Aug 2025 vs Apr 2024)
            modelSelection = {
              model: 'gpt-5.2',
              reason: 'current_popular_games_need_recent_knowledge'
            };
          } else {
            // Use default model selection logic for other cases
            modelSelection = await selectModelForQuestion(undefined, `popular ${genre} games`);
          }
          
          // Log model selection for monitoring
          console.log(`[Model Selection] Using ${modelSelection.model} for recommendation filtering (popular: ${currentPopular}) (reason: ${modelSelection.reason})`);
          
          // Track model usage
          modelUsageStats[modelSelection.model] = (modelUsageStats[modelSelection.model] || 0) + 1;
          
          const popularFilterParams = {
            model: modelSelection.model,
            messages: [
              {
                role: 'system' as const,
                content: 'You are a gaming expert with current knowledge. Return only valid JSON arrays of game names.'
              },
              {
                role: 'user' as const,
                content: aiPrompt
              }
            ],
            max_tokens: 600
          };
          const popularOpts = openaiRequestOptionsForModel(modelSelection.model);
          const aiResponse = popularOpts
            ? await getOpenAIClient().chat.completions.create(popularFilterParams, popularOpts)
            : await getOpenAIClient().chat.completions.create(popularFilterParams);

          const aiText = aiResponse.choices[0]?.message?.content?.trim() || '';
          // Extract JSON array from response
          const jsonMatch = aiText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const recommendedGames = JSON.parse(jsonMatch[0]);
            // Filter to only include games that exist in our list AND have the correct genre as PRIMARY
            const validGames = recommendedGames
              .filter((name: string) => {
                const game = games.find((g: any) => g.name.toLowerCase() === name.toLowerCase());
                if (!game || game.genres.length === 0) return false;
                
                // Double-check genre match - must be in primary position (first 2 genres)
                const gameGenres = game.genres.map((g: any) => g.name.toLowerCase());
                const gameGenreSlugs = game.genres.map((g: any) => g.slug.toLowerCase());
                const primaryGenres = gameGenres.slice(0, 2);
                const primaryGenreSlugs = gameGenreSlugs.slice(0, 2);
                
                // Check if requested genre is in primary position
                const hasRequestedGenreAsPrimary = genreNameVariations.some(variation => 
                  primaryGenres.some((g: string) => 
                    g === variation || 
                    (g.includes(variation) && variation.length > 3) || 
                    (variation.includes(g) && g.length > 3)
                  ) ||
                  primaryGenreSlugs.some((g: string) => 
                    g === variation || 
                    (g.includes(variation) && variation.length > 3) || 
                    (variation.includes(g) && g.length > 3)
                  )
                );
                
                if (!hasRequestedGenreAsPrimary) return false;
                
                // Check that excluded genres are not in primary position
                if (exclusions.length > 0) {
                  const hasExcludedPrimary = exclusions.some(exclusion => 
                    primaryGenres.some((g: string) => 
                      g === exclusion || g.includes(exclusion) || exclusion.includes(g)
                    ) ||
                    primaryGenreSlugs.some((g: string) => 
                      g === exclusion || g.includes(exclusion) || exclusion.includes(g)
                    )
                  );
                  if (hasExcludedPrimary) return false;
                }
                
                return true;
              });
            if (validGames.length > 0) {
              return validGames.slice(0, 10);
            }
          }
        } catch (aiError) {
          console.error('[Recommendations] AI filtering error:', aiError);
          // Fall through to default sorting
        }
      }
      
      // Return top games by rating
      return games
        .sort((a: any, b: any) => b.rating - a.rating)
        .slice(0, 10)
        .map((game: any) => game.name);
    } else {
      // Log if no results (for debugging)
      // console.log(`[Recommendations] No games found for genre: ${genre}`);
      return [];
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || errorMessage.includes('timeout');
    
    // Log detailed error with structured format
    if (error.response) {
      console.error('[Recommendations] RAWG API error', {
        genre,
        url,
        status: error.response.status,
        statusText: error.response.statusText,
        error: errorMessage,
        responseData: error.response.data,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        operation: 'fetch-recommendations-rawg-api',
        duration,
        isTimeout,
        retryCount: error.config?.__retryCount || 0
      });
    } else {
      console.error('[Recommendations] Error fetching data from RAWG', {
        genre,
        url,
        error: errorMessage,
        code: error.code,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        operation: 'fetch-recommendations-rawg-api',
        duration,
        isTimeout,
        retryCount: error.config?.__retryCount || 0
      });
    }
    return [];
  }
};

// Export the cache for use in other modules
export const getAICache = () => aiCache;

// Interface for question metadata
export interface QuestionMetadata {
  detectedGame?: string;
  detectedGenre?: string[];
  questionCategory?: string;
  difficultyHint?: string;
  interactionType?: string;
}

/**
 * Check if a game title is a bundle, DLC, or expansion
 */
function isBundleOrDLC(title: string): boolean {
  const lower = title.toLowerCase();
  const bundleIndicators = [
    'bundle',
    'expansion pass',
    'expansion pack',
    'dlc',
    'twin pack',
    'double pack',
    'collection',
    'edition',
    'remastered twin',
    '&',
    'and expansion',
    'season pass',
    'complete edition',
    'ultimate edition',
    'deluxe edition',
  ];
  
  return bundleIndicators.some(indicator => lower.includes(indicator));
}

/**
 * Extract all games from a bundle/DLC name
 * Returns an array of game titles found in the bundle
 * Example: "Final Fantasy VII & Final Fantasy VIII Remastered Twin Pack"
 *          -> ["Final Fantasy VII", "Final Fantasy VIII"]
 */
function extractGamesFromBundle(bundleTitle: string): string[] {
  const games: string[] = [];
  
  // Handle twin packs / double packs - extract both games
  // Pattern: "Game A & Game B Twin Pack" or "Game A and Game B Twin Pack"
  const twinPackMatch = bundleTitle.match(/^(.+?)(?:\s*&\s*|\s+and\s+)(.+?)(?:\s+(?:twin|double|pack|remastered).*)?$/i);
  if (twinPackMatch && twinPackMatch[1] && twinPackMatch[2]) {
    const firstGame = twinPackMatch[1].trim();
    const secondGame = twinPackMatch[2].trim();
    
    // Clean up any remaining bundle suffixes from second game
    const cleanedSecond = secondGame.replace(/\s+(?:twin|double|pack|remastered|bundle|edition).*$/i, '').trim();
    
    if (firstGame.length >= 5) {
      games.push(firstGame);
    }
    if (cleanedSecond.length >= 5 && cleanedSecond !== firstGame) {
      games.push(cleanedSecond);
    }
    
    if (games.length > 0) {
      return games;
    }
  }
  
  // For single-game bundles with expansion/DLC, extract the base game
  // Pattern: "Game Name and Expansion Pass Bundle"
  const expansionMatch = bundleTitle.match(/^(.+?)(?:\s+and\s+.*?(?:expansion|pass|bundle|pack|dlc|edition).*)$/i);
  if (expansionMatch && expansionMatch[1]) {
    const baseGame = expansionMatch[1].trim();
    if (baseGame.length >= 5) {
      games.push(baseGame);
      return games;
    }
  }
  
  // Fallback: remove common bundle suffixes
  let cleaned = bundleTitle
    .replace(/\s+and\s+.*?(?:expansion|pass|bundle|pack|dlc|edition).*$/i, '')
    .replace(/\s+&\s+.*?(?:remastered|twin|double|pack).*$/i, '')
    .replace(/\s+(?:expansion|pass|bundle|pack|dlc|edition|collection|remastered).*$/i, '')
    .trim();
  
  if (cleaned.length >= 5 && cleaned.length < bundleTitle.length * 0.7) {
    games.push(cleaned);
    return games;
  }
  
  // If we can't extract games, return the original title
  return [bundleTitle];
}

/**
 * Extract base game title from bundle/DLC name (backward compatibility)
 * For multi-game bundles, returns the first game (use extractGamesFromBundle for better results)
 */
function extractBaseGameFromBundle(bundleTitle: string): string {
  const games = extractGamesFromBundle(bundleTitle);
  return games.length > 0 ? games[0] : bundleTitle;
}

/**
 * Determine which game from a bundle is mentioned in the question text
 * Returns the most relevant game title, or null if none found
 */
function findRelevantGameFromBundle(bundleTitle: string, question: string): string | null {
  const games = extractGamesFromBundle(bundleTitle);
  if (games.length === 0) {
    return null;
  }
  
  // If only one game, return it
  if (games.length === 1) {
    return games[0];
  }
  
  // For multiple games, check which one appears in the question
  const lowerQuestion = question.toLowerCase();
  const gameScores: Array<{ game: string; score: number }> = [];
  
  for (const game of games) {
    const lowerGame = game.toLowerCase();
    let score = 0;
    
    // Check for exact match (highest priority)
    if (lowerQuestion.includes(lowerGame)) {
      score += 100;
      
      // Bonus if it's mentioned as a standalone phrase (not part of another word)
      const gameWords = lowerGame.split(/\s+/);
      const allWordsMatch = gameWords.every(word => {
        // Check if word appears as a whole word in the question
        // Escape special regex characters
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match word at start/end of string or surrounded by non-alphanumeric characters
        // This handles special characters like ö, ō correctly
        const wordRegex = new RegExp(`(?:^|[^a-z0-9À-ÿĀ-ž])${escapedWord}(?:[^a-z0-9À-ÿĀ-ž]|$)`, 'i');
        return wordRegex.test(lowerQuestion);
      });
      
      if (allWordsMatch) {
        score += 50;
      }
    }
    
    // Check for partial matches (key words from the game title)
    const gameWords = lowerGame.split(/\s+/).filter(w => w.length > 3);
    const matchingWords = gameWords.filter(word => lowerQuestion.includes(word));
    score += matchingWords.length * 10;
    
    // Check for roman numerals or numbers (e.g., "VII", "VIII", "2", "3")
    const numberMatch = game.match(/\b([IVXLCDM]+|\d+)\b/i);
    if (numberMatch) {
      const number = numberMatch[1].toLowerCase();
      if (lowerQuestion.includes(number)) {
        score += 30;
      }
    }
    
    gameScores.push({ game, score });
  }
  
  // Sort by score (highest first)
  gameScores.sort((a, b) => b.score - a.score);
  
  // Return the game with the highest score, but only if it has a meaningful score
  if (gameScores.length > 0 && gameScores[0].score > 0) {
    return gameScores[0].game;
  }
  
  // If no clear winner, return the first game (fallback)
  return games[0];
}

/**
 * Search IGDB for a game title and return the matched game name if found
 * Prefers base games over bundles/DLC
 */
async function searchGameInIGDB(candidateTitle: string): Promise<string | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();
    const sanitizedTitle = candidateTitle.replace(/"/g, '\\"');
    
    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      `search "${sanitizedTitle}";
       fields name;
       limit 10;`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (response.data && response.data.length > 0) {
      const lowerCandidate = candidateTitle.toLowerCase();
      
      // Extract distinctive words from candidate (numbers, remake, HD, version indicators, etc.)
      const candidateDistinctiveWords = lowerCandidate
        .split(/\s+/)
        .filter(w => {
          if (/^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return true;
          if (/remake|remaster|reimagined/i.test(w)) return true;
          if (/world|part|sequel/i.test(w)) return true;
          if (/^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w)) return true;
          return false;
        })
        .map(w => w.replace(/[^a-z0-9]/g, ''));
      
      // First, try to find exact match (highest priority)
      const exactMatch = response.data.find((g: any) => {
        const gameName = g.name.toLowerCase();
        return gameName === lowerCandidate;
      });
      
      if (exactMatch && !isBundleOrDLC(exactMatch.name)) {
        return cleanGameTitle(exactMatch.name);
      }
      
      // If candidate has distinctive words, require them in the match
      // This prevents "Resident Evil 4 Remake" from matching "Resident Evil Archives"
      // CRITICAL: Also prevents "Super Smash Bros. Ultimate" from matching "Super Smash Bros. Deluxe"
      const matchesWithDistinctive = response.data.filter((g: any) => {
        const gameName = g.name.toLowerCase();
        const hasBasicMatch = gameName.includes(lowerCandidate) || lowerCandidate.includes(gameName);
        
        if (!hasBasicMatch) return false;
        
        // If candidate has distinctive words, they MUST be in the result
        if (candidateDistinctiveWords.length > 0) {
          const allDistinctivePresent = candidateDistinctiveWords.every(dw => {
            if (dw.length > 0) {
              const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
              return wordPattern.test(gameName);
            }
            return true;
          });
          
          // CRITICAL: Also check that the result doesn't have conflicting distinctive words
          // For example, if candidate has "ultimate", reject results with "deluxe" (and vice versa)
          const conflictingWords = [
            ['ultimate', 'deluxe'],
            ['deluxe', 'ultimate'],
            ['remake', 'remaster'],
            ['remaster', 'remake']
          ];
          
          const hasConflictingWord = conflictingWords.some(([word1, word2]) => {
            const candidateHasWord1 = candidateDistinctiveWords.some(dw => dw === word1.replace(/[^a-z0-9]/g, ''));
            const resultHasWord2 = new RegExp(`\\b${word2}\\b`, 'i').test(gameName);
            return candidateHasWord1 && resultHasWord2;
          });
          
          if (hasConflictingWord) {
            return false; // Reject matches with conflicting distinctive words
          }
          
          return allDistinctivePresent;
        }
        
        return true;
      });
      
      // Prefer non-bundle matches with distinctive words
      const nonBundleMatch = matchesWithDistinctive.find((g: any) => !isBundleOrDLC(g.name));
      if (nonBundleMatch) {
        return cleanGameTitle(nonBundleMatch.name);
      }
      
      // Fallback to first match with distinctive words (even if bundle)
      if (matchesWithDistinctive.length > 0) {
        return cleanGameTitle(matchesWithDistinctive[0].name);
      }
      
      // If no matches with distinctive words and candidate has distinctive words, return null
      // This prevents matching wrong games when distinctive words are missing
      if (candidateDistinctiveWords.length > 0) {
        return null; // Don't return a match if distinctive words are missing
      }
      
      // Only do basic matching if candidate has no distinctive words (generic titles)
      const basicMatch = response.data.find((g: any) => {
        const gameName = g.name.toLowerCase();
        return gameName === lowerCandidate;
      });
      
      if (basicMatch && !isBundleOrDLC(basicMatch.name)) {
        return cleanGameTitle(basicMatch.name);
      }
      
      // If still no match, return null rather than returning wrong game
      return null;
    }
    return null;
  } catch (error) {
    // Silently fail - this is a background operation
    return null;
  }
}

/**
 * Search RAWG for a game title and return the matched game name if found
 * Prefers base games over bundles/DLC
 */
async function searchGameInRAWG(candidateTitle: string): Promise<string | null> {
  try {
    const sanitizedTitle = candidateTitle.toLowerCase().trim();
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(sanitizedTitle)}&page_size=10`;
    
    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      const lowerCandidate = sanitizedTitle;
      
      // Extract distinctive words from candidate (numbers, remake, HD, version indicators, etc.)
      const candidateDistinctiveWords = lowerCandidate
        .split(/\s+/)
        .filter(w => {
          if (/^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return true;
          if (/remake|remaster|reimagined/i.test(w)) return true;
          if (/world|part|sequel/i.test(w)) return true;
          if (/^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w)) return true;
          return false;
        })
        .map(w => w.replace(/[^a-z0-9]/g, ''));
      
      // First, try to find exact match (highest priority)
      const exactMatch = response.data.results.find((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        return normalizedGameName === lowerCandidate;
      });
      
      if (exactMatch && !isBundleOrDLC(exactMatch.name)) {
        return cleanGameTitle(exactMatch.name);
      }
      
      // If candidate has distinctive words, require them in the match
      // CRITICAL: Also prevents "Super Smash Bros. Ultimate" from matching "Super Smash Bros. Deluxe"
      const matchesWithDistinctive = response.data.results.filter((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        const hasBasicMatch = normalizedGameName === lowerCandidate || 
                             normalizedGameName.includes(lowerCandidate) ||
                             lowerCandidate.includes(normalizedGameName);
        
        if (!hasBasicMatch) return false;
        
        // If candidate has distinctive words, they MUST be in the result
        if (candidateDistinctiveWords.length > 0) {
          const allDistinctivePresent = candidateDistinctiveWords.every(dw => {
            if (dw.length > 0) {
              const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
              return wordPattern.test(normalizedGameName);
            }
            return true;
          });
          
          // CRITICAL: Also check that the result doesn't have conflicting distinctive words
          // For example, if candidate has "ultimate", reject results with "deluxe" (and vice versa)
          const conflictingWords = [
            ['ultimate', 'deluxe'],
            ['deluxe', 'ultimate'],
            ['remake', 'remaster'],
            ['remaster', 'remake']
          ];
          
          const hasConflictingWord = conflictingWords.some(([word1, word2]) => {
            const candidateHasWord1 = candidateDistinctiveWords.some(dw => dw === word1.replace(/[^a-z0-9]/g, ''));
            const resultHasWord2 = new RegExp(`\\b${word2}\\b`, 'i').test(normalizedGameName);
            return candidateHasWord1 && resultHasWord2;
          });
          
          if (hasConflictingWord) {
            console.log(`[Game Title] Rejecting RAWG result "${normalizedGameName}" - conflicting distinctive word detected (candidate: "${lowerCandidate}")`);
            return false; // Reject matches with conflicting distinctive words
          }
          
          if (!allDistinctivePresent) {
            console.log(`[Game Title] Rejecting RAWG result "${normalizedGameName}" - missing distinctive words from candidate "${lowerCandidate}"`);
            return false;
          }
          
          return true;
        }
        
        return true;
      });
      
      // Prefer non-bundle matches with distinctive words
      const nonBundleMatch = matchesWithDistinctive.find((g: any) => !isBundleOrDLC(g.name));
      if (nonBundleMatch) {
        return cleanGameTitle(nonBundleMatch.name);
      }
      
      // Fallback to first match with distinctive words (even if bundle)
      if (matchesWithDistinctive.length > 0) {
        return cleanGameTitle(matchesWithDistinctive[0].name);
      }
      
      // If no matches with distinctive words and candidate has distinctive words, return null
      if (candidateDistinctiveWords.length > 0) {
        console.log(`[Game Title] No RAWG matches with required distinctive words for candidate: "${lowerCandidate}"`);
        return null; // Don't return a match if distinctive words are missing
      }
      
      // Only do basic matching if candidate has no distinctive words (generic titles)
      const nonBundleMatches = response.data.results.filter((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        return normalizedGameName === lowerCandidate && !isBundleOrDLC(g.name);
      });
      
      if (nonBundleMatches.length > 0) {
        return cleanGameTitle(nonBundleMatches[0].name);
      }
      
      // If no match found, return null rather than returning wrong game
      return null;
    }
    return null;
  } catch (error) {
    // Silently fail - this is a background operation
    return null;
  }
}

/**
 * Extract potential game title candidates from question text
 * Returns an array of candidate strings that might be game titles
 */
function extractGameTitleCandidates(question: string): string[] {
  if (!question || question.length < 3) return [];

  const candidates: string[] = [];

  // Strategy 1: Quoted game titles (most reliable)
  const quotedMatch = question.match(/["']([^"']+)["']/i);
  if (quotedMatch && quotedMatch[1].trim().length >= 3) {
    candidates.push(quotedMatch[1].trim());
  }
  
  // Strategy 1.5: "When was [Game Title] released?" pattern
  // This captures the full game title including numbers and remake indicators
  const whenWasPattern = /when\s+(?:was|is|did)\s+([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&-]+?)\s+(?:released|come\s+out|launched)/i;
  const whenWasMatch = question.match(whenWasPattern);
  if (whenWasMatch && whenWasMatch[1]) {
    let candidate = whenWasMatch[1].trim();
    // Remove leading "the" if present
    candidate = candidate.replace(/^the\s+/i, '');
    if (candidate.length >= 3) {
      candidates.push(candidate);
    }
  }

  // Strategy 2: "in [Game Title]", "for [Game Title]", "of [Game Title]" patterns
  // Updated to handle special characters (é, ü, ö, ō, etc.) and roman numerals (X, Y, III, etc.)
  // Improved to stop at common verbs and question words to avoid capturing too much
  // Character class includes: À-ÿ (Latin-1), Ā-ž (Latin Extended-A), and common Unicode letters
  // Added "of" to catch patterns like "versions of Deisim", "differences between versions of [Game]"
  // IMPORTANT: Preserve remake/remaster/sequel indicators and version indicators (Remake, Remaster, HD, 2, World 2, II, etc.)
  // CRITICAL: Capture full game titles including colons and subtitles (e.g., "The Legend of Zelda: Breath of the Wild")
  // CRITICAL: Also capture titles with subtitles that don't use colons (e.g., "Super Mario Bros. Wonder")
  // Pattern: "in [Title]: [Subtitle]" or "in [Title] [Subtitle]" - captures up to question mark, period, or end of string
  // IMPORTANT: Pattern explicitly handles colons - captures "Title: Subtitle" as a single candidate
  // IMPORTANT: Pattern also captures titles with space-separated subtitles (e.g., "Super Mario Bros. Wonder")
  // The pattern captures: "in The Legend of Zelda: Breath of the Wild" -> "The Legend of Zelda: Breath of the Wild"
  // The pattern captures: "in Super Mario Bros. Wonder" -> "Super Mario Bros. Wonder"
  // CRITICAL: Use greedy matching to capture the longest possible title including subtitles
  // The pattern captures everything from "in" until a question mark, period, or end of string
  // For questions ending with "?", capture everything up to the "?" (e.g., "in Super Mario Bros. Wonder?")
  // Use greedy matching to capture the full title including subtitles (change +? to + for greedy)
  // Updated pattern to capture version indicators like "Ultimate", "Deluxe", etc. in the main capture group
  // CRITICAL: Include period (.) in character class to capture "Super Smash Bros. Ultimate" (not just "Super Smash Bros")
  // CRITICAL: Use greedy matching (+) to capture full titles including version indicators
  const inGamePattern = /\b(?:in|for|from|on|of)\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s'&\-:\.]+(?:\s+(?:Ultimate|Deluxe|Remake|Remaster|Reimagined|HD|4K|Definitive|Edition|Complete|Collection|2|II|3|III|4|IV|World\s*2|World\s*II))?)(?=\s+(?:how|what|where|when|why|which|who|is|does|do|has|have|can|could|would|should|was|were|will|did)\b|[?.!]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = inGamePattern.exec(question)) !== null) {
    if (match[1]) {
      let candidate = match[1].trim();
      // Remove leading question words
      candidate = candidate.replace(/^(?:what|which|where|when|why|how|who|the|a|an)\s+/i, '');
      // Remove trailing verbs and question words
      candidate = candidate.replace(/\s+(?:has|have|is|are|does|do|can|could|would|should|was|were|will|did)$/i, '');
      // CRITICAL: Remove trailing "for [platform/console]" patterns (e.g., "for Nintendo Switch", "for PC")
      // But preserve version indicators like "Ultimate", "Deluxe" that might come before "for"
      candidate = candidate.replace(/\s+for\s+(?:Nintendo\s+Switch|PlayStation|Xbox|PC|Steam|Epic|Windows|Mac|Linux|iOS|Android|mobile)$/i, '');
      // Remove any text before "in" if it was accidentally captured (e.g., "kart has" before "in")
      const inIndex = candidate.toLowerCase().indexOf(' in ');
      if (inIndex > 0) {
        candidate = candidate.substring(inIndex + 4).trim();
      }
      
      if (candidate.length >= 3 && !/^(what|which|where|when|why|how|who)$/i.test(candidate)) {
        // Check for non-game indicators (phrases that indicate this isn't a game title)
        const lowerCandidate = candidate.toLowerCase();
        // Filter out common non-game phrases
        const nonGamePhrases = [
          'kart has', 'is the', 'best way', 'battle and catch', 'has the', 'has highest',
          'has best', 'has the lowest', 'has the worst', 'CTGP', 'has the slowest',
          'has the easiest', 'has the hardest', 'gameplay mechanics', 'mechanics',
          'gameplay', 'different versions', 'versions', 'key differences', 'differences',
          'between', 'version', 'edition', 'editions', 'location', 'item'
        ];
        
        const isNonGamePhrase = nonGamePhrases.some(phrase => lowerCandidate.includes(phrase));
        
        // Also check if it's a very generic phrase (all lowercase common words)
        const isGenericPhrase = /^(the|a|an|this|that|these|those|some|any|all|each|every)\s+/i.test(candidate) &&
                                candidate.split(/\s+/).length <= 3;
        
        if (!isNonGamePhrase && !isGenericPhrase) {
          candidates.push(candidate);
        }
      }
    }
  }

  // Strategy 2.5: "versions of [Game]", "differences between...of [Game]" patterns
  // This catches cases like "differences between versions of Deisim"
  const ofGamePattern = /\b(?:versions?|editions?|differences?|between|comparison|compare)\s+(?:between\s+)?(?:the\s+)?(?:different\s+)?(?:versions?|editions?)\s+of\s+([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&-]+?)(?:\s*$|[?.!])/gi;
  while ((match = ofGamePattern.exec(question)) !== null) {
    if (match[1]) {
      let candidate = match[1].trim();
      // Clean up trailing words
      candidate = candidate.replace(/\s+(?:how|what|where|when|why|which|who|is|does|do|has|have|can|could|would|should|was|were|will|did)$/i, '');
      if (candidate.length >= 3 && candidate.length <= 50) {
        const lowerCandidate = candidate.toLowerCase();
        // Filter out non-game phrases
        if (!lowerCandidate.includes('gameplay mechanics') && 
            !lowerCandidate.includes('mechanics') &&
            !lowerCandidate.includes('gameplay')) {
          candidates.push(candidate);
        }
      }
    }
  }

  // Strategy 3: Proper noun patterns (capitalized words, including special chars, numbers, and remake indicators)
  // Also matches patterns like "Pokémon X and Y", "Final Fantasy VII", "God of War Ragnarök", "Resident Evil 4 Remake"
  // Character class includes: À-ÿ (Latin-1), Ā-ž (Latin Extended-A) for characters like ö, ō
  // IMPORTANT: Include numbers, remake/remaster indicators, and version indicators (HD, 4K, etc.) in the pattern
  // CRITICAL: Filter out candidates that appear before "in [Game Title]" patterns - these are likely locations/characters/items
  const properNounPattern = /\b([A-ZÀ-ÿĀ-ž][a-zÀ-ÿĀ-ž]+(?:\s+(?:[A-ZÀ-ÿĀ-ž][a-zÀ-ÿĀ-ž]+|[IVXLCDM]+|\d+|Remake|Remaster|Reimagined|HD|4K|Definitive|Edition|\band\b)){1,6})\b/g;
  const properNounMatches: Array<{ candidate: string; index: number }> = [];
  
  // First, find all "in [Game Title]" patterns to identify what comes after them
  const inGamePatternIndices: number[] = [];
  const inGameCheckRegex = /\b(?:in|for|from|on|of)\s+(?:the\s+)?[A-ZÀ-ÿĀ-ž]/gi;
  let inGameCheckMatch: RegExpExecArray | null;
  while ((inGameCheckMatch = inGameCheckRegex.exec(question)) !== null) {
    inGamePatternIndices.push(inGameCheckMatch.index);
  }
  
  while ((match = properNounPattern.exec(question)) !== null) {
    if (match[1]) {
      let candidate = match[1].trim();
      // Skip if it's at the start of a sentence (likely not a game)
      const candidateIndex = question.indexOf(candidate);
      if (candidateIndex > 0 && candidate.length >= 3) {
        // CRITICAL: If this candidate appears before an "in [Game Title]" pattern,
        // and the candidate is short (1-3 words), it's likely a location/character/item, not a game
        const wordCount = candidate.split(/\s+/).length;
        const isShortCandidate = wordCount <= 3 && candidate.length < 40;
        
        // Check if there's an "in [Game Title]" pattern after this candidate
        const hasInGamePatternAfter = inGamePatternIndices.some(inGameIndex => 
          inGameIndex > candidateIndex && inGameIndex < candidateIndex + candidate.length + 50
        );
        
        // Skip short candidates that appear before "in [Game Title]" patterns
        if (isShortCandidate && hasInGamePatternAfter) {
          continue; // Skip this candidate - it's likely not a game title
        }
        
        // Filter out common question starters and non-game phrases
        const lowerCandidate = candidate.toLowerCase();
        if (!/^(How|What|Where|When|Why|Which|Who)\s+/.test(candidate) &&
            !lowerCandidate.includes('gameplay mechanics') &&
            !lowerCandidate.includes('mechanics') &&
            !lowerCandidate.includes('gameplay') &&
            !lowerCandidate.includes('versions') &&
            !lowerCandidate.includes('differences')) {
          properNounMatches.push({ candidate, index: candidateIndex });
        }
      }
    }
  }
  
  // Sort by position (later in question = more likely to be game title) and add to candidates
  properNounMatches.sort((a, b) => b.index - a.index);
  for (const match of properNounMatches) {
    candidates.push(match.candidate);
  }

  // Strategy 4: Extract from "What [item] in [game]?" patterns (with special char support)
  // Improved to better handle cases where the game title might have extra text before it
  // Character class includes: À-ÿ (Latin-1), Ā-ž (Latin Extended-A) for characters like ö, ō
  const itemInGameMatch = question.match(/(?:what|which|where|how).+?\bin\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&-]{3,50})(?:\??\s*$|[?.!])/i);
  if (itemInGameMatch && itemInGameMatch[1]) {
    let candidate = itemInGameMatch[1].trim();
    // Clean up common endings
    candidate = candidate.replace(/\s+(?:how|what|where|when|why|which|who)$/i, '');
    // Remove any text that looks like it's part of the question, not the game title
    // If candidate contains verbs like "has", "is", etc., try to extract just the game part
    const verbPattern = /\s+(?:has|have|is|are|does|do|can|could|would|should|was|were|will|did)\s+/i;
    const verbMatch = candidate.match(verbPattern);
    if (verbMatch && verbMatch.index !== undefined) {
      // If we find a verb, the game title is likely after it
      // But actually, if there's a verb, the game is probably before "in"
      // So this candidate might be malformed - skip it or try to clean it
      const beforeVerb = candidate.substring(0, verbMatch.index).trim();
      // If what's before the verb is short and looks like a game title, use it
      // Check for uppercase letter or special character (À-ÿ, Ā-ž)
      if (beforeVerb.length >= 3 && beforeVerb.length <= 30 && /^[A-ZÀ-ÿĀ-ž]/.test(beforeVerb)) {
        candidate = beforeVerb;
      }
    }
    if (candidate.length >= 3 && candidate.length <= 50) {
      // Additional check: if candidate contains common question phrases, it's probably wrong
      const lowerCandidate = candidate.toLowerCase();
      if (!lowerCandidate.includes('has the') && 
          !lowerCandidate.includes('has highest') &&
          !lowerCandidate.includes('has best') &&
          !lowerCandidate.includes('kart has') &&
          !lowerCandidate.includes('has the lowest') &&
          !lowerCandidate.includes('has the worst') &&
          !lowerCandidate.includes('has the slowest') &&
          !lowerCandidate.includes('has the easiest') &&
          !lowerCandidate.includes('has the hardest')) {
        candidates.push(candidate);
      }
    }
  }

  // Strategy 5: Specific pattern for "Pokémon X and Y", "Final Fantasy VII" style titles
  // Matches: [Name] [Letter/Numeral] and [Letter/Numeral]
  // Character class includes: À-ÿ (Latin-1), Ā-ž (Latin Extended-A) for characters like ö, ō
  const versionedGamePattern = /\b([A-ZÀ-ÿĀ-ž][a-zÀ-ÿĀ-ž]+)\s+([A-ZIVXLCDM]+)\s+and\s+([A-ZIVXLCDM]+)\b/gi;
  while ((match = versionedGamePattern.exec(question)) !== null) {
    if (match[1] && match[2] && match[3]) {
      const candidate = `${match[1]} ${match[2]} and ${match[3]}`;
      if (candidate.length >= 5 && candidate.length <= 60) {
        candidates.push(candidate);
      }
    }
  }

  // Remove duplicates and filter candidates
  let uniqueCandidates = Array.from(new Set(candidates))
    .filter(c => c.length >= 3 && c.length <= 60)
    .filter(c => !isLikelyQuestionWord(c))
    .filter(c => isValidGameTitleCandidate(c));
  
  if (uniqueCandidates.length === 0) {
    return [];
  }
  
  // Identify which candidates came from "in [Game Title]" pattern (highest priority)
  const inGamePatternCandidates = new Set<string>();
  // Match "in [Game Title]" pattern - extract the game title part
  // IMPORTANT: Use greedy matching for subtitle part to capture full titles with colons
  // Keep colon in character class to allow titles with colons
  const inGamePatternRegex = /\b(?:in|for|from|on|of)\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-]+?(?:\s*:\s*[A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-]+)?(?:\s+(?:Remake|Remaster|Reimagined|HD|4K|Definitive|Edition|2|II|3|III|4|IV|World\s*2|World\s*II))?)(?:\s+(?:how|what|where|when|why|which|who|is|does|do|has|have|can|could|would|should|was|were|will|did)|$|[?.!])/gi;
  let inGameMatch: RegExpExecArray | null;
  while ((inGameMatch = inGamePatternRegex.exec(question)) !== null) {
    if (inGameMatch[1]) {
      let candidate = inGameMatch[1].trim();
      candidate = candidate.replace(/^(?:what|which|where|when|why|how|who|the|a|an)\s+/i, '');
      candidate = candidate.replace(/\s+(?:has|have|is|are|does|do|can|could|would|should|was|were|will|did)$/i, '');
      if (candidate.length >= 3) {
        // Normalize for comparison (case-insensitive)
        const normalized = candidate.toLowerCase();
        uniqueCandidates.forEach(c => {
          if (c.toLowerCase() === normalized || c.toLowerCase().includes(normalized) || normalized.includes(c.toLowerCase())) {
            inGamePatternCandidates.add(c);
          }
        });
      }
    }
  }
  
  // Detect candidates that appear BEFORE "in [Game Title]" pattern (likely characters/enemies/locations)
  const likelyCharacterNames = new Set<string>();
  const questionLowerForChars = question.toLowerCase();
  uniqueCandidates.forEach(candidate => {
    const candidateLower = candidate.toLowerCase();
    const candidateIndex = questionLowerForChars.indexOf(candidateLower);
    
    // Check if this candidate appears before an "in [Game Title]" pattern
    const inPatternAfter = /\bin\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&-]+)/i;
    const afterMatch = question.substring(candidateIndex + candidate.length).match(inPatternAfter);
    
    if (afterMatch && candidateIndex >= 0) {
      // This candidate appears before "in [Game Title]" - likely a character/enemy/location
      // Only mark as likely character if it's short (1-2 words) and not a known game title pattern
      const wordCount = candidate.split(/\s+/).length;
      if (wordCount <= 2 && candidate.length < 30) {
        likelyCharacterNames.add(candidate);
      }
    }
  });
  
  // Separate candidates into single-word and multi-word
  const singleWordCandidates = uniqueCandidates.filter(c => c.split(/\s+/).length === 1);
  const multiWordCandidates = uniqueCandidates.filter(c => c.split(/\s+/).length > 1);
  
  // If we have multi-word candidates, prefer them over single-word candidates
  // Single words are often game content (items, ingredients, etc.) not game titles
  let prioritizedCandidates: string[];
  if (multiWordCandidates.length > 0) {
    // Use multi-word candidates, but also include single-word candidates that look like proper nouns
    // (start with capital letter and are reasonably long - might be game titles like "Deisim")
    const validSingleWords = singleWordCandidates.filter(c => {
      const words = c.split(/\s+/);
      // Only keep single words that:
      // 1. Start with capital letter (proper noun)
      // 2. Are at least 5 characters (unlikely to be common words)
      // 3. Don't look like common nouns (not in common word lists)
      return words.length === 1 && 
             /^[A-ZÀ-ÿĀ-ž]/.test(c) && 
             c.length >= 5 &&
             !isCommonNoun(c);
    });
    prioritizedCandidates = [...multiWordCandidates, ...validSingleWords];
  } else {
    // Only single-word candidates available, use them but be more strict
    prioritizedCandidates = singleWordCandidates.filter(c => {
      const words = c.split(/\s+/);
      // Only keep if it's a proper noun and reasonably long
      return words.length === 1 && 
             /^[A-ZÀ-ÿĀ-ž]/.test(c) && 
             c.length >= 5 &&
             !isCommonNoun(c);
    });
  }
  
  // CRITICAL: Filter out candidates that appear BEFORE "in [Game Title]" patterns
  // These are almost always characters/enemies/locations, not game titles
  // Only exclude if there's an "in [Game Title]" candidate available
  const hasInGamePatternCandidate = prioritizedCandidates.some(c => inGamePatternCandidates.has(c));
  
  if (hasInGamePatternCandidate) {
    // If we have an "in [Game Title]" candidate, exclude short candidates that appear before it
    prioritizedCandidates = prioritizedCandidates.filter(candidate => {
      // Always keep "in [Game Title]" candidates
      if (inGamePatternCandidates.has(candidate)) {
        return true;
      }
      
      // Exclude candidates that appear before "in [Game Title]" patterns if they're short
      if (likelyCharacterNames.has(candidate)) {
        return false; // Completely exclude these
      }
      
      // Also check if candidate appears before any "in [Game Title]" pattern
      const candidateLower = candidate.toLowerCase();
      const candidateIndex = questionLowerForChars.indexOf(candidateLower);
      
      if (candidateIndex >= 0) {
        const textAfter = question.substring(candidateIndex + candidate.length);
        const inPatternAfter = /\bin\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&-]{5,})/i;
        const afterMatch = textAfter.match(inPatternAfter);
        
        if (afterMatch) {
          // Candidate appears before "in [Game Title]" pattern
          const wordCount = candidate.split(/\s+/).length;
          // Exclude if short (1-3 words) and not very long
          if (wordCount <= 3 && candidate.length < 40) {
            return false; // Exclude short candidates before "in [Game Title]"
          }
        }
      }
      
      return true;
    });
  }
  
  // Prioritize candidates with intelligent scoring
  // Score based on: 1) Pattern match (in [Game Title] = highest), 2) Not a character name, 3) Word count, 4) Length, 5) Position
  prioritizedCandidates = prioritizedCandidates
    .map(candidate => {
      const candidateLower = candidate.toLowerCase();
      const position = questionLowerForChars.indexOf(candidateLower);
      const wordCount = candidate.split(/\s+/).length;
      const length = candidate.length;
      
      // Calculate score
      let score = 0;
      
      // Highest priority: Candidates from "in [Game Title]" pattern
      if (inGamePatternCandidates.has(candidate)) {
        score += 10000; // Much higher priority to ensure they're tried first
      }
      
      // Penalty: Candidates that are likely character/enemy/location names
      if (likelyCharacterNames.has(candidate)) {
        score -= 5000; // Much larger penalty
      }
      
      // Bonus for longer, more complete titles (likely full game titles)
      score += wordCount * 10; // More words = higher score
      score += length; // Longer = higher score
      
      // Small bonus for appearing later in question (but much less important than pattern match)
      score += (position / 10);
      
      return {
        candidate,
        score,
        wordCount,
        length,
        position
      };
    })
    .sort((a, b) => {
      // Sort by score (highest first)
      return b.score - a.score;
    })
    .map(item => item.candidate);
  
  return prioritizedCandidates;
}

/**
 * Helper to check if a string is likely a question word
 */
function isLikelyQuestionWord(text: string): boolean {
  const questionWords = ['what', 'which', 'where', 'when', 'why', 'how', 'who', 'the', 'a', 'an'];
  return questionWords.includes(text.toLowerCase()) || 
         questionWords.some(word => text.toLowerCase().startsWith(word + ' '));
}

/**
 * Check if a single word is a common noun (not a proper noun/game title)
 * Common nouns are lowercase words that refer to general things, not specific titles
 */
function isCommonNoun(word: string): boolean {
  const lower = word.toLowerCase();
  
  // Common nouns that might appear in game content but aren't game titles
  const commonNouns = [
    // Food/ingredients
    'seafood', 'paella', 'ingredient', 'ingredients', 'recipe', 'recipes',
    'cook', 'cooking', 'food', 'meal', 'meals', 'dish', 'dishes',
    // Items/objects
    'sword', 'shield', 'armor', 'weapon', 'item', 'items', 'tool', 'tools',
    'potion', 'potions', 'key', 'keys', 'coin', 'coins', 'gem', 'gems',
    // Characters/entities
    'enemy', 'enemies', 'boss', 'bosses', 'character', 'characters',
    'npc', 'npcs', 'monster', 'monsters', 'creature', 'creatures',
    // Locations
    'area', 'areas', 'zone', 'zones', 'level', 'levels', 'dungeon', 'dungeons',
    'location', 'locations', 'place', 'places', 'room', 'rooms',
    // Actions/mechanics
    'attack', 'attacks', 'defense', 'defenses', 'skill', 'skills', 'ability', 'abilities',
    'quest', 'quests', 'mission', 'missions', 'objective', 'objectives',
    // Generic terms
    'guide', 'guides', 'help', 'tips', 'tricks', 'strategy', 'strategies',
    'walkthrough', 'walkthroughs', 'tutorial', 'tutorials'
  ];
  
  return commonNouns.includes(lower);
}

/**
 * Validate if a candidate title looks like a real game title
 * Filters out suspicious short words, common words, and non-game terms
 */
function isValidGameTitleCandidate(candidate: string): boolean {
  if (!candidate || candidate.length < 3) return false;
  
  const lower = candidate.toLowerCase().trim();
  
  // Reject single common words that aren't games
  const commonWords = [
    'tin', 'can', 'jump', 'fly', 'migration', 'the', 'a', 'an',
    'how', 'what', 'where', 'when', 'why', 'which', 'who',
    'has', 'have', 'is', 'are', 'was', 'were', 'do', 'does',
    'game', 'games', 'play', 'player', 'playing'
  ];
  
  if (commonWords.includes(lower)) return false;
  
  // Reject if it's just one word and it's too short or common
  const words = lower.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 1 && (words[0].length < 4 || commonWords.includes(words[0]))) {
    return false;
  }
  
  // For single-word candidates, be more strict - they're likely game content, not game titles
  // Multi-word candidates are more likely to be actual game titles
  if (words.length === 1) {
    // Reject if it's a common noun (not a proper noun)
    if (isCommonNoun(candidate)) {
      return false;
    }
    // Only accept single words if they look like proper nouns (start with capital)
    // and are reasonably long (at least 5 chars)
    if (!/^[A-ZÀ-ÿĀ-ž]/.test(candidate) || candidate.length < 5) {
      return false;
    }
  }
  
  // Reject generic two-word combinations that are likely not game titles
  // These are common words that appear in questions but aren't game titles
  if (words.length === 2) {
    const genericCombinations = [
      'sword master', 'master sword', 'blue shield', 'shield alliance',
      'best weapon', 'weapon guide', 'how to', 'what is', 'where is',
      'game guide', 'walkthrough guide', 'strategy guide'
    ];
    if (genericCombinations.includes(lower)) {
      return false;
    }
    
    // Also reject if both words are very common/generic
    const genericWords = ['sword', 'master', 'shield', 'alliance', 'blue', 'red', 'green', 'gold', 'silver', 'weapon', 'item', 'guide', 'help'];
    if (genericWords.includes(words[0]) && genericWords.includes(words[1])) {
      // Only reject if it's a very generic combination
      if (words[0].length < 6 && words[1].length < 6) {
        return false;
      }
    }
  }
  
  // Reject if it contains only numbers or special characters
  if (!/[a-z]/.test(lower)) return false;
  
  // Reject if it's too long (likely not a game title)
  if (candidate.length > 80) return false;
  
  // Reject if it contains suspicious patterns
  const suspiciousPatterns = [
    /\b(tin can|jump fly|migration)\b/i,
    /^[a-z]\s/i, // Single lowercase letter followed by space
  ];
  
  if (suspiciousPatterns.some(pattern => pattern.test(candidate))) {
    return false;
  }
  
  return true;
}

/**
 * Validate if an API result is acceptable given the original candidate
 * Rejects results that contain unexpected words like "Multiplayer" that weren't in the candidate
 */
function isValidAPIResult(apiResult: string, originalCandidate: string): boolean {
  if (!apiResult || !originalCandidate) return true; // If we can't validate, allow it
  
  const lowerResult = apiResult.toLowerCase();
  const lowerCandidate = originalCandidate.toLowerCase();
  
  // Words that shouldn't appear in results unless they were in the original candidate
  const unexpectedWords = [
    'multiplayer',
    'co-op',
    'coop',
    'online',
    'offline',
    'single player',
    'singleplayer',
    'local',
    'split screen',
    'splitscreen'
  ];
  
  // Check if result contains unexpected words that weren't in the candidate
  for (const word of unexpectedWords) {
    if (lowerResult.includes(word) && !lowerCandidate.includes(word)) {
      // Reject if the word appears in the result but not in the candidate
      return false;
    }
  }
  
  // Additional check: if result is significantly longer than candidate and contains unexpected words
  // This catches cases where "Multiplayer" was added
  if (apiResult.length > originalCandidate.length * 1.3) {
    const resultWords = lowerResult.split(/\s+/);
    const candidateWords = lowerCandidate.split(/\s+/);
    const newWords = resultWords.filter(w => !candidateWords.includes(w));
    
    // If new words include unexpected terms, reject
    if (newWords.some(w => unexpectedWords.some(uw => w.includes(uw)))) {
      return false;
    }
  }
  
  return true;
}

/**
 * Clean game title by removing engine names and other unwanted prefixes
 * Removes: "Unreal Engine", "Unity", "Source Engine", etc.
 */
function cleanGameTitle(title: string): string {
  if (!title) return title;
  
  // Engine names and prefixes to remove (case-insensitive)
  const enginePrefixes = [
    'unreal engine',
    'unity',
    'source engine',
    'cryengine',
    'frostbite',
    'id tech',
    'unreal',
    'game engine',
  ];
  
  let cleaned = title.trim();
  
  // Remove engine prefixes from the beginning
  for (const engine of enginePrefixes) {
    const regex = new RegExp(`^${engine}\\s+`, 'i');
    cleaned = cleaned.replace(regex, '');
  }
  
  // Also check if engine name appears in the middle and remove it
  for (const engine of enginePrefixes) {
    const regex = new RegExp(`\\s+${engine}\\s+`, 'i');
    cleaned = cleaned.replace(regex, ' ');
  }
  
  return cleaned.trim();
}

/**
 * Normalize game titles that should start with "The"
 * Ensures titles like "Legend of Zelda" become "The Legend of Zelda"
 */
function normalizeGameTitle(title: string): string {
  if (!title) return title;
  
  // First clean the title to remove engine names
  let cleaned = cleanGameTitle(title);
  
  const lower = cleaned.toLowerCase().trim();
  
  // Games that should always start with "The"
  const gamesRequiringThe = [
    'legend of zelda',
    'elder scrolls',
    'witcher',
    'last of us',
    'walking dead',
    'sims',
  ];
  
  // Check if title matches a game that requires "The" but doesn't have it
  for (const gamePattern of gamesRequiringThe) {
    if (lower.startsWith(gamePattern) && !lower.startsWith('the ' + gamePattern)) {
      // Add "The" at the beginning
      return 'The ' + cleaned.trim();
    }
  }
  
  return cleaned;
}

/**
 * Check if an API result is relevant to the question text
 * Ensures the result shares significant words with the question or candidate
 * STRICT VERSION: Requires distinctive words (numbers, remake, sequel indicators) to match
 */
function isAPIResultRelevantToQuestion(apiResult: string, question: string, candidate: string): boolean {
  if (!apiResult || !question) return true; // If we can't validate, allow it
  
  const lowerResult = apiResult.toLowerCase();
  const lowerCandidate = candidate.toLowerCase();
  const lowerQuestion = question.toLowerCase();
  
  // CRITICAL: Check if question contains an "in [Game Title]" pattern
  // If it does, and the candidate is short and doesn't match the game title, we need to be more strict
  // Use the same pattern as extractGameTitleCandidates to ensure consistency
  const inGamePattern = /\b(?:in|for|from|on|of)\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-]+?(?:\s*:\s*[A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-]+?)?)(?=\s+(?:how|what|where|when|why|which|who|is|does|do|has|have|can|could|would|should|was|were|will|did)\b|[?.!]|$)/gi;
  const inGameMatches: Array<{ title: string; index: number }> = [];
  let inGameMatch: RegExpExecArray | null;
  
  // Find all "in [Game Title]" patterns in the question (works for both beginning and end)
  while ((inGameMatch = inGamePattern.exec(question)) !== null) {
    if (inGameMatch[1]) {
      let title = inGameMatch[1].trim();
      // Clean up the title (same as extractGameTitleCandidates)
      title = title.replace(/^(?:what|which|where|when|why|how|who|the|a|an)\s+/i, '');
      title = title.replace(/\s+(?:has|have|is|are|does|do|can|could|would|should|was|were|will|did)$/i, '');
      if (title.length >= 3) {
        inGameMatches.push({ title: title.toLowerCase(), index: inGameMatch.index });
      }
    }
  }
  
  // Use the most relevant "in [Game Title]" match (prefer longer titles, or the one closest to the candidate)
  if (inGameMatches.length > 0) {
    // Sort by length (longer = more specific) and then by position
    inGameMatches.sort((a, b) => {
      if (a.title.length !== b.title.length) {
        return b.title.length - a.title.length; // Longer first
      }
      return a.index - b.index; // Earlier position first
    });
    
    const inGameTitle = inGameMatches[0].title;
    const inGameIndex = inGameMatches[0].index;
    const candidateIndex = lowerQuestion.indexOf(lowerCandidate);
    
    // Extract meaningful words from the "in [Game Title]" game title
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'what', 'which', 'where', 'when', 'why', 'how', 'who', 'can', 'could', 'would', 'should',
      'game', 'games', 'play', 'player', 'playing', 'get', 'got', 'how', 'best', 'way'
    ]);
    
    const extractMeaningfulWords = (text: string): Set<string> => {
      return new Set(
        text
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 2 && !commonWords.has(w))
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w.length > 2)
      );
    };
    
    const inGameTitleWords = extractMeaningfulWords(inGameTitle);
    const resultWords = extractMeaningfulWords(apiResult);
    
    // Check if result shares meaningful words with the "in [Game Title]" game title
    const sharedWords = Array.from(resultWords).filter(w => inGameTitleWords.has(w));
    
    // If candidate is short (1-3 words) and doesn't share meaningful words with the "in [Game Title]" game title
    const wordCount = candidate.split(/\s+/).length;
    if (wordCount <= 3 && candidate.length < 40) {
      // Check if candidate appears before "in [Game Title]" pattern
      if (candidateIndex >= 0 && inGameIndex >= 0 && candidateIndex < inGameIndex) {
        // Candidate appears before "in [Game Title]" - likely a character/enemy/location
        // The API result must share meaningful words with the "in [Game Title]" game title
        if (sharedWords.length === 0) {
          return false; // Reject - result doesn't match the game title mentioned in question
        }
      } else if (candidateIndex >= 0 && inGameIndex >= 0 && candidateIndex > inGameIndex) {
        // Candidate appears after "in [Game Title]" - could be a character/enemy/location
        // If the result doesn't share meaningful words with the "in [Game Title]" game title,
        // and the candidate is short, reject it
        if (wordCount === 1 && sharedWords.length === 0) {
          return false; // Reject single-word candidates that don't match the game title
        }
        // For multi-word candidates after "in [Game Title]" (like "Petey Piranha"), check if any words match
        if (wordCount <= 3 && sharedWords.length === 0) {
          const candidateLower = candidate.toLowerCase();
          const inGameTitleLower = inGameTitle.toLowerCase();
          // Check if any individual word from the candidate appears in the game title
          // This catches cases like "Petey Piranha" where neither word appears in "Mario Superstar Baseball"
          const candidateWords = candidateLower.split(/\s+/).filter(w => w.length > 2);
          const hasMatchingWord = candidateWords.some(word => inGameTitleLower.includes(word));
          
          // If no words from the candidate appear in the game title, it's likely a character/enemy/location
          if (!hasMatchingWord) {
            return false; // Reject - candidate words don't match the game title
          }
        }
      }
    }
  }
  
  // Extract distinctive words from candidate (numbers, remake/remaster, HD, version indicators, sequel indicators)
  // These MUST be present in the result for it to be considered relevant
  const distinctiveWords = lowerCandidate
    .split(/\s+/)
    .filter(w => {
      // Numbers (like "4", "2", "III")
      if (/^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return true;
      // Remake/remaster indicators
      if (/remake|remaster|reimagined/i.test(w)) return true;
      // Sequel indicators
      if (/world|part|sequel/i.test(w)) return true;
      // Version indicators (HD, 4K, Definitive Edition, etc.)
      if (/^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w)) return true;
      return false;
    })
    .map(w => w.replace(/[^a-z0-9]/g, ''));
  
  // If candidate has distinctive words, they MUST appear in the result
  if (distinctiveWords.length > 0) {
    const missingDistinctive = distinctiveWords.some(dw => {
      if (dw.length > 0) {
        // Check if this distinctive word appears in the result
        const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
        return !wordPattern.test(lowerResult);
      }
      return false;
    });
    
    if (missingDistinctive) {
      // Distinctive word is missing - this is NOT a match
      return false;
    }
  }
  
  // Check for conflicting words - if candidate has "4" and "remake", result shouldn't have "archives" without "4"
  // This catches cases like "Resident Evil 4 Remake" vs "Resident Evil Archives"
  if (lowerCandidate.includes('4') && lowerCandidate.includes('remake')) {
    if (lowerResult.includes('archives') && !lowerResult.includes('4')) {
      return false; // "Archives" without "4" is a different game
    }
  }
  
  // Extract meaningful words from each (filter out common words)
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'what', 'which', 'where', 'when', 'why', 'how', 'who', 'can', 'could', 'would', 'should',
    'game', 'games', 'play', 'player', 'playing', 'get', 'got', 'how', 'best', 'way'
  ]);
  
  const extractMeaningfulWords = (text: string): Set<string> => {
    return new Set(
      text
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !commonWords.has(w))
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length > 2)
    );
  };
  
  const resultWords = extractMeaningfulWords(apiResult);
  const questionWords = extractMeaningfulWords(question);
  const candidateWords = extractMeaningfulWords(candidate);
  
  // Check if result shares words with candidate (strong indicator of relevance)
  const candidateMatches = Array.from(resultWords).filter(w => candidateWords.has(w));
  if (candidateMatches.length >= 2) {
    return true; // Strong match with candidate
  }
  
  // Check if result shares words with question
  const questionMatches = Array.from(resultWords).filter(w => questionWords.has(w));
  
  // For short results (likely game titles), require at least 1 meaningful match
  // For longer results, require at least 2 matches
  const minMatches = apiResult.split(/\s+/).length <= 6 ? 1 : 2;
  
  if (questionMatches.length >= minMatches) {
    return true;
  }
  
  // If no meaningful matches, the result is likely irrelevant
  // Exception: if the candidate itself was very short or generic, be more lenient
  if (candidate.split(/\s+/).length <= 2 && questionMatches.length >= 1) {
    return true;
  }
  
  return false;
}

/**
 * Extract console name from question if it's about a console, not a game
 * Returns console name if detected, undefined otherwise
 */
function extractConsoleFromQuestion(question: string): string | undefined {
  const lowerQuestion = question.toLowerCase();
  
  // Console patterns - check for console-specific questions
  const consolePatterns: { [key: string]: RegExp[] } = {
    'Nintendo Switch 2': [
      /nintendo\s+switch\s+2/i,
      /switch\s+2/i
    ],
    'Nintendo Switch': [
      /nintendo\s+switch(?!\s+2)/i,
      /\bswitch\b(?!\s+2)/i
    ],
    'PlayStation 5': [/playstation\s+5/i, /ps5/i],
    'PlayStation 4': [/playstation\s+4/i, /ps4/i],
    'PlayStation 3': [/playstation\s+3/i, /ps3/i],
    'Xbox Series X': [/xbox\s+series\s+x/i, /xsx/i],
    'Xbox Series S': [/xbox\s+series\s+s/i, /xss/i],
    'Xbox One': [/xbox\s+one/i],
    'Xbox 360': [/xbox\s+360/i],
    'PC': [/\b(pc|steam|epic|gog)\b(?!\s+engine)/i],
    'Wii U': [/wii\s+u/i],
    'Nintendo Wii': [/nintendo\s+wii\b(?!\s+u)/i],
    'GameCube': [/gamecube|game\s+cube/i],
    'Nintendo 64': [/nintendo\s+64|n64/i],
    'Nintendo 3DS': [/nintendo\s+3ds/i],
    'Nintendo DS': [/nintendo\s+ds/i],
    'Nintendo DSi': [/nintendo\s+dsi/i],
    'Nintendo Game Boy': [/nintendo\s+game\s+boy/i],
    'Nintendo Game Boy Advance': [/nintendo\s+game\s+boy\s+advance/i],
    'Nintendo Game Boy Color': [/nintendo\s+game\s+boy\s+color/i],
    'PlayStation Portable': [/playstation\s+portable/i],
    'PlayStation Vita': [/playstation\s+vita/i],
    'PlayStation 2': [/playstation\s+2/i],
    'PlayStation': [/playstation\s/i],
    'Xbox ': [/xbox\s/i],
    'Super Nintendo Entertainment System': [/super\s+nintendo\s+entertainment\s+system/i],
    'Nintendo Entertainment System': [/nintendo\s+entertainment\s+system/i],
    'Sega Genesis': [/sega\s+genesis/i],
    'Sega Saturn': [/sega\s+saturn/i],
    'Sega Dreamcast': [/sega\s+dreamcast/i],
    'Sega Master System': [/sega\s+master\s+system/i],
    'TurboGrafx-16': [/turbo\s+grafx-16/i],
    'Atari 2600': [/atari\s+2600/i],
    'Magnavox Odyssey': [/magnavox\s+odyssey/i],
    'Commodore 64': [/commodore\s+64/i],
    'Amiga': [/amiga/i],
    'PC Engine': [/pc\s+engine|pc-engine|turbo\s*grafx-?16/i],
    'Sega CD': [/sega\s+cd/i],
    'MSX': [/msx/i],
    'ColecoVision': [/coleco\s+vision/i],
    'Intellivision': [/intellivision/i],
    'Neo Geo': [/neo\s+geo/i],
    'Neo Geo Pocket': [/neo\s+geo\s+pocket/i],
    'Sega Game Gear': [/sega\s+game\s+gear/i],
    'Atari Jaguar': [/atari\s+jaguar/i],
    'Virtual Boy': [/virtual\s+boy/i],
    'Arcade': [/arcade/i],
    'Meta Quest 3': [/meta\s+quest\s+3/i],
    'Meta Quest 2': [/meta\s+quest\s+2/i]
  };
  
  // Check if question is about console (price, release date, specs, etc.)
  const consoleQuestionIndicators = [
    /price|cost|how\s+much|release\s+date|when\s+(was|is|did).*release|specs|specifications|features|console/i
  ];
  
  const isConsoleQuestion = consoleQuestionIndicators.some(pattern => pattern.test(question));
  
  if (isConsoleQuestion) {
    // Check for console patterns in order of specificity (longer names first)
    const sortedConsoles = Object.entries(consolePatterns).sort((a, b) => b[0].length - a[0].length);
    
    for (const [consoleName, patterns] of sortedConsoles) {
      if (patterns.some(pattern => pattern.test(question))) {
        return consoleName;
      }
    }
  }
  
  return undefined;
}

/**
 * Use OpenAI to extract game title from question when IGDB/RAWG fail or return incorrect results
 * This is a fallback for cases where API data is out of date or incorrect
 */
async function extractGameTitleWithOpenAI(question: string, candidates: string[]): Promise<string | undefined> {
  try {
    const openai = getOpenAIClient();
    
    // Build context about candidates we've already tried
    const candidatesContext = candidates.length > 0 
      ? `\n\nPotential game titles found in the question: ${candidates.slice(0, 3).join(', ')}`
      : '';
    
    const prompt = `Extract the exact game title from this question. Return ONLY the game title, nothing else. If no game title is present, return "NONE".

Question: "${question}"${candidatesContext}

Examples:
- "Which character is best in Super Smash Bros. Ultimate?" → "Super Smash Bros. Ultimate"
- "How do I beat the final boss in The Legend of Zelda: Breath of the Wild?" → "The Legend of Zelda: Breath of the Wild"
- "What are the best games for Switch?" → "NONE"
- "Tell me about Mario" → "NONE" (too vague, could be character or game series)

Game title:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a game title extraction assistant. Extract only the specific game title from questions. Return "NONE" if the question is too vague or doesn\'t mention a specific game.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2, // Low temperature for consistent extraction
      max_tokens: 200,
    });

    const extractedTitle = completion.choices[0]?.message?.content?.trim();
    
    if (!extractedTitle || extractedTitle === 'NONE' || extractedTitle.toLowerCase().includes('none')) {
      return undefined;
    }

    // Clean up the response (remove quotes, extra text)
    let cleanedTitle = extractedTitle
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .replace(/^Game title:\s*/i, '') // Remove "Game title:" prefix if present
      .trim();

    // Basic validation: should be reasonable length and format
    if (cleanedTitle.length < 3 || cleanedTitle.length > 100) {
      return undefined;
    }

    // Try to validate against IGDB/RAWG if possible
    try {
      const igdbMatch = await searchGameInIGDB(cleanedTitle);
      if (igdbMatch) {
        console.log(`[Game Title] OpenAI extracted "${cleanedTitle}", validated with IGDB: "${igdbMatch}"`);
        return normalizeGameTitle(igdbMatch);
      }
      
      const rawgMatch = await searchGameInRAWG(cleanedTitle);
      if (rawgMatch) {
        console.log(`[Game Title] OpenAI extracted "${cleanedTitle}", validated with RAWG: "${rawgMatch}"`);
        return normalizeGameTitle(rawgMatch);
      }
    } catch (validationError) {
      // If validation fails, still return the OpenAI result (it's better than nothing)
      console.log(`[Game Title] OpenAI extracted "${cleanedTitle}" but validation failed, using OpenAI result`);
    }

    // Return OpenAI result even if validation failed (it's likely correct)
    console.log(`[Game Title] Using OpenAI-extracted title: "${cleanedTitle}"`);
    return normalizeGameTitle(cleanedTitle);
  } catch (error) {
    console.error('[Game Title] OpenAI extraction failed:', error instanceof Error ? error.message : 'Unknown error');
    return undefined;
  }
}

/**
 * Extract game title from question text using IGDB and RAWG APIs for verification
 * This eliminates the need for hardcoded game title lists
 * Also detects consoles if the question is about a console, not a game
 * Falls back to OpenAI extraction if IGDB/RAWG fail or return incorrect results
 */
export async function extractGameTitleFromQuestion(question: string): Promise<string | undefined> {
  if (!question || question.length < 3) {
    // console.log('[Game Title] Question too short');
    return undefined;
  }

  // Skip game title extraction for recommendation questions
  // These are general questions about game recommendations, not about specific games
  const lowerQuestion = question.toLowerCase();
  const isRecommendationQuestion = 
    /best\s+.*?\s+games?\s+(for|right now|currently|to play|that|which)/i.test(question) ||
    /what\s+(are|is)\s+the\s+best\s+.*?\s+games?/i.test(question) ||
    /recommend.*?\s+(me\s+)?(some|a|the\s+best)\s+.*?\s+games?/i.test(question) ||
    /what\s+(should|game)\s+(should|can)\s+i\s+play/i.test(question) ||
    /give\s+me\s+(a\s+)?(random\s+)?game\s+recommendation/i.test(question);
  
  if (isRecommendationQuestion) {
    // console.log('[Game Title] Skipping extraction for recommendation question');
    return undefined;
  }

  // First, check if this is a console question
  const detectedConsole = extractConsoleFromQuestion(question);
  if (detectedConsole) {
    console.log(`[Game Title] Detected console: ${detectedConsole}`);
    return detectedConsole;
  }

  try {
    // Extract potential game title candidates
    let candidates = extractGameTitleCandidates(question);
    
    if (candidates.length === 0) {
      console.log('[Game Title] No candidates extracted from question');
      return undefined;
    }

    // Candidates are already prioritized by extractGameTitleCandidates
    // (prioritizes "in [Game Title]" patterns, penalizes character names, etc.)
    
    console.log(`[Game Title] Extracted ${candidates.length} candidate(s):`, candidates);

    // Try each candidate against IGDB and RAWG APIs
    // Validate candidates before API calls to avoid unnecessary requests
    let validCandidates = candidates.filter(c => isValidGameTitleCandidate(c));
    
    // CRITICAL: Identify candidates from "in [Game Title]" patterns
    // These should be tried FIRST, before any other candidates
    // IMPORTANT: Updated regex to capture full game titles including colons (e.g., "The Legend of Zelda: Breath of the Wild")
    const inGamePatternCandidates = new Set<string>();
    // Updated to include "Ultimate" and "Deluxe" in version indicators to ensure they're captured
    // CRITICAL: Include period (.) in character class to capture "Super Smash Bros. Ultimate"
    const inGamePatternRegex = /\b(?:in|for|from|on|of)\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-\.]+?(?:\s*:\s*[A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-\.]+?)?(?:\s+(?:Ultimate|Deluxe|Remake|Remaster|Reimagined|HD|4K|Definitive|Edition|Complete|Collection|2|II|3|III|4|IV|World\s*2|World\s*II))?)(?:\s+(?:how|what|where|when|why|which|who|is|does|do|has|have|can|could|would|should|was|were|will|did)|$|[?.!])/gi;
    let inGameMatch: RegExpExecArray | null;
    while ((inGameMatch = inGamePatternRegex.exec(question)) !== null) {
      if (inGameMatch[1]) {
        let candidate = inGameMatch[1].trim();
        candidate = candidate.replace(/^(?:what|which|where|when|why|how|who|the|a|an)\s+/i, '');
        candidate = candidate.replace(/\s+(?:has|have|is|are|does|do|can|could|would|should|was|were|will|did)$/i, '');
        if (candidate.length >= 3) {
          const normalized = candidate.toLowerCase();
          validCandidates.forEach(c => {
            const cLower = c.toLowerCase();
            if (cLower === normalized || cLower.includes(normalized) || normalized.includes(cLower)) {
              inGamePatternCandidates.add(c);
            }
          });
        }
      }
    }
    
    // Reorder candidates: "in [Game Title]" candidates FIRST
    if (inGamePatternCandidates.size > 0) {
      const inGameCandidates = validCandidates.filter(c => inGamePatternCandidates.has(c));
      const otherCandidates = validCandidates.filter(c => !inGamePatternCandidates.has(c));
      validCandidates = [...inGameCandidates, ...otherCandidates];
    }
    
    // CRITICAL: Prioritize longer, more specific candidates
    // If one candidate contains another (e.g., "Super Mario Bros. Wonder" contains "Super Mario Bros."),
    // try the longer one first as it's more specific
    validCandidates.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      
      // If one contains the other, prioritize the longer one
      if (aLower.includes(bLower) && a.length > b.length) {
        return -1; // a comes first
      }
      if (bLower.includes(aLower) && b.length > a.length) {
        return 1; // b comes first
      }
      
      // Otherwise, sort by length (longer first) for more specific matches
      return b.length - a.length;
    });
    
    // Additional validation: If we have multiple candidates, check if first candidate
    // appears before an "in [Game Title]" pattern (likely a character/enemy/location)
    if (validCandidates.length > 1) {
      const firstCandidate = validCandidates[0];
      const lowerQuestion = question.toLowerCase();
      const firstCandidateLower = firstCandidate.toLowerCase();
      const firstCandidateIndex = lowerQuestion.indexOf(firstCandidateLower);
      
      // Check if there's an "in [Game Title]" pattern after this candidate
      if (firstCandidateIndex >= 0 && !inGamePatternCandidates.has(firstCandidate)) {
        const textAfter = question.substring(firstCandidateIndex + firstCandidate.length);
        // Updated regex to capture full game titles including colons
        // Include period (.) to capture full titles like "Super Smash Bros. Ultimate"
        const inGamePatternAfter = /\bin\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-\.]+?(?:\s*:\s*[A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-\.]+?)?(?:\s+(?:Ultimate|Deluxe|Remake|Remaster|Reimagined|HD|4K|Definitive|Edition|Complete|Collection|2|II|3|III|4|IV|World\s*2|World\s*II))?)/i;
        const afterMatch = textAfter.match(inGamePatternAfter);
        
        // If first candidate is short (1-3 words) and there's a longer candidate after "in",
        // skip the first candidate entirely (it's likely a character/enemy/location)
        if (afterMatch && afterMatch[1]) {
          const wordCount = firstCandidate.split(/\s+/).length;
          const afterCandidateWordCount = afterMatch[1].trim().split(/\s+/).length;
          // Remove short candidates (1-3 words) that appear before longer "in [Game Title]" candidates
          if (wordCount <= 3 && firstCandidate.length < 40 && afterCandidateWordCount > wordCount) {
            // Remove this candidate from the list - it's likely not a game title
            validCandidates = validCandidates.filter(c => c !== firstCandidate);
          }
        }
      }
    }
    
    for (const candidate of validCandidates) {
      console.log(`[Game Title] Trying candidate: "${candidate}"`);
      
      // CRITICAL: If this candidate appears before an "in [Game Title]" pattern and is short,
      // and we have an "in [Game Title]" candidate available, skip this candidate entirely
      if (!inGamePatternCandidates.has(candidate)) {
        const candidateLower = candidate.toLowerCase();
        const candidateIndex = question.toLowerCase().indexOf(candidateLower);
        
        if (candidateIndex >= 0) {
          const textAfter = question.substring(candidateIndex + candidate.length);
          // Updated regex to capture full game titles including colons
          // Include period (.) to capture full titles like "Super Smash Bros. Ultimate"
        const inGamePatternAfter = /\bin\s+(?:the\s+)?([A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-\.]+?(?:\s*:\s*[A-ZÀ-ÿĀ-ž][A-Za-z0-9À-ÿĀ-ž\s:'&\-\.]+?)?(?:\s+(?:Ultimate|Deluxe|Remake|Remaster|Reimagined|HD|4K|Definitive|Edition|Complete|Collection|2|II|3|III|4|IV|World\s*2|World\s*II))?)/i;
          const afterMatch = textAfter.match(inGamePatternAfter);
          
          if (afterMatch && afterMatch[1] && inGamePatternCandidates.size > 0) {
            // This candidate appears before "in [Game Title]" and we have "in [Game Title]" candidates
            const wordCount = candidate.split(/\s+/).length;
            const afterCandidateWordCount = afterMatch[1].trim().split(/\s+/).length;
            // Skip short candidates (1-3 words) that appear before longer "in [Game Title]" candidates
            if (wordCount <= 3 && candidate.length < 40 && afterCandidateWordCount > wordCount) {
              // Skip this candidate - it's likely a character/enemy/location, not a game title
              continue;
            }
          }
        }
      }
      
      // Try IGDB first
      try {
        console.log(`[Game Title] Searching IGDB for candidate: "${candidate}"`);
        const igdbMatch = await searchGameInIGDB(candidate);
        console.log(`[Game Title] IGDB returned: "${igdbMatch}" for candidate: "${candidate}"`);
        if (igdbMatch) {
          // CRITICAL: If this is a short candidate and we have "in [Game Title]" candidates,
          // validate that the API result is actually a game, not game content
          if (!inGamePatternCandidates.has(candidate) && inGamePatternCandidates.size > 0) {
            const wordCount = candidate.split(/\s+/).length;
            if (wordCount <= 3 && candidate.length < 40) {
              // This is a short candidate that appears before "in [Game Title]"
              // The API result might be game content (boss, character, etc.), not a game
              // Skip this result and try the "in [Game Title]" candidates instead
              continue;
            }
          }
          // STRICT VALIDATION: Check if distinctive words from candidate are in the result
          const candidateLower = candidate.toLowerCase();
          const resultLower = igdbMatch.toLowerCase();
          
          // Extract distinctive words (numbers, remake/remaster, HD, version indicators, sequel indicators)
          const distinctiveWords = candidateLower
            .split(/\s+/)
            .filter(w => {
              if (/^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return true;
              if (/remake|remaster|reimagined/i.test(w)) return true;
              if (/world|part|sequel/i.test(w)) return true;
              if (/^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w)) return true;
              return false;
            })
            .map(w => w.replace(/[^a-z0-9]/g, ''));
          
          // If candidate has distinctive words, they MUST be in the result
          if (distinctiveWords.length > 0) {
            const missingDistinctive = distinctiveWords.some(dw => {
              if (dw.length > 0) {
                const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
                return !wordPattern.test(resultLower);
              }
              return false;
            });
            
            if (missingDistinctive) {
              // console.log(`[Game Title] Rejecting IGDB result - missing distinctive words: "${igdbMatch}" vs candidate "${candidate}"`);
              continue; // Try next candidate
            }
          }
          
          // Check for conflicting patterns (e.g., "Archives" when candidate has "4 Remake")
          if (candidateLower.includes('4') && candidateLower.includes('remake')) {
            if (resultLower.includes('archives') && !resultLower.includes('4')) {
              // console.log(`[Game Title] Rejecting IGDB result - conflicting pattern: "${igdbMatch}"`);
              continue;
            }
          }
          
          // Validate that the API result doesn't contain unexpected words
          if (!isValidAPIResult(igdbMatch, candidate)) {
            // console.log(`[Game Title] Rejecting IGDB result with unexpected words: "${igdbMatch}"`);
            continue; // Try next candidate
          }
          
          // Validate that the API result is relevant to the question
          if (!isAPIResultRelevantToQuestion(igdbMatch, question, candidate)) {
            // console.log(`[Game Title] Rejecting IGDB result as irrelevant to question: "${igdbMatch}"`);
            continue; // Try next candidate
          }
          
          // Additional validation: reject if API returned a bundle and we can extract base game
          if (isBundleOrDLC(igdbMatch)) {
            // Check which specific game from the bundle is mentioned in the question
            const relevantGame = findRelevantGameFromBundle(igdbMatch, question);
            if (relevantGame && relevantGame !== igdbMatch && isValidGameTitleCandidate(relevantGame)) {
              // Try to find the specific game in a follow-up search
              const specificGameMatch = await searchGameInIGDB(relevantGame);
              if (specificGameMatch && !isBundleOrDLC(specificGameMatch) && 
                  isValidAPIResult(specificGameMatch, relevantGame) &&
                  isAPIResultRelevantToQuestion(specificGameMatch, question, relevantGame)) {
                // console.log(`[Game Title] Found specific game from bundle in IGDB: "${candidate}" -> "${specificGameMatch}"`);
                return normalizeGameTitle(specificGameMatch);
              }
              // If no match found, use the relevant game we extracted (validate it first)
              if (isValidAPIResult(relevantGame, candidate) && 
                  isAPIResultRelevantToQuestion(relevantGame, question, candidate)) {
                // console.log(`[Game Title] Found match in IGDB (extracted from bundle): "${candidate}" -> "${relevantGame}"`);
                return normalizeGameTitle(relevantGame);
              }
            }
            // Fallback to base game extraction if relevance check fails
            const baseGame = extractBaseGameFromBundle(igdbMatch);
            if (baseGame !== igdbMatch && isValidGameTitleCandidate(baseGame)) {
              // Try to find the base game in a follow-up search
              const baseGameMatch = await searchGameInIGDB(baseGame);
              if (baseGameMatch && !isBundleOrDLC(baseGameMatch) && 
                  isValidAPIResult(baseGameMatch, baseGame) &&
                  isAPIResultRelevantToQuestion(baseGameMatch, question, baseGame)) {
                // console.log(`[Game Title] Found base game in IGDB: "${candidate}" -> "${baseGameMatch}"`);
                return normalizeGameTitle(baseGameMatch);
              }
              // If no base game found, use cleaned version (validate it first)
              if (isValidAPIResult(baseGame, candidate) && 
                  isAPIResultRelevantToQuestion(baseGame, question, candidate)) {
                // console.log(`[Game Title] Found match in IGDB (cleaned from bundle): "${candidate}" -> "${baseGame}"`);
                return normalizeGameTitle(baseGame);
              }
            }
          }
          console.log(`[Game Title] Found match in IGDB: "${candidate}" -> "${igdbMatch}"`);
          // Normalize the title (e.g., ensure "The Legend of Zelda" has "The")
          return normalizeGameTitle(igdbMatch);
        }
      } catch (error) {
        // Only log errors, not failures
        // console.log(`[Game Title] IGDB search failed for "${candidate}":`, error instanceof Error ? error.message : 'Unknown error');
      }

      // Try RAWG as fallback
      try {
        const rawgMatch = await searchGameInRAWG(candidate);
        if (rawgMatch) {
          // CRITICAL: If this is a short candidate and we have "in [Game Title]" candidates,
          // validate that the API result is actually a game, not game content
          if (!inGamePatternCandidates.has(candidate) && inGamePatternCandidates.size > 0) {
            const wordCount = candidate.split(/\s+/).length;
            if (wordCount <= 3 && candidate.length < 40) {
              // This is a short candidate that appears before "in [Game Title]"
              // The API result might be game content (boss, character, etc.), not a game
              // Skip this result and try the "in [Game Title]" candidates instead
              continue;
            }
          }
          // STRICT VALIDATION: Check if distinctive words from candidate are in the result
          const candidateLower = candidate.toLowerCase();
          const resultLower = rawgMatch.toLowerCase();
          
          // Extract distinctive words (numbers, remake/remaster, HD, version indicators, sequel indicators)
          const distinctiveWords = candidateLower
            .split(/\s+/)
            .filter(w => {
              if (/^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return true;
              if (/remake|remaster|reimagined/i.test(w)) return true;
              if (/world|part|sequel/i.test(w)) return true;
              if (/^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w)) return true;
              return false;
            })
            .map(w => w.replace(/[^a-z0-9]/g, ''));
          
          // If candidate has distinctive words, they MUST be in the result
          if (distinctiveWords.length > 0) {
            const missingDistinctive = distinctiveWords.some(dw => {
              if (dw.length > 0) {
                const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
                return !wordPattern.test(resultLower);
              }
              return false;
            });
            
            if (missingDistinctive) {
              // console.log(`[Game Title] Rejecting RAWG result - missing distinctive words: "${rawgMatch}" vs candidate "${candidate}"`);
              continue; // Try next candidate
            }
          }
          
          // Check for conflicting patterns
          if (candidateLower.includes('4') && candidateLower.includes('remake')) {
            if (resultLower.includes('archives') && !resultLower.includes('4')) {
              // console.log(`[Game Title] Rejecting RAWG result - conflicting pattern: "${rawgMatch}"`);
              continue;
            }
          }
          
          // Validate that the API result doesn't contain unexpected words
          if (!isValidAPIResult(rawgMatch, candidate)) {
            // console.log(`[Game Title] Rejecting RAWG result with unexpected words: "${rawgMatch}"`);
            continue; // Try next candidate
          }
          
          // Validate that the API result is relevant to the question
          if (!isAPIResultRelevantToQuestion(rawgMatch, question, candidate)) {
            // console.log(`[Game Title] Rejecting RAWG result as irrelevant to question: "${rawgMatch}"`);
            continue; // Try next candidate
          }
          
          // Additional validation: reject if API returned a bundle and we can extract base game
          if (isBundleOrDLC(rawgMatch)) {
            // Check which specific game from the bundle is mentioned in the question
            const relevantGame = findRelevantGameFromBundle(rawgMatch, question);
            if (relevantGame && relevantGame !== rawgMatch && isValidGameTitleCandidate(relevantGame)) {
              // Try to find the specific game in a follow-up search
              const specificGameMatch = await searchGameInRAWG(relevantGame);
              if (specificGameMatch && !isBundleOrDLC(specificGameMatch) && 
                  isValidAPIResult(specificGameMatch, relevantGame) &&
                  isAPIResultRelevantToQuestion(specificGameMatch, question, relevantGame)) {
                // console.log(`[Game Title] Found specific game from bundle in RAWG: "${candidate}" -> "${specificGameMatch}"`);
                return normalizeGameTitle(specificGameMatch);
              }
              // If no match found, use the relevant game we extracted (validate it first)
              if (isValidAPIResult(relevantGame, candidate) && 
                  isAPIResultRelevantToQuestion(relevantGame, question, candidate)) {
                // console.log(`[Game Title] Found match in RAWG (extracted from bundle): "${candidate}" -> "${relevantGame}"`);
                return normalizeGameTitle(relevantGame);
              }
            }
            // Fallback to base game extraction if relevance check fails
            const baseGame = extractBaseGameFromBundle(rawgMatch);
            if (baseGame !== rawgMatch && isValidGameTitleCandidate(baseGame)) {
              // Try to find the base game in a follow-up search
              const baseGameMatch = await searchGameInRAWG(baseGame);
              if (baseGameMatch && !isBundleOrDLC(baseGameMatch) && 
                  isValidAPIResult(baseGameMatch, baseGame) &&
                  isAPIResultRelevantToQuestion(baseGameMatch, question, baseGame)) {
                // console.log(`[Game Title] Found base game in RAWG: "${candidate}" -> "${baseGameMatch}"`);
                return normalizeGameTitle(baseGameMatch);
              }
              // If no base game found, use cleaned version (validate it first)
              if (isValidAPIResult(baseGame, candidate) && 
                  isAPIResultRelevantToQuestion(baseGame, question, candidate)) {
                // console.log(`[Game Title] Found match in RAWG (cleaned from bundle): "${candidate}" -> "${baseGame}"`);
                return normalizeGameTitle(baseGame);
              }
            }
          }
          // console.log(`[Game Title] Found match in RAWG: "${candidate}" -> "${rawgMatch}"`);
          // Normalize the title (e.g., ensure "The Legend of Zelda" has "The")
          return normalizeGameTitle(rawgMatch);
        }
      } catch (error) {
        // Only log errors, not failures
        // console.log(`[Game Title] RAWG search failed for "${candidate}":`, error instanceof Error ? error.message : 'Unknown error');
      }
    }

    // If no API matches, try OpenAI as a fallback before using regex candidates
    // This helps when IGDB/RAWG data is out of date or incorrect
    if (candidates.length > 0) {
      console.log(`[Game Title] IGDB/RAWG failed for all candidates, trying OpenAI extraction...`);
      const openaiTitle = await extractGameTitleWithOpenAI(question, candidates);
      if (openaiTitle) {
        return openaiTitle;
      }
    }

    // If no API matches and OpenAI failed, try to find the best candidate
    // Filter out candidates that look like they contain question text, not game titles
    const fallbackCandidates = candidates.filter(c => {
      const lower = c.toLowerCase();
      // Reject candidates that contain common question phrases
      if (lower.includes('has the') || 
          lower.includes('has highest') ||
          lower.includes('has best') ||
          lower.includes('kart has') ||
          lower.includes('is the') ||
          lower.includes('CTGP') ||
          lower.includes('has the lowest') ||
          lower.includes('has the worst') ||
          lower.includes('has the slowest') ||
          lower.includes('has the easiest') ||
          lower.includes('has the hardest') ||
          lower.match(/\b(has|have|is|are|does|do)\s+(the|a|an)\s+/)) {
        return false;
      }
      // Prefer candidates that are reasonable length (3-40 chars) and start with capital or special char
      return c.length >= 3 && c.length <= 40 && /^[A-ZÀ-ÿĀ-ž]/.test(c);
    });
    
    // If we have valid candidates, return the shortest one (likely to be the actual game title)
    if (fallbackCandidates.length > 0) {
      const bestCandidate = fallbackCandidates.sort((a, b) => a.length - b.length)[0];
      // console.log(`[Game Title] No API match for any candidate, using best fallback: "${bestCandidate}"`);
      return bestCandidate;
    }
    
    // Last resort: return first candidate that meets basic criteria
    const fallbackCandidate = candidates.find(c => 
      c.length >= 5 && 
      c.split(/\s+/).length >= 2 && 
      /^[A-ZÀ-ÿĀ-ž]/.test(c)
    );
    
    if (fallbackCandidate) {
      // console.log(`[Game Title] Using fallback candidate: "${fallbackCandidate}"`);
      return fallbackCandidate;
    }

    // console.log('[Game Title] No valid game title found after trying all candidates');
    return undefined;
  } catch (error) {
    console.error('[Game Title] Error in extractGameTitleFromQuestion:', error);
    return undefined;
  }
}


/**
 * Determine question category based on content analysis
 * Note: Order matters - more specific patterns should be checked first,
 * but "how to" questions should be general_gameplay unless they match more specific patterns
 */
function detectQuestionCategory(question: string): string | undefined {
  const lowerQuestion = question.toLowerCase();

  // Boss fight patterns
  if (/(boss|boss fight|boss battle|defeat boss|beat the boss|final boss|superboss)/i.test(lowerQuestion)) {
    return 'boss_fight';
  }

  // Strategy patterns (check before general "how to" to catch strategy questions)
  if (/(strategy|tactic|best build|loadout|optimal|build guide|meta|best way to|how should i)/i.test(lowerQuestion)) {
    return 'strategy';
  }

  // Item lookup patterns (check before general "how to" to catch item questions)
  if (/(item|weapon|armor|equipment|gear|what does|item description|where to find)/i.test(lowerQuestion)) {
    // But exclude if it's a general "how to" question about items
    if (!/^how to/i.test(lowerQuestion)) {
      return 'item_lookup';
    }
  }

  // Character patterns
  if (/(character|class|hero|champion|who should i|character build|which character)/i.test(lowerQuestion)) {
    return 'character';
  }

  // Level/walkthrough patterns (check BEFORE general "how to" to catch level questions)
  // This includes "how to beat the level", "how to complete", etc.
  if (/(walkthrough|guide|how to get|how to reach|how do i get|location|where is|find|locate|how to clear|how to complete|how to beat.*level|how to beat.*stage|how to beat.*area|temple|dungeon|area|level|stage|mission|quest)/i.test(lowerQuestion)) {
    return 'level_walkthrough';
  }

  // Achievement/completion patterns - but only if it's specifically about achievements/trophies
  // Don't match just "unlock" if it's part of "how to unlock" (general gameplay)
  if (/^(how to|what is|explain|tell me about|help with)/i.test(lowerQuestion)) {
    // If it starts with general gameplay phrases, check if it's specifically about achievements
    if (/(achievement|trophy|100%|complete|completion|collect all)/i.test(lowerQuestion)) {
      return 'achievement';
    }
    // Otherwise, it's general gameplay
    return 'general_gameplay';
  }
  
  // Achievement pattern for questions that mention achievements but don't start with "how to"
  if (/(achievement|trophy|100%|complete|completion|collect all|unlock)/i.test(lowerQuestion)) {
    return 'achievement';
  }

  // Performance/technical patterns
  if (/(performance|fps|lag|optimization|settings|graphics|stuttering|bug|glitch)/i.test(lowerQuestion)) {
    return 'technical';
  }

  // General gameplay - catch-all for "how to", "what is", "explain", etc.
  if (/(how to|what is|explain|tell me about|help with)/i.test(lowerQuestion)) {
    return 'general_gameplay';
  }

  return undefined;
}

/**
 * Estimate difficulty level based on question content
 */
function estimateDifficultyHint(question: string): string | undefined {
  const lowerQuestion = question.toLowerCase();

  // Beginner indicators
  const beginnerPatterns = [
    /how do i start/i,
    /beginner/i,
    /new player/i,
    /first time/i,
    /tutorial/i,
    /basics?/i,
    /easy/i,
    /simple/i,
    /what is/i,
    /explain/i
  ];

  // Advanced indicators
  const advancedPatterns = [
    /advanced/i,
    /expert/i,
    /optimal/i,
    /min-max/i,
    /speedrun/i,
    /world record/i,
    /pro/i,
    /competitive/i,
    /ranked/i,
    /meta/i,
    /best build/i,
    /optimize/i
  ];

  // Intermediate indicators
  const intermediatePatterns = [
    /strategy/i,
    /tactic/i,
    /improve/i,
    /better/i,
    /tips/i,
    /guide/i,
    /walkthrough/i
  ];

  if (advancedPatterns.some(pattern => pattern.test(lowerQuestion))) {
    return 'advanced';
  }

  if (beginnerPatterns.some(pattern => pattern.test(lowerQuestion))) {
    return 'beginner';
  }

  if (intermediatePatterns.some(pattern => pattern.test(lowerQuestion))) {
    return 'intermediate';
  }

  // Default to intermediate if question is long and detailed
  if (question.length > 50) {
    return 'intermediate';
  }

  return undefined;
}

/**
 * Determine interaction type based on question format and content
 */
function detectInteractionType(question: string): string | undefined {
  const lowerQuestion = question.toLowerCase();
  const questionLength = question.length;

  // Quick fact - simple factual questions about release dates, platforms, developers, publishers
  // These are informational queries that get quick factual responses
  if (/when (was|is)|released|release date|what (platform|system|console|developer|publisher|studio|company|year)|who (developed|published|made|created)/i.test(lowerQuestion)) {
    return 'quick_fact';
  }

  // Strategy/tips - questions about strategies, best practices, tips, how-to questions
  // Check this before detailed_guide to catch simple "how to" questions
  if (/strategy|strategies|best (way|method|approach|build|character|class|weapon|item)|tip|tips|how (do|can|should|to) (i|you)/i.test(lowerQuestion)) {
    // If it's a long question with "how to", it might be a detailed guide
    if (questionLength > 80 && /how to/i.test(lowerQuestion)) {
      return 'detailed_guide';
    }
    return 'strategy_tip';
  }

  // Item lookup - specific item/equipment questions
  if (/what (is|does|are)|item|weapon|armor|equipment|gear|unlock|obtain|get|find/i.test(lowerQuestion)) {
    return 'item_lookup';
  }

  // Detailed guide - longer questions with multiple requests or detailed context
  if (questionLength > 100 || /guide|walkthrough|explain|detailed|step by step|comprehensive|tutorial/i.test(lowerQuestion)) {
    return 'detailed_guide';
  }

  // Comparison - questions asking to compare options
  if (/(vs|versus|compared to|better|which (is|should|do)|difference between)/i.test(lowerQuestion)) {
    return 'comparison';
  }

  // Quick answer - very short questions (< 30 chars)
  if (questionLength < 30) {
    return 'quick_answer';
  }

  // Fast tip - short, direct questions (30-60 chars)
  if (questionLength < 60 && /^(what|where|when|how|who|which|is|can|does|do)\s+/i.test(question)) {
    return 'fast_tip';
  }

  // Default to detailed_guide for longer questions (> 60 chars)
  if (questionLength > 60) {
    return 'detailed_guide';
  }

  // Fallback to fast_tip for medium-length questions
  return 'fast_tip';
}

/**
 * Extract comprehensive metadata from a question
 * Phase 2 Step 1: Question Metadata Analysis
 * This function analyzes a question and extracts metadata without affecting the main flow
 */
export const extractQuestionMetadata = async (
  question: string,
  checkQuestionTypeFn?: (question: string) => string[]
): Promise<QuestionMetadata> => {
  try {
    console.log('[Metadata Extraction] Starting metadata extraction for question:', question.substring(0, 100));
    const metadata: QuestionMetadata = {};

    // Extract game title using IGDB/RAWG APIs (async)
    console.log('[Metadata Extraction] Calling extractGameTitleFromQuestion...');
    const detectedGame = await extractGameTitleFromQuestion(question);
    console.log('[Metadata Extraction] extractGameTitleFromQuestion returned:', detectedGame);
    if (detectedGame) {
      metadata.detectedGame = detectedGame;
      console.log('[Metadata Extraction] Detected game:', detectedGame);
    } else {
      console.log('[Metadata Extraction] No game detected from question');
    }

    // Extract genres using the existing checkQuestionType function if provided
    // Otherwise, use a simple fallback
    if (checkQuestionTypeFn) {
      const genres = checkQuestionTypeFn(question);
      if (genres && genres.length > 0) {
        metadata.detectedGenre = genres;
        // console.log('[Metadata Extraction] Detected genres:', genres);
      }
    }

    // Detect question category
    console.log('[Metadata Extraction] Calling detectQuestionCategory...');
    const category = detectQuestionCategory(question);
    console.log('[Metadata Extraction] detectQuestionCategory returned:', category);
    if (category) {
      metadata.questionCategory = category;
      console.log('[Metadata Extraction] Question category:', category);
    } else {
      console.log('[Metadata Extraction] No question category detected');
    }

    // Estimate difficulty
    const difficulty = estimateDifficultyHint(question);
    if (difficulty) {
      metadata.difficultyHint = difficulty;
      // console.log('[Metadata Extraction] Difficulty hint:', difficulty);
    }

    // Detect interaction type
    const interactionType = detectInteractionType(question);
    if (interactionType) {
      metadata.interactionType = interactionType;
      // console.log('[Metadata Extraction] Interaction type:', interactionType);
    }

    // console.log('[Metadata Extraction] Extraction complete. Metadata:', JSON.stringify(metadata, null, 2));
    return metadata;
  } catch (error) {
    console.error('[Metadata Extraction] Error extracting question metadata:', error);
    // Return empty metadata on error - don't break the flow
    return {};
  }
};

/**
 * Update a question document with extracted metadata
 * This runs asynchronously and doesn't block the main response flow
 */
export const updateQuestionMetadata = async (
  questionId: string,
  metadata: QuestionMetadata
): Promise<void> => {
  try {
    // console.log('[Metadata Update] Starting metadata update for question ID:', questionId);
    const Question = (await import('../models/Question')).default;
    
    const updateData: Partial<QuestionMetadata> = {};
    
    // Only update fields that have values
    if (metadata.detectedGame) {
      updateData.detectedGame = metadata.detectedGame;
    }
    if (metadata.detectedGenre && metadata.detectedGenre.length > 0) {
      updateData.detectedGenre = metadata.detectedGenre;
    }
    if (metadata.questionCategory) {
      updateData.questionCategory = metadata.questionCategory;
    }
    if (metadata.difficultyHint) {
      updateData.difficultyHint = metadata.difficultyHint;
    }
    if (metadata.interactionType) {
      updateData.interactionType = metadata.interactionType;
    }

    // Only update if we have at least one field to update
    if (Object.keys(updateData).length > 0) {
      const result = await Question.findByIdAndUpdate(questionId, { $set: updateData }, { new: true });
      // console.log('[Metadata Update] Successfully updated question with metadata:', JSON.stringify(updateData, null, 2));
      // console.log('[Metadata Update] Updated question ID:', questionId);
      // if (result) {
      //   console.log('[Metadata Update] Verified question document updated');
      // }
    } else {
      // console.log('[Metadata Update] No metadata to update (all fields empty)');
    }
  } catch (error) {
    // Log error but don't throw - this is a background operation
    console.error('[Metadata Update] Error updating question metadata:', error);
  }
};

// ============================================================================
// Phase 2 Step 2: Pattern Detection Helper Functions
// ============================================================================

/**
 * Frequency Analysis Helpers
 * These functions analyze question timing patterns
 */

/**
 * Calculate average questions per week from question history
 */
function calculateWeeklyRate(questions: Array<{ timestamp: Date | string | number }>): number {
  if (!questions || questions.length === 0) return 0;
  if (questions.length === 1) return 1; // Single question = 1 per week

  // Sort questions by timestamp
  const sortedQuestions = [...questions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const firstQuestion = new Date(sortedQuestions[0].timestamp);
  const lastQuestion = new Date(sortedQuestions[sortedQuestions.length - 1].timestamp);
  
  // Calculate time span in weeks
  const timeSpanMs = lastQuestion.getTime() - firstQuestion.getTime();
  const timeSpanWeeks = timeSpanMs / (1000 * 60 * 60 * 24 * 7);

  // If questions span less than a day, assume 1 week
  if (timeSpanWeeks < 0.14) {
    return questions.length;
  }

  // Calculate rate
  return questions.length / timeSpanWeeks;
}

/**
 * Detect peak activity hours from question timestamps
 * Returns array of hours (0-23) when user is most active
 */
function detectPeakHours(questions: Array<{ timestamp: Date | string | number }>): number[] {
  if (!questions || questions.length === 0) return [];

  const hourCounts: { [hour: number]: number } = {};
  
  // Count questions by hour of day
  questions.forEach((q) => {
    const hour = new Date(q.timestamp).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });

  // Find hours with above-average activity
  const totalQuestions = questions.length;
  const averagePerHour = totalQuestions / 24;
  const threshold = averagePerHour * 1.5; // 50% above average

  const peakHours = Object.entries(hourCounts)
    .filter(([_, count]) => count >= threshold)
    .map(([hour, _]) => parseInt(hour))
    .sort((a, b) => a - b);

  return peakHours.length > 0 ? peakHours : [];
}

/**
 * Detect session patterns from question timestamps
 * Returns: "daily", "weekly", or "sporadic"
 */
function detectSessionPatterns(questions: Array<{ timestamp: Date | string | number }>): 'daily' | 'weekly' | 'sporadic' {
  if (!questions || questions.length < 2) return 'sporadic';

  const sortedQuestions = [...questions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Calculate time gaps between consecutive questions (in hours)
  const gaps: number[] = [];
  for (let i = 1; i < sortedQuestions.length; i++) {
    const prev = new Date(sortedQuestions[i - 1].timestamp);
    const curr = new Date(sortedQuestions[i].timestamp);
    const gapHours = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60);
    gaps.push(gapHours);
  }

  // Calculate average gap
  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  // Categorize based on average gap
  if (avgGap <= 24) {
    return 'daily'; // Questions within 24 hours on average
  } else if (avgGap <= 168) {
    return 'weekly'; // Questions within a week on average
  } else {
    return 'sporadic'; // Questions more than a week apart
  }
}

/**
 * TEST FUNCTION: Test frequency analysis helpers
 * COMMENTED OUT FOR PRODUCTION - Uncomment for testing/debugging
 * 
 * export const testFrequencyHelpers = async (username: string) => {
 *   try {
 *     const Question = (await import('../models/Question')).default;
 *     
 *     // Get user's questions
 *     const questions = await Question.find({ username })
 *       .sort({ timestamp: -1 })
 *       .limit(100)
 *       .select('timestamp')
 *       .lean();
 * 
 *     if (questions.length === 0) {
 *       console.log('[Test] No questions found for user:', username);
 *       return {
 *         error: 'No questions found',
 *         username,
 *       };
 *     }
 * 
 *     // Ensure questions have timestamp property and convert to expected format
 *     const questionsWithTimestamp = questions
 *       .filter((q: any) => q.timestamp)
 *       .map((q: any) => ({ timestamp: q.timestamp }));
 * 
 *     if (questionsWithTimestamp.length === 0) {
 *       return {
 *         error: 'No questions with valid timestamps found',
 *         username,
 *       };
 *     }
 * 
 *     // Test each helper function
 *     const weeklyRate = calculateWeeklyRate(questionsWithTimestamp);
 *     const peakHours = detectPeakHours(questionsWithTimestamp);
 *     const sessionPattern = detectSessionPatterns(questionsWithTimestamp);
 * 
 *     const results = {
 *       username,
 *       totalQuestions: questions.length,
 *       frequency: {
 *         questionsPerWeek: weeklyRate,
 *         peakActivityHours: peakHours,
 *         sessionPattern: sessionPattern,
 *       },
 *       sampleQuestions: questionsWithTimestamp.slice(0, 5).map(q => ({
 *         timestamp: q.timestamp,
 *         hour: new Date(q.timestamp).getHours(),
 *       })),
 *     };
 * 
 *     console.log('[Test Frequency Helpers] Results:', JSON.stringify(results, null, 2));
 *     return results;
 *   } catch (error) {
 *     console.error('[Test Frequency Helpers] Error:', error);
 *     return {
 *       error: error instanceof Error ? error.message : 'Unknown error',
 *       username,
 *     };
 *   }
 * };
 */

// ============================================================================
// Genre Analysis Helpers
// These functions analyze genre preferences and diversity
// ============================================================================

/**
 * Analyze genre distribution from questions
 * Returns array of genres sorted by frequency (most common first)
 */
function analyzeGenreDistribution(
  questions: Array<{ detectedGenre?: string[] }>
): Array<{ genre: string; count: number; percentage: number }> {
  if (!questions || questions.length === 0) return [];

  const genreCounts: { [genre: string]: number } = {};
  let totalGenreOccurrences = 0;

  // Count genre occurrences
  questions.forEach((q) => {
    if (q.detectedGenre && Array.isArray(q.detectedGenre) && q.detectedGenre.length > 0) {
      q.detectedGenre.forEach((genre) => {
        if (genre && genre.trim()) {
          genreCounts[genre] = (genreCounts[genre] || 0) + 1;
          totalGenreOccurrences++;
        }
      });
    }
  });

  if (totalGenreOccurrences === 0) return [];

  // Convert to array and calculate percentages
  const distribution = Object.entries(genreCounts)
    .map(([genre, count]) => ({
      genre,
      count,
      percentage: (count / totalGenreOccurrences) * 100,
    }))
    .sort((a, b) => b.count - a.count); // Sort by count descending

  return distribution;
}

/**
 * Calculate genre diversity score
 * Returns a number between 0 and 1, where:
 * - 0 = all questions in one genre
 * - 1 = maximum diversity (all genres equally represented)
 */
function calculateDiversity(questions: Array<{ detectedGenre?: string[] }>): number {
  if (!questions || questions.length === 0) return 0;

  const uniqueGenres = new Set<string>();
  const genreCounts: { [genre: string]: number } = {};
  let questionsWithGenres = 0;

  // Collect all unique genres and their counts
  questions.forEach((q) => {
    if (q.detectedGenre && Array.isArray(q.detectedGenre) && q.detectedGenre.length > 0) {
      questionsWithGenres++;
      q.detectedGenre.forEach((genre) => {
        if (genre && genre.trim()) {
          uniqueGenres.add(genre);
          genreCounts[genre] = (genreCounts[genre] || 0) + 1;
        }
      });
    }
  });

  if (uniqueGenres.size === 0) return 0;
  if (uniqueGenres.size === 1) return 0; // No diversity

  // Calculate Shannon entropy (diversity measure)
  const totalOccurrences = Object.values(genreCounts).reduce((sum, count) => sum + count, 0);
  let entropy = 0;

  Object.values(genreCounts).forEach((count) => {
    const probability = count / totalOccurrences;
    if (probability > 0) {
      entropy -= probability * Math.log2(probability);
    }
  });

  // Normalize to 0-1 scale (max entropy is log2(number of genres))
  const maxEntropy = Math.log2(uniqueGenres.size);
  const normalizedDiversity = maxEntropy > 0 ? entropy / maxEntropy : 0;

  return Math.round(normalizedDiversity * 100) / 100; // Round to 2 decimal places
}

/**
 * Detect recent genre shifts (changing interests)
 * Compares recent questions (last 30%) with older questions (first 70%)
 * Returns array of genres that have increased or decreased in frequency
 */
function detectRecentGenreShifts(
  questions: Array<{ detectedGenre?: string[]; timestamp: Date | string | number }>
): Array<{ genre: string; change: 'increasing' | 'decreasing' | 'stable'; trend: number }> {
  if (!questions || questions.length < 4) return []; // Need at least 4 questions to detect shifts

  // Sort questions by timestamp (oldest first)
  const sortedQuestions = [...questions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Split into older (70%) and recent (30%) questions
  const splitIndex = Math.floor(sortedQuestions.length * 0.7);
  const olderQuestions = sortedQuestions.slice(0, splitIndex);
  const recentQuestions = sortedQuestions.slice(splitIndex);

  // Calculate genre frequencies for each period
  const calculateGenreFrequency = (questionSet: typeof sortedQuestions) => {
    const genreCounts: { [genre: string]: number } = {};
    let totalQuestions = 0;

    questionSet.forEach((q) => {
      if (q.detectedGenre && Array.isArray(q.detectedGenre) && q.detectedGenre.length > 0) {
        totalQuestions++;
        q.detectedGenre.forEach((genre) => {
          if (genre && genre.trim()) {
            genreCounts[genre] = (genreCounts[genre] || 0) + 1;
          }
        });
      }
    });

    // Calculate frequencies
    const frequencies: { [genre: string]: number } = {};
    Object.entries(genreCounts).forEach(([genre, count]) => {
      frequencies[genre] = totalQuestions > 0 ? count / totalQuestions : 0;
    });

    return frequencies;
  };

  const olderFrequencies = calculateGenreFrequency(olderQuestions);
  const recentFrequencies = calculateGenreFrequency(recentQuestions);

  // Find all unique genres across both periods
  const allGenres = new Set([
    ...Object.keys(olderFrequencies),
    ...Object.keys(recentFrequencies),
  ]);

  // Calculate trends
  const shifts: Array<{ genre: string; change: 'increasing' | 'decreasing' | 'stable'; trend: number }> = [];

  allGenres.forEach((genre) => {
    const olderFreq = olderFrequencies[genre] || 0;
    const recentFreq = recentFrequencies[genre] || 0;
    const trend = recentFreq - olderFreq;

    // Only report significant changes (>10% change)
    if (Math.abs(trend) > 0.1) {
      shifts.push({
        genre,
        change: trend > 0 ? 'increasing' : 'decreasing',
        trend: Math.round(trend * 100) / 100, // Round to 2 decimal places
      });
    } else if (olderFreq > 0 || recentFreq > 0) {
      // Include stable genres that exist in either period
      shifts.push({
        genre,
        change: 'stable',
        trend: Math.round(trend * 100) / 100,
      });
    }
  });

  // Sort by absolute trend value (biggest changes first)
  return shifts.sort((a, b) => Math.abs(b.trend) - Math.abs(a.trend));
}

// ============================================================================
// Difficulty Analysis Helpers
// These functions analyze difficulty progression and challenge-seeking behavior
// ============================================================================

/**
 * Map difficulty hint to numeric value for progression tracking
 */
function difficultyToNumber(difficulty: string | undefined): number {
  if (!difficulty) return 1; // Default to intermediate if unknown
  
  const lower = difficulty.toLowerCase();
  if (lower === 'beginner') return 0;
  if (lower === 'intermediate') return 1;
  if (lower === 'advanced') return 2;
  
  return 1; // Default to intermediate
}

/**
 * Analyze difficulty progression over time
 * Returns array of difficulty values (0=beginner, 1=intermediate, 2=advanced) ordered by time
 */
function analyzeDifficultyProgression(
  questions: Array<{ difficultyHint?: string; timestamp: Date | string | number }>
): number[] {
  if (!questions || questions.length === 0) return [];

  // Sort questions by timestamp (oldest first)
  const sortedQuestions = [...questions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Extract difficulty progression
  const progression = sortedQuestions
    .map((q) => difficultyToNumber(q.difficultyHint))
    .filter((val) => val !== null);

  return progression;
}

/**
 * Estimate current difficulty level based on recent questions
 * Returns: "beginner", "intermediate", or "advanced"
 * Uses the most recent 10 questions (or all if less than 10)
 */
function estimateCurrentDifficulty(
  questions: Array<{ difficultyHint?: string; timestamp: Date | string | number }>
): 'beginner' | 'intermediate' | 'advanced' {
  if (!questions || questions.length === 0) return 'intermediate';

  // Sort by timestamp (newest first) and take recent questions
  const sortedQuestions = [...questions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const recentQuestions = sortedQuestions.slice(0, 10);
  const difficulties = recentQuestions
    .map((q) => q.difficultyHint?.toLowerCase())
    .filter((d): d is string => !!d);

  if (difficulties.length === 0) return 'intermediate';

  // Count occurrences
  const counts = {
    beginner: 0,
    intermediate: 0,
    advanced: 0,
  };

  difficulties.forEach((d) => {
    if (d === 'beginner') counts.beginner++;
    else if (d === 'intermediate') counts.intermediate++;
    else if (d === 'advanced') counts.advanced++;
  });

  // Return the most common difficulty
  if (counts.advanced > counts.intermediate && counts.advanced > counts.beginner) {
    return 'advanced';
  }
  if (counts.beginner > counts.intermediate && counts.beginner > counts.advanced) {
    return 'beginner';
  }

  // Default to intermediate
  return 'intermediate';
}

/**
 * Detect challenge-seeking behavior
 * Analyzes if user is moving toward harder difficulties over time
 * Returns: "seeking_challenge", "maintaining", or "easing_up"
 */
function detectChallengeBehavior(
  questions: Array<{ difficultyHint?: string; timestamp: Date | string | number }>
): 'seeking_challenge' | 'maintaining' | 'easing_up' {
  if (!questions || questions.length < 3) return 'maintaining';

  // Sort by timestamp (oldest first)
  const sortedQuestions = [...questions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Convert to numeric progression
  const progression = sortedQuestions.map((q) => difficultyToNumber(q.difficultyHint));

  // Calculate trend (positive = increasing difficulty, negative = decreasing)
  let trend = 0;
  for (let i = 1; i < progression.length; i++) {
    trend += progression[i] - progression[i - 1];
  }

  // Normalize by number of transitions
  const avgTrend = progression.length > 1 ? trend / (progression.length - 1) : 0;

  // Determine behavior
  if (avgTrend > 0.2) {
    return 'seeking_challenge'; // Moving toward harder difficulties
  } else if (avgTrend < -0.2) {
    return 'easing_up'; // Moving toward easier difficulties
  } else {
    return 'maintaining'; // Staying at similar difficulty
  }
}

// ============================================================================
// Behavioral Pattern Helpers
// These functions analyze user behavior patterns and learning styles
// ============================================================================

/**
 * Categorize questions by type and return distribution
 * Uses the questionCategory field from metadata to analyze question types
 * Returns array of question types with counts and percentages
 */
function categorizeQuestions(
  questions: Array<{ questionCategory?: string }>
): Array<{ category: string; count: number; percentage: number }> {
  if (!questions || questions.length === 0) return [];

  const categoryCounts: { [category: string]: number } = {};
  let totalCategorized = 0;

  // Count occurrences of each category
  questions.forEach((q) => {
    if (q.questionCategory && q.questionCategory.trim()) {
      const category = q.questionCategory;
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      totalCategorized++;
    }
  });

  if (totalCategorized === 0) return [];

  // Convert to array and calculate percentages
  const distribution = Object.entries(categoryCounts)
    .map(([category, count]) => ({
      category,
      count,
      percentage: (count / totalCategorized) * 100,
    }))
    .sort((a, b) => b.count - a.count); // Sort by count descending

  return distribution;
}

/**
 * Analyze learning curve based on question patterns
 * Measures how quickly user progresses by analyzing:
 * - Time between questions (faster = quicker learning)
 * - Difficulty progression (improving = learning)
 * - Question complexity over time
 * Returns: "fast", "moderate", or "slow"
 */
function analyzeLearningCurve(
  questions: Array<{ 
    difficultyHint?: string; 
    timestamp: Date | string | number;
    questionCategory?: string;
  }>
): 'fast' | 'moderate' | 'slow' {
  if (!questions || questions.length < 3) return 'moderate';

  // Sort questions by timestamp (oldest first)
  const sortedQuestions = [...questions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Calculate average time between questions (in hours)
  let totalGapHours = 0;
  let gapCount = 0;
  for (let i = 1; i < sortedQuestions.length; i++) {
    const prev = new Date(sortedQuestions[i - 1].timestamp);
    const curr = new Date(sortedQuestions[i].timestamp);
    const gapHours = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60);
    if (gapHours > 0 && gapHours < 168) { // Ignore gaps > 1 week
      totalGapHours += gapHours;
      gapCount++;
    }
  }

  const avgGapHours = gapCount > 0 ? totalGapHours / gapCount : 24;

  // Analyze difficulty progression (positive trend = learning)
  const progression = sortedQuestions.map((q) => difficultyToNumber(q.difficultyHint));
  let difficultyTrend = 0;
  for (let i = 1; i < progression.length; i++) {
    difficultyTrend += progression[i] - progression[i - 1];
  }
  const avgDifficultyTrend = progression.length > 1 ? difficultyTrend / (progression.length - 1) : 0;

  // Determine learning speed
  // Fast: Short gaps (< 12 hours) AND increasing difficulty
  // Slow: Long gaps (> 48 hours) OR decreasing difficulty
  if (avgGapHours < 12 && avgDifficultyTrend > 0.1) {
    return 'fast';
  } else if (avgGapHours > 48 || avgDifficultyTrend < -0.1) {
    return 'slow';
  } else {
    return 'moderate';
  }
}

/**
 * Measure exploration tendencies
 * Analyzes how exploratory the user is based on:
 * - Genre diversity (more genres = more exploratory)
 * - Question category variety (more types = more exploratory)
 * - Game variety (more games = more exploratory)
 * Returns a score from 0 to 1 (1 = highly exploratory)
 */
function measureExplorationTendencies(
  questions: Array<{ 
    detectedGenre?: string[];
    questionCategory?: string;
    detectedGame?: string;
  }>
): number {
  if (!questions || questions.length === 0) return 0;

  // Calculate genre diversity
  const uniqueGenres = new Set<string>();
  questions.forEach((q) => {
    if (q.detectedGenre && Array.isArray(q.detectedGenre)) {
      q.detectedGenre.forEach((genre) => {
        if (genre && genre.trim()) {
          uniqueGenres.add(genre);
        }
      });
    }
  });

  // Calculate category diversity
  const uniqueCategories = new Set<string>();
  questions.forEach((q) => {
    if (q.questionCategory && q.questionCategory.trim()) {
      uniqueCategories.add(q.questionCategory);
    }
  });

  // Calculate game diversity
  const uniqueGames = new Set<string>();
  questions.forEach((q) => {
    if (q.detectedGame && q.detectedGame.trim()) {
      uniqueGames.add(q.detectedGame);
    }
  });

  // Normalize scores (0-1 scale)
  const genreScore = Math.min(uniqueGenres.size / 5, 1); // Max at 5 genres
  const categoryScore = Math.min(uniqueCategories.size / 5, 1); // Max at 5 categories
  const gameScore = Math.min(uniqueGames.size / 10, 1); // Max at 10 games

  // Weighted average (genres and categories are more important)
  const explorationScore = (genreScore * 0.4 + categoryScore * 0.4 + gameScore * 0.2);

  return Math.round(explorationScore * 100) / 100; // Round to 2 decimal places
}

// ============================================================================
// TEST FUNCTION: Difficulty Analysis Helpers
// ============================================================================
// NOTE: This function is FOR TESTING ONLY
// It tests the difficulty helper functions but is not used in production code.
// The helper functions themselves (analyzeDifficultyProgression, etc.) ARE used
// in production via analyzeGameplayPatterns().
// ============================================================================

/**
 * TEST FUNCTION: Test difficulty analysis helpers
 * ENABLED FOR TESTING - Comment out for production
 * 
 * This function is only used by the test endpoint: /api/test-difficulty-helpers
 * It is NOT used in production code.
 */
// export const testDifficultyHelpers = async (username: string) => {
//   try {
//     const Question = (await import('../models/Question')).default;
    
//     // Get user's questions with difficulty data
//     const questions = await Question.find({ username })
//       .sort({ timestamp: -1 })
//       .limit(100)
//       .select('difficultyHint timestamp')
//       .lean();

//     if (questions.length === 0) {
//       console.log('[Test] No questions found for user:', username);
//       return {
//         error: 'No questions found',
//         username,
//       };
//     }

//     // Ensure questions have required properties
//     const questionsWithData = questions
//       .filter((q: any) => q.timestamp)
//       .map((q: any) => ({
//         difficultyHint: q.difficultyHint,
//         timestamp: q.timestamp,
//       }));

//     if (questionsWithData.length === 0) {
//       return {
//         error: 'No questions with valid data found',
//         username,
//       };
//     }

//     // Test each helper function
//     const progression = analyzeDifficultyProgression(questionsWithData);
//     const currentDifficulty = estimateCurrentDifficulty(questionsWithData);
//     const challengeBehavior = detectChallengeBehavior(questionsWithData);

//     const results = {
//       username,
//       totalQuestions: questions.length,
//       questionsWithDifficulty: questionsWithData.filter(q => q.difficultyHint).length,
//       difficultyAnalysis: {
//         progression: progression,
//         currentLevel: currentDifficulty,
//         challengeBehavior: challengeBehavior,
//       },
//       sampleQuestions: questionsWithData.slice(0, 5).map(q => ({
//         timestamp: q.timestamp,
//         difficulty: q.difficultyHint || 'none',
//       })),
//     };

//     console.log('[Test Difficulty Helpers] Results:', JSON.stringify(results, null, 2));
//     return results;
//   } catch (error) {
//     console.error('[Test Difficulty Helpers] Error:', error);
//     return {
//       error: error instanceof Error ? error.message : 'Unknown error',
//       username,
//     };
//   }
// };

// ============================================================================
// TEST FUNCTION: Behavioral Pattern Helpers
// ============================================================================
// NOTE: This function is FOR TESTING ONLY
// It tests the behavioral helper functions but is not used in production code.
// The helper functions themselves (categorizeQuestions, etc.) ARE used
// in production via analyzeGameplayPatterns().
// ============================================================================

/**
 * TEST FUNCTION: Test behavioral pattern helpers
 * ENABLED FOR TESTING - Comment out for production
 * 
 * This function is only used by the test endpoint: /api/test-behavioral-helpers
 * It is NOT used in production code.
 */
// export const testBehavioralHelpers = async (username: string) => {
//   try {
//     const Question = (await import('../models/Question')).default;
    
//     // Get user's questions with behavioral data
//     const questions = await Question.find({ username })
//       .sort({ timestamp: -1 })
//       .limit(100)
//       .select('questionCategory detectedGenre detectedGame difficultyHint timestamp')
//       .lean();

//     if (questions.length === 0) {
//       console.log('[Test] No questions found for user:', username);
//       return {
//         error: 'No questions found',
//         username,
//       };
//     }

//     // Ensure questions have required properties
//     const questionsWithData = questions
//       .filter((q: any) => q.timestamp)
//       .map((q: any) => ({
//         questionCategory: q.questionCategory,
//         detectedGenre: q.detectedGenre || [],
//         detectedGame: q.detectedGame,
//         difficultyHint: q.difficultyHint,
//         timestamp: q.timestamp,
//       }));

//     if (questionsWithData.length === 0) {
//       return {
//         error: 'No questions with valid data found',
//         username,
//       };
//     }

//     // Test each helper function
//     const questionTypes = categorizeQuestions(questionsWithData);
//     const learningSpeed = analyzeLearningCurve(questionsWithData);
//     const explorationDepth = measureExplorationTendencies(questionsWithData);

//     const results = {
//       username,
//       totalQuestions: questions.length,
//       questionsWithCategory: questionsWithData.filter(q => q.questionCategory).length,
//       behavioralAnalysis: {
//         questionTypes: questionTypes,
//         learningSpeed: learningSpeed,
//         explorationDepth: explorationDepth,
//       },
//       sampleQuestions: questionsWithData.slice(0, 5).map(q => ({
//         timestamp: q.timestamp,
//         category: q.questionCategory || 'none',
//         genres: q.detectedGenre || [],
//         game: q.detectedGame || 'none',
//       })),
//     };

//     console.log('[Test Behavioral Helpers] Results:', JSON.stringify(results, null, 2));
//     return results;
//   } catch (error) {
//     console.error('[Test Behavioral Helpers] Error:', error);
//     return {
//       error: error instanceof Error ? error.message : 'Unknown error',
//       username,
//     };
//   }
// };

// ============================================================================
// Performance Safeguards: Caching and Rate Limiting
// Phase 4: Performance Safeguards Implementation
// ============================================================================

/**
 * Cache for gameplay pattern analysis results
 * Phase 4.1: Intelligent Caching
 */
const PATTERN_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const PATTERN_CACHE_MAX_SIZE = 1000; // Max 1000 users (roughly 50-100MB depending on pattern data size)

// Pattern cache with LRU eviction
const patternCache = new LRUCache<Awaited<ReturnType<typeof analyzeGameplayPatternsInternal>>>(
  PATTERN_CACHE_MAX_SIZE,
  PATTERN_CACHE_TTL,
  10 * 60 * 1000 // Cleanup every 10 minutes
);

// Register with cache manager for monitoring
cacheManager.registerCache('PatternCache', patternCache);

/**
 * Get cached patterns or calculate and cache new ones
 * Phase 4.1: Intelligent Caching
 * 
 * @param username - Username to get patterns for
 * @param forceRefresh - If true, bypass cache and recalculate
 * @returns Cached or freshly calculated patterns
 */
async function getOrCalculatePatterns(
  username: string,
  forceRefresh: boolean = false
): Promise<Awaited<ReturnType<typeof analyzeGameplayPatternsInternal>>> {
  // Return cached data if valid and not forcing refresh
  if (!forceRefresh) {
    const cached = patternCache.get(username);
    if (cached) {
      const metrics = patternCache.getMetrics();
      console.log(`[Performance Safeguards] Cache HIT for ${username} (cache size: ${metrics.size}/${metrics.maxSize}, utilization: ${patternCache.getUtilization().toFixed(1)}%)`);
      return cached;
    }
  }

  // Calculate and cache
  if (forceRefresh) {
    console.log(`[Performance Safeguards] Cache BYPASS for ${username} (forceRefresh=true)`);
  } else {
    console.log(`[Performance Safeguards] Cache MISS for ${username} (calculating new)`);
  }

  const data = await analyzeGameplayPatternsInternal(username);
  patternCache.set(username, data, PATTERN_CACHE_TTL);

  const metrics = patternCache.getMetrics();
  console.log(`[Performance Safeguards] Cache UPDATED for ${username} (cache size: ${metrics.size}/${metrics.maxSize}, utilization: ${patternCache.getUtilization().toFixed(1)}%)`);
  return data;
}

/**
 * Check if analysis should run based on rate limiting
 * Phase 4.3: Rate Limiting
 * 
 * Only analyzes once per 3 hours to avoid excessive database queries
 * 
 * @param username - Username to check
 * @returns true if analysis should run, false otherwise
 */
export async function shouldRunAnalysis(username: string): Promise<boolean> {
  try {
    const User = (await import('../models/User')).default;
    const user = await User.findOne({ username }).select('progress.personalized.recommendationHistory.lastAnalysisTime').lean() as any;
    
    const lastAnalysis = user?.progress?.personalized?.recommendationHistory?.lastAnalysisTime;

    // If no previous analysis, allow it
    if (!lastAnalysis) {
      console.log(`[Performance Safeguards] Rate limit CHECK for ${username}: ALLOWED (no previous analysis)`);
      return true;
    }

    const hoursSinceLastAnalysis =
      (Date.now() - new Date(lastAnalysis).getTime()) / (1000 * 60 * 60);

    // Only analyze once per 3 hours
    const shouldRun = hoursSinceLastAnalysis >= 3;
    
    if (shouldRun) {
      console.log(`[Performance Safeguards] Rate limit CHECK for ${username}: ALLOWED (${hoursSinceLastAnalysis.toFixed(2)}h since last, threshold: 3h)`);
    } else {
      console.log(`[Performance Safeguards] Pattern analysis SKIPPED for ${username} (${hoursSinceLastAnalysis.toFixed(2)}h since last analysis, threshold: 3h) - question still processed normally`);
    }
    
    return shouldRun;
  } catch (error) {
    // On error, allow analysis (fail open)
    console.error('[Performance Safeguards] Rate limit ERROR for', username, '- allowing analysis (fail open):', error);
    return true;
  }
}

// ============================================================================
// Main Pattern Analysis Function
// This function orchestrates all helper functions to analyze user gameplay patterns
// ============================================================================

/**
 * Internal function that performs the actual pattern analysis
 * This is separated from the public API to allow caching wrapper
 * Phase 2 Step 2: Pattern Detection - Main Orchestrator
 */
async function analyzeGameplayPatternsInternal(username: string) {
  try {
    const Question = (await import('../models/Question')).default;
    
    // Phase 4.2: Query Optimization
    // Use efficient query with limit and select to only fetch needed fields
    // This is optimized for performance - only fetches last 100 questions with specific fields
    // Using .lean() for faster queries (returns plain objects instead of Mongoose documents)
    const questionsForAnalysis = await Question.find({ username })
      .sort({ timestamp: -1 })
      .limit(100)
      .select('timestamp detectedGenre difficultyHint questionCategory interactionType detectedGame')
      .lean();

    if (!questionsForAnalysis || questionsForAnalysis.length === 0) {
      return {
        frequency: {
          totalQuestions: 0,
          questionsPerWeek: 0,
          peakActivityTimes: [],
          sessionPattern: 'sporadic' as const,
        },
        difficulty: {
          progression: [],
          currentLevel: 'intermediate' as const,
          challengeSeeking: 'maintaining' as const,
        },
        genreAnalysis: {
          topGenres: [],
          genreDiversity: 0,
          recentTrends: [],
        },
        behavior: {
          questionTypes: [],
          learningSpeed: 'moderate' as const,
          explorationDepth: 0,
        },
      };
    }

    // Prepare questions for analysis (ensure proper format)
    const questionsWithTimestamp = questionsForAnalysis
      .filter((q: any) => q.timestamp)
      .map((q: any) => ({
        timestamp: q.timestamp,
        detectedGenre: q.detectedGenre || [],
        difficultyHint: q.difficultyHint,
        questionCategory: q.questionCategory,
        interactionType: q.interactionType,
        detectedGame: q.detectedGame,
      }));

    // Analyze frequency patterns
    const frequency = {
      totalQuestions: questionsForAnalysis.length,
      questionsPerWeek: calculateWeeklyRate(questionsWithTimestamp),
      peakActivityTimes: detectPeakHours(questionsWithTimestamp),
      sessionPattern: detectSessionPatterns(questionsWithTimestamp),
    };

    // Analyze difficulty patterns
    const difficulty = {
      progression: analyzeDifficultyProgression(questionsWithTimestamp),
      currentLevel: estimateCurrentDifficulty(questionsWithTimestamp),
      challengeSeeking: detectChallengeBehavior(questionsWithTimestamp),
    };

    // Analyze genre patterns
    const genreAnalysis = {
      topGenres: analyzeGenreDistribution(questionsWithTimestamp),
      genreDiversity: calculateDiversity(questionsWithTimestamp),
      recentTrends: detectRecentGenreShifts(questionsWithTimestamp),
    };

    // Analyze behavioral patterns
    const behavior = {
      questionTypes: categorizeQuestions(questionsWithTimestamp),
      learningSpeed: analyzeLearningCurve(questionsWithTimestamp),
      explorationDepth: measureExplorationTendencies(questionsWithTimestamp),
    };

    return {
      frequency,
      difficulty,
      genreAnalysis,
      behavior,
    };
  } catch (error) {
    console.error('[Pattern Analysis] Error analyzing gameplay patterns:', error);
    // Return safe defaults on error
    return {
      frequency: {
        totalQuestions: 0,
        questionsPerWeek: 0,
        peakActivityTimes: [],
        sessionPattern: 'sporadic' as const,
      },
      difficulty: {
        progression: [],
        currentLevel: 'intermediate' as const,
        challengeSeeking: 'maintaining' as const,
      },
      genreAnalysis: {
        topGenres: [],
        genreDiversity: 0,
        recentTrends: [],
      },
      behavior: {
        questionTypes: [],
        learningSpeed: 'moderate' as const,
        explorationDepth: 0,
      },
    };
  }
}

/**
 * Public API for analyzing gameplay patterns with caching
 * Phase 4.1: Intelligent Caching - Wrapper function
 * 
 * This function wraps the internal analysis with caching to avoid
 * recalculating patterns for the same user within the cache TTL period.
 * 
 * @param username - Username to analyze patterns for
 * @param forceRefresh - If true, bypass cache and recalculate (default: false)
 * @returns Analyzed gameplay patterns
 */
export const analyzeGameplayPatterns = async (
  username: string,
  forceRefresh: boolean = false
) => {
  return getOrCalculatePatterns(username, forceRefresh);
};

/**
 * TEST FUNCTION: Test genre analysis helpers
 * COMMENTED OUT FOR PRODUCTION - Uncomment for testing/debugging
 * 
 * export const testGenreHelpers = async (username: string) => {
 *   try {
 *     const Question = (await import('../models/Question')).default;
 *     
 *     // Get user's questions with genre data
 *     const questions = await Question.find({ username })
 *       .sort({ timestamp: -1 })
 *       .limit(100)
 *       .select('detectedGenre timestamp')
 *       .lean();
 * 
 *     if (questions.length === 0) {
 *       console.log('[Test] No questions found for user:', username);
 *       return {
 *         error: 'No questions found',
 *         username,
 *       };
 *     }
 * 
 *     // Ensure questions have required properties
 *     const questionsWithData = questions
 *       .filter((q: any) => q.timestamp)
 *       .map((q: any) => ({
 *         detectedGenre: q.detectedGenre || [],
 *         timestamp: q.timestamp,
 *       }));
 * 
 *     if (questionsWithData.length === 0) {
 *       return {
 *         error: 'No questions with valid data found',
 *         username,
 *       };
 *     }
 * 
 *     // Test each helper function
 *     const genreDistribution = analyzeGenreDistribution(questionsWithData);
 *     const diversity = calculateDiversity(questionsWithData);
 *     const genreShifts = detectRecentGenreShifts(questionsWithData);
 * 
 *     const results = {
 *       username,
 *       totalQuestions: questions.length,
 *       questionsWithGenres: questionsWithData.filter(q => q.detectedGenre && q.detectedGenre.length > 0).length,
 *       genreAnalysis: {
 *         distribution: genreDistribution,
 *         diversityScore: diversity,
 *         recentShifts: genreShifts,
 *       },
 *       sampleQuestions: questionsWithData.slice(0, 5).map(q => ({
 *         timestamp: q.timestamp,
 *         genres: q.detectedGenre || [],
 *       })),
 *     };
 * 
 *     console.log('[Test Genre Helpers] Results:', JSON.stringify(results, null, 2));
 *     return results;
 *   } catch (error) {
 *     console.error('[Test Genre Helpers] Error:', error);
 *     return {
 *       error: error instanceof Error ? error.message : 'Unknown error',
 *       username,
 *     };
 *   }
 * };
 */

// ============================================================================
// Phase 4 Step 1: Loadout/Strategy Suggestion Templates
// Template system for generating personalized strategy tips
// ============================================================================

/**
 * Strategy templates organized by genre and difficulty level
 * Templates contain placeholders (e.g., [primary_stat]) that are replaced
 * with personalized values based on user context
 */
const STRATEGY_TEMPLATES: {
  [genre: string]: {
    [difficulty: string]: string;
  };
} = {
  rpg: {
    beginner: "A balanced build works best when you focus on [primary_stat] - it'll keep you alive while you learn the ropes.",
    intermediate: "You might find [specific_strategy] works really well for your playstyle.",
    advanced: "For maximum efficiency, try [min_max_tips] - it's the meta approach right now.",
  },
  shooter: {
    beginner: "[weapon_class] are great to start with - they're easier to control and forgiving.",
    intermediate: "For this map, [specific_loadout] tends to work well.",
    advanced: "The current meta loadout is [optimal_setup] because [reasoning].",
  },
  strategy: {
    beginner: "Build up your economy first - [resource_tips] will help you get ahead.",
    intermediate: "Consider adding [unit_type] to your army - they counter [specific_threat] effectively.",
    advanced: "The top-tier composition right now is [complex_strategy] - it dominates most matchups.",
  },
  action: {
    beginner: "Stick with [beginner_weapon] until you get comfortable - they're more forgiving.",
    intermediate: "Try combining [weapon_combo] - the synergy between them is really strong.",
    advanced: "If you want to push your limits, master [advanced_technique] - it's what separates pros from casuals.",
  },
  adventure: {
    beginner: "Take your time exploring [safe_areas] first - you'll find useful items and get stronger.",
    intermediate: "Prioritize [key_upgrades] - they'll make the tougher sections much more manageable.",
    advanced: "For speedruns, the optimal route is [efficient_path] - it shaves off significant time.",
  },
  platformer: {
    beginner: "Get comfortable with [basic_technique] first - it's the foundation for everything else.",
    intermediate: "Once you've got the basics down, [advanced_move] will help you navigate tricky sections.",
    advanced: "Speedrunners use [speedrun_tech] to save time - it's tricky but worth learning.",
  },
  puzzle: {
    beginner: "Keep an eye out for [pattern_type] - recognizing these patterns makes puzzles much easier.",
    intermediate: "When puzzles get complex, [puzzle_strategy] is usually the key to solving them.",
    advanced: "The fastest approach is [efficient_method] - it minimizes unnecessary steps.",
  },
  fighting: {
    beginner: "Start by learning [basic_combo] - it's reliable and easy to execute.",
    intermediate: "Once you're comfortable, [combo_chain] will help you deal serious damage.",
    advanced: "For competitive play, [optimal_combo] is essential - it's optimized for frame data and damage.",
  },
  racing: {
    beginner: "[stable_vehicle] is perfect for learning - it's forgiving and easy to control.",
    intermediate: "Tune your [vehicle_setup] for better handling - it makes a huge difference.",
    advanced: "Master [racing_line] and [advanced_technique] - these are what separate top racers.",
  },
  sports: {
    beginner: "Focus on mastering [basic_skill] - it's the foundation for everything else.",
    intermediate: "Once you've got the basics, [advanced_skill] will give you an edge in matches.",
    advanced: "At the pro level, [pro_technique] is essential - it's what the best players use.",
  },
  survival: {
    beginner: "Prioritize [resource_priority] early on - you'll need them to stay alive.",
    intermediate: "Once you're stable, focus on [survival_strategy] - it'll make the game much easier.",
    advanced: "For maximum efficiency, master [advanced_survival] - it's how the pros stay ahead.",
  },
  horror: {
    beginner: "Take your time and [conservative_approach] - rushing gets you killed in horror games.",
    intermediate: "Learn to [horror_strategy] - it'll help you handle scares and threats better.",
    advanced: "If you want to master horror games, [advanced_horror] is key - it separates veterans from newcomers.",
  },
  stealth: {
    beginner: "Start by [basic_stealth] - it's the safest way to approach encounters.",
    intermediate: "Once you're comfortable, try [stealth_technique] - it opens up more options.",
    advanced: "For expert play, [advanced_stealth] is essential - it's what speedrunners and pros rely on.",
  },
  simulation: {
    beginner: "Focus on [basic_management] first - get the fundamentals down before expanding.",
    intermediate: "As you improve, [simulation_strategy] will help you optimize your approach.",
    advanced: "At the highest level, [advanced_simulation] is crucial - it's how you achieve peak efficiency.",
  },
  roguelike: {
    beginner: "Don't worry about dying - [roguelike_basics] will help you learn from each run.",
    intermediate: "Once you understand the mechanics, [roguelike_strategy] will help you progress further.",
    advanced: "For consistent wins, master [advanced_roguelike] - it's what separates skilled players from the rest.",
  },
  sandbox: {
    beginner: "Start by [basic_exploration] - there's no rush, so take your time discovering what's possible.",
    intermediate: "Once you're comfortable, try [sandbox_creativity] - that's where the real fun begins.",
    advanced: "For impressive builds, [advanced_sandbox] is essential - it's how creators make amazing things.",
  },
  'battle-royale': {
    beginner: "Land in [safe_drop] areas first - you'll have time to gear up without immediate danger.",
    intermediate: "As you get better, [br_strategy] will help you survive longer and get more kills.",
    advanced: "For competitive play, [advanced_br] is crucial - it's what top players use to dominate.",
  },
};

/**
 * Context interface for template personalization
 * Contains information needed to fill template placeholders
 */
export interface TemplateContext {
  primaryStat?: string;
  specificStrategy?: string;
  minMaxTips?: string;
  weaponClass?: string;
  specificLoadout?: string;
  optimalSetup?: string;
  reasoning?: string;
  resourceTips?: string;
  unitType?: string;
  specificThreat?: string;
  complexStrategy?: string;
  beginnerWeapon?: string;
  weaponCombo?: string;
  advancedTechnique?: string;
  safeAreas?: string;
  keyUpgrades?: string;
  efficientPath?: string;
  basicTechnique?: string;
  advancedMove?: string;
  speedrunTech?: string;
  patternType?: string;
  puzzleStrategy?: string;
  efficientMethod?: string;
  basicCombo?: string;
  comboChain?: string;
  optimalCombo?: string;
  stableVehicle?: string;
  vehicleSetup?: string;
  racingLine?: string;
  basicSkill?: string;
  advancedSkill?: string;
  proTechnique?: string;
  resourcePriority?: string;
  survivalStrategy?: string;
  advancedSurvival?: string;
  conservativeApproach?: string;
  horrorStrategy?: string;
  advancedHorror?: string;
  basicStealth?: string;
  stealthTechnique?: string;
  advancedStealth?: string;
  basicManagement?: string;
  simulationStrategy?: string;
  advancedSimulation?: string;
  roguelikeBasics?: string;
  roguelikeStrategy?: string;
  advancedRoguelike?: string;
  basicExploration?: string;
  sandboxCreativity?: string;
  advancedSandbox?: string;
  safeDrop?: string;
  brStrategy?: string;
  advancedBr?: string;
  [key: string]: string | undefined; // Allow dynamic properties
}

/**
 * Personalize a template string by replacing placeholders with context values
 * Placeholders are in the format [placeholder_name] and are replaced with
 * values from the context object (e.g., [primary_stat] -> context.primaryStat)
 * 
 * @param template - Template string with placeholders
 * @param context - Context object containing values to fill placeholders
 * @returns Personalized template string with placeholders replaced
 */
function personalizeTemplate(template: string | undefined, context: TemplateContext): string {
  if (!template) {
    return '';
  }

  let personalized = template;

  // Replace all placeholders in the format [placeholder_name]
  // Convert placeholder_name to camelCase and look up in context
  personalized = personalized.replace(/\[([^\]]+)\]/g, (match: string, placeholder: string) => {
    // Convert placeholder to camelCase (e.g., "primary_stat" -> "primaryStat")
    const camelCaseKey = placeholder
      .toLowerCase()
      .replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase());

    // Look up value in context (try both original and camelCase)
    const value = context[camelCaseKey] || context[placeholder.toLowerCase()] || context[placeholder];

    // If value found, replace placeholder; otherwise keep placeholder
    return value || match;
  });

  return personalized;
}

/**
 * Get a personalized strategy tip based on game genre, user difficulty, and context
 * 
 * @param gameGenre - The genre of the game (e.g., "rpg", "shooter", "strategy")
 * @param userDifficulty - User's difficulty level ("beginner", "intermediate", "advanced")
 * @param context - Context object containing values to personalize the template
 * @returns Personalized strategy tip string
 * 
 * @example
 * ```typescript
 * const tip = getPersonalizedStrategyTip(
 *   "rpg",
 *   "beginner",
 *   { primaryStat: "strength and vitality" }
 * );
 * // Returns: "Start with a balanced build focusing on strength and vitality"
 * ```
 */
export const getPersonalizedStrategyTip = (
  gameGenre: string,
  userDifficulty: string,
  context: TemplateContext
): string => {
  // Normalize genre to lowercase for lookup
  const normalizedGenre = gameGenre.toLowerCase();
  
  // Normalize difficulty to lowercase
  const normalizedDifficulty = userDifficulty.toLowerCase();

  // Get template for the genre and difficulty
  const template = STRATEGY_TEMPLATES[normalizedGenre]?.[normalizedDifficulty];

  // If no template found, try to find a generic template or return empty string
  if (!template) {
    // Try to find a template for a similar genre
    // For example, "action-rpg" should try both "rpg" and "action"
    const genreVariants: string[] = [];
    
    // If genre contains hyphens, try each part separately
    if (normalizedGenre.includes('-')) {
      const parts = normalizedGenre.split('-');
      // Prioritize "rpg" if it's in the genre name (more relevant for strategy tips)
      if (parts.includes('rpg')) {
        genreVariants.push('rpg');
      }
      // Add all parts (e.g., "action-rpg" -> ["rpg", "action"])
      parts.forEach(part => {
        if (part !== 'rpg' || !genreVariants.includes('rpg')) {
          genreVariants.push(part);
        }
      });
      // Also try the full genre without hyphens
      genreVariants.push(normalizedGenre.replace(/-/g, ' '));
    } else {
      // For non-hyphenated genres, just try the original
      genreVariants.push(normalizedGenre);
    }

    // Try each variant in order
    for (const variant of genreVariants) {
      const variantTemplate = STRATEGY_TEMPLATES[variant]?.[normalizedDifficulty];
      if (variantTemplate) {
        return personalizeTemplate(variantTemplate, context);
      }
    }

    // If still no template, return a generic tip
    return `Consider adjusting your strategy based on your ${normalizedDifficulty} skill level.`;
  }

  // Personalize the template with context
  return personalizeTemplate(template, context);
};

/**
 * Test function for the template system
 * Verifies that templates work correctly and sound natural
 * 
 * @example
 * ```typescript
 * const results = testTemplateSystem();
 * console.log(results);
 * ```
 */
export const testTemplateSystem = (): {
  tests: Array<{
    genre: string;
    difficulty: string;
    context: TemplateContext;
    result: string;
    hasPlaceholders: boolean;
  }>;
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    issues: string[];
  };
} => {
  const tests: Array<{
    genre: string;
    difficulty: string;
    context: TemplateContext;
    result: string;
    hasPlaceholders: boolean;
  }> = [];
  const issues: string[] = [];

  // Test cases covering different genres and difficulties
  const testCases = [
    {
      genre: 'rpg',
      difficulty: 'beginner',
      context: { primaryStat: 'strength and vitality' },
    },
    {
      genre: 'rpg',
      difficulty: 'intermediate',
      context: { specificStrategy: 'a hybrid mage-warrior build' },
    },
    {
      genre: 'rpg',
      difficulty: 'advanced',
      context: { minMaxTips: 'maxing out intelligence and using spell synergies' },
    },
    {
      genre: 'shooter',
      difficulty: 'beginner',
      context: { weaponClass: 'assault rifles' },
    },
    {
      genre: 'shooter',
      difficulty: 'intermediate',
      context: { 
        specificLoadout: 'an SMG with a sniper rifle backup',
        reasoning: 'it covers both close and long-range engagements',
      },
    },
    {
      genre: 'strategy',
      difficulty: 'beginner',
      context: { resourceTips: 'prioritize food and wood production early' },
    },
    {
      genre: 'strategy',
      difficulty: 'intermediate',
      context: { 
        unitType: 'archers',
        specificThreat: 'heavy infantry',
      },
    },
    {
      genre: 'action',
      difficulty: 'beginner',
      context: { beginnerWeapon: 'sword and shield' },
    },
    {
      genre: 'adventure',
      difficulty: 'intermediate',
      context: { keyUpgrades: 'health upgrades and movement abilities' },
    },
    {
      genre: 'platformer',
      difficulty: 'advanced',
      context: { speedrunTech: 'wave dashing and wall jumping' },
    },
    {
      genre: 'platformer',
      difficulty: 'beginner',
      context: { basicMovement: 'jumping and running mechanics' },
    },
    // Test with missing context (should show placeholders or handle gracefully)
    {
      genre: 'puzzle',
      difficulty: 'beginner',
      context: {}, // No context provided
    },
    {
      genre: 'puzzle',
      difficulty: 'intermediate',
      context: { puzzleType: 'logic puzzles and pattern recognition' },
    },
    // Simulation (MysteriousMrEnter genre)
    {
      genre: 'simulation',
      difficulty: 'beginner',
      context: { resourceManagement: 'managing time and resources efficiently' },
    },
    {
      genre: 'simulation',
      difficulty: 'intermediate',
      context: { optimizationTips: 'balancing production chains and efficiency' },
    },
    {
      genre: 'simulation',
      difficulty: 'advanced',
      context: { advancedMechanics: 'complex economic systems and automation' },
    },
    // Racing (WaywardJammer genre)
    {
      genre: 'racing',
      difficulty: 'beginner',
      context: { basicDriving: 'braking and cornering techniques' },
    },
    {
      genre: 'racing',
      difficulty: 'intermediate',
      context: { racingLine: 'optimal racing line and drafting strategies' },
    },
    {
      genre: 'racing',
      difficulty: 'advanced',
      context: { advancedTech: 'drift mechanics and boost management' },
    },
    // Battle Royale (WaywardJammer genre)
    {
      genre: 'battle-royale',
      difficulty: 'beginner',
      context: { survivalTips: 'landing zones and early game looting' },
    },
    {
      genre: 'battle-royale',
      difficulty: 'intermediate',
      context: { positioning: 'zone positioning and engagement timing' },
    },
    {
      genre: 'battle-royale',
      difficulty: 'advanced',
      context: { endgameStrategy: 'final circle positioning and inventory management' },
    },
    // Fighting (WaywardJammer genre)
    {
      genre: 'fighting',
      difficulty: 'beginner',
      context: { basicCombos: 'simple combo strings and blocking' },
    },
    {
      genre: 'fighting',
      difficulty: 'intermediate',
      context: { frameData: 'frame advantage and combo optimization' },
    },
    {
      genre: 'fighting',
      difficulty: 'advanced',
      context: { advancedTech: 'option selects and mix-up strategies' },
    },
    // Sandbox (WaywardJammer genre)
    {
      genre: 'sandbox',
      difficulty: 'beginner',
      context: { buildingBasics: 'basic construction and resource gathering' },
    },
    {
      genre: 'sandbox',
      difficulty: 'intermediate',
      context: { automation: 'redstone circuits and automation systems' },
    },
    {
      genre: 'sandbox',
      difficulty: 'advanced',
      context: { complexBuilds: 'advanced building techniques and modding' },
    },
    // First-Person Shooter (WaywardJammer genre - more specific than generic shooter)
    {
      genre: 'fps',
      difficulty: 'beginner',
      context: { aimBasics: 'crosshair placement and recoil control' },
    },
    {
      genre: 'fps',
      difficulty: 'intermediate',
      context: { movementTech: 'strafe jumping and map control' },
    },
    {
      genre: 'fps',
      difficulty: 'advanced',
      context: { competitivePlay: 'team coordination and utility usage' },
    },
    // Additional common genres
    {
      genre: 'sports',
      difficulty: 'beginner',
      context: { basicControls: 'passing and shooting mechanics' },
    },
    {
      genre: 'sports',
      difficulty: 'intermediate',
      context: { strategy: 'formation tactics and player positioning' },
    },
    {
      genre: 'horror',
      difficulty: 'beginner',
      context: { survivalTips: 'resource conservation and stealth mechanics' },
    },
    {
      genre: 'horror',
      difficulty: 'intermediate',
      context: { puzzleSolving: 'environmental puzzles and item usage' },
    },
    {
      genre: 'survival',
      difficulty: 'beginner',
      context: { resourceGathering: 'food, water, and shelter basics' },
    },
    {
      genre: 'survival',
      difficulty: 'intermediate',
      context: { crafting: 'advanced crafting recipes and base building' },
    },
    {
      genre: 'mmo',
      difficulty: 'beginner',
      context: { classSelection: 'choosing the right class for your playstyle' },
    },
    {
      genre: 'mmo',
      difficulty: 'intermediate',
      context: { endgameContent: 'raids, dungeons, and gear progression' },
    },
    {
      genre: 'indie',
      difficulty: 'beginner',
      context: { uniqueMechanics: 'understanding the game\'s unique systems' },
    },
    {
      genre: 'casual',
      difficulty: 'beginner',
      context: { accessibility: 'easy-to-learn mechanics and progression' },
    },
    {
      genre: 'stealth',
      difficulty: 'intermediate',
      context: { stealthMechanics: 'hiding, distraction, and silent takedowns' },
    },
    {
      genre: 'stealth',
      difficulty: 'advanced',
      context: { ghostRuns: 'no-kill, no-detection playthrough strategies' },
    },
    {
      genre: 'rhythm',
      difficulty: 'beginner',
      context: { timing: 'beat matching and rhythm patterns' },
    },
    {
      genre: 'rhythm',
      difficulty: 'advanced',
      context: { perfectScores: 'mastering complex patterns and timing windows' },
    },
    {
      genre: 'tower-defense',
      difficulty: 'beginner',
      context: { placement: 'optimal tower placement and upgrade priorities' },
    },
    {
      genre: 'tower-defense',
      difficulty: 'intermediate',
      context: { waveManagement: 'resource management and enemy type counters' },
    },
    // Test genre variant matching
    {
      genre: 'action-rpg',
      difficulty: 'beginner',
      context: { primaryStat: 'agility' },
    },
    {
      genre: 'action-adventure',
      difficulty: 'intermediate',
      context: { exploration: 'finding secrets and optional content' },
    },
    {
      genre: 'real-time-strategy',
      difficulty: 'intermediate',
      context: { buildOrder: 'optimal unit production and tech progression' },
    },
    {
      genre: 'turn-based-strategy',
      difficulty: 'beginner',
      context: { positioning: 'unit placement and tactical movement' },
    },
    // Test with unknown genre
    {
      genre: 'unknown-genre',
      difficulty: 'intermediate',
      context: { someValue: 'test' },
    },
  ];

  // Run all test cases
  testCases.forEach((testCase) => {
    const result = getPersonalizedStrategyTip(
      testCase.genre,
      testCase.difficulty,
      testCase.context
    );

    // Check if result still has placeholders (indicates missing context)
    const hasPlaceholders = /\[[^\]]+\]/.test(result);

    tests.push({
      genre: testCase.genre,
      difficulty: testCase.difficulty,
      context: testCase.context,
      result,
      hasPlaceholders,
    });

    // Identify issues
    if (result.length === 0) {
      issues.push(`Empty result for ${testCase.genre}/${testCase.difficulty}`);
    } else if (hasPlaceholders && Object.keys(testCase.context).length > 0) {
      issues.push(`Unfilled placeholders in ${testCase.genre}/${testCase.difficulty}: ${result}`);
    }
  });

  const passed = tests.filter(t => !t.hasPlaceholders || Object.keys(t.context).length === 0).length;
  const failed = tests.length - passed;

  return {
    tests,
    summary: {
      totalTests: tests.length,
      passed,
      failed,
      issues,
    },
  };
};