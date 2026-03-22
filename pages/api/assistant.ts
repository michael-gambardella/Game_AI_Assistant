import type { NextApiResponse } from 'next';
import axios from 'axios';
import connectToMongoDB from '../../utils/mongodb';
import Question from '../../models/Question';
import User from '../../models/User';
import { getChatCompletion, getChatCompletionWithVision, fetchRecommendations, analyzeUserQuestions, getAICache, extractQuestionMetadata, updateQuestionMetadata, analyzeGameplayPatterns, extractGameTitleFromImageContext, enhanceQuestionWithGameContext, shouldRunAnalysis, extractGameTitleFromQuestion } from '../../utils/aiHelper';
import { storeUserPatterns } from '../../utils/storeUserPatterns';
import { generatePersonalizedRecommendations } from '../../utils/generateRecommendations';
import { getClientCredentialsAccessToken, getAccessToken, getTwitchUserData, redirectToTwitch } from '../../utils/twitchAuth';
// import OpenAI from 'openai';
import path from 'path';
import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { getIO } from '../../middleware/realtime';
import mongoose from 'mongoose';
import winston from 'winston';
import { containsOffensiveContent } from '../../utils/contentModeration';
import { Metrics } from '../../types';
import fs from 'fs';
import { clearUserCache } from './getConversation';
import { requireAuth, AuthenticatedRequest } from '../../middleware/auth';
import { withRequestSizeLimit } from '../../middleware/requestSizeLimit';
import { LRUCache, cacheManager } from '../../utils/cacheManager';

// Optimized performance monitoring with conditional logging
const measureLatency = async (operation: string, callback: () => Promise<any>, enableLogging: boolean = false) => {
  const start = performance.now();
  const result = await callback();
  const end = performance.now();
  const latency = end - start;

  // Only log if explicitly enabled or in development
  if (enableLogging || process.env.NODE_ENV === 'development') {
    // console.log(`${operation} latency: ${latency.toFixed(2)}ms`); // Commented out for production
    // `operation` is intentionally included for log context (even when console logging is disabled).
    void operation;
  }

  return { result, latency };
};

// Initialize OpenAI client
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// Functions for reading and processing game data from CSV file
const CSV_FILE_PATH = path.join(process.cwd(), 'data/Video Games Data.csv');

// Cache for CSV data (single value cache with TTL)
let csvDataCache: any[] | null = null;
let csvDataCacheTime: number = 0;
const CSV_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cached genre mappings with LRU eviction
const GENRE_MAPPING_CACHE_MAX_SIZE = 500; // Max 500 genre mappings
const GENRE_MAPPING_CACHE = new LRUCache<string>(
  GENRE_MAPPING_CACHE_MAX_SIZE,
  24 * 60 * 60 * 1000, // 24 hours TTL (genre mappings don't change often)
  30 * 60 * 1000 // Cleanup every 30 minutes
);

// Register with cache manager
cacheManager.registerCache('GenreMappingCache', GENRE_MAPPING_CACHE);

// Cache for user achievements to reduce database calls with LRU eviction
const ACHIEVEMENT_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const ACHIEVEMENT_CACHE_MAX_SIZE = 2000; // Max 2000 users
const userAchievementCache = new LRUCache<{
  achievements: any[],
  hasProAccess: boolean,
  lastChecked: number
}>(
  ACHIEVEMENT_CACHE_MAX_SIZE,
  ACHIEVEMENT_CACHE_TTL,
  5 * 60 * 1000 // Cleanup every 5 minutes
);

// Register with cache manager
cacheManager.registerCache('UserAchievementCache', userAchievementCache);

// Request deduplication cache to prevent duplicate API calls
const pendingRequests = new Map<string, Promise<any>>();
const REQUEST_DEDUP_TTL = 30 * 1000; // 30 seconds

// Generic request deduplication function
const deduplicateRequest = async <T>(
  cacheKey: string,
  requestFn: () => Promise<T>,
  ttl: number = REQUEST_DEDUP_TTL
): Promise<T> => {
  // Check if request is already in progress
  if (pendingRequests.has(cacheKey)) {
    // console.log(`Request deduplication: reusing pending request for ${cacheKey}`); // Commented out for production
    return pendingRequests.get(cacheKey) as Promise<T>;
  }

  // Create new request
  const requestPromise = (async () => {
    try {
      const result = await requestFn();
      // console.log(`Request deduplication: completed request for ${cacheKey}`); // Commented out for production
      return result;
    } catch (error) {
      // console.log(`Request deduplication: failed request for ${cacheKey}`); // Commented out for production
      throw error;
    } finally {
      // Clean up after TTL expires
      setTimeout(() => {
        pendingRequests.delete(cacheKey);
        // console.log(`Request deduplication: cleaned up cache for ${cacheKey}`); // Commented out for production
      }, ttl);
    }
  })();

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
};

// Function to read the CSV file
const readCSVFile = async (filePath: string) => {
  const fileContent = await readFile(filePath, 'utf8');
  return parse(fileContent, { columns: true });
};

// Function to get the CSV data
const getCSVData = async () => {
  const now = Date.now();
  if (csvDataCache && (now - csvDataCacheTime) < CSV_CACHE_TTL) {
    // console.log('CSV data served from cache'); // Commented out for production
    return csvDataCache;
  }

  try {
    // console.log('CSV data loaded from file'); // Commented out for production
    const data = await readCSVFile(CSV_FILE_PATH);
    csvDataCache = data;
    csvDataCacheTime = now;
    return data;
  } catch (error) {
    console.error('Error reading CSV file:', error);
    throw new Error('Failed to read CSV file');
  }
};

// Utility functions for formatting game information
const formatReleaseDate = (dateString: string): string => {
  const [day, month, year] = dateString.split('-');
  return `${month}/${day}/${year}`;
};

// Utility function to format game information
const formatGameInfo = (gameInfo: any): string => {
  const formattedReleaseDate = formatReleaseDate(gameInfo.release_date);
  return `${gameInfo.title} was released on ${formattedReleaseDate} for ${gameInfo.console}. It is a ${gameInfo.genre} game developed by ${gameInfo.developer} and published by ${gameInfo.publisher}.`;
};

// Pre-populate genre mapping cache
const initializeGenreCache = () => {
  const genreMapping: { [key: string]: string } = {
    "Xenoblade Chronicles 3": "Action RPG",
    "Final Fantasy VII": "Role-Playing Game",
    "Devil May Cry 5": "Hack and Slash",
    "Fortnite": "Battle Royale",
    "The Legend of Zelda: Ocarina of Time": "Adventure",
    "Super Mario Galaxy": "Platformer",
    "Resident Evil 4": "Survival Horror",
    "Splatoon 2": "Third-Person Shooter",
    "Castlevania: Symphony of the Night": "Metroidvania",
    "Bioshock Infinite": "First-Person Shooter",
    "Minecraft": "Sandbox",
    "Hades": "Roguelike",
    "Grand Theft Auto V": "Action-Adventure",
    "Animal Crossing": "Social Simulation",
    "World of Warcraft": "Massively Multiplayer Online Role-Playing Game",
    "Dota 2": "Multiplayer Online Battle Arena",
    "Braid": "Puzzle-Platformer",
    "Super Smash Bros. Ultimate": "Fighting Game",
    "Fire Emblem: Awakening": "Tactical Role-Playing Game",
    "Bloons TD 6": "Tower Defense",
    "Forza Horizon 5": "Racing",
    "Mario Kart 8 Deluxe": "Kart Racing",
    "Star Fox": "Rail Shooter",
    "Metal Gear Solid": "Stealth",
    "Gunstar Heroes": "Run and Gun",
    "Advance Wars": "Turn-Based Strategy",
    "Sid Meier's Civilization VI": "4X",
    "Hotline Miami": "Top-down Shooter",
    "Fifa 18": "Sports",
    "Super Mario Party": "Party",
    "Guitar Hero": "Rhythm",
    "Five Night's at Freddy's": "Point and Click",
    "Phoenix Wright: Ace Attorney": "Visual Novel",
    "Command & Conquer": "Real Time Strategy",
    "Streets of Rage 4": "Beat 'em up",
    "Tetris": "Puzzle",
    "XCOM: Enemy Unknown": "Turn-Based Tactics",
    "The Stanley Parable": "Interactive Story",
    "Pac-Man": "Maze",
    "Roblox": "Game Creation System",
    "Super Mario Maker": "Level Editor",
    "Temple Run": "Endless Runner",
    "Yu-Gi-Oh! Master Duel": "Digital Collectible Card Game",
    "Wii Fit": "Exergaming",
    "Deathloop": "Immersive Sim",
    "Bejeweled": "Tile-Matching",
    "Shellshock Live": "Artillery",
    "Roller Coaster Tycoon 3": "Construction and Management Simulation",
    "Stray": "Adventure",
    "No Man's Sky": "Survival",
    "Among Us": "Social Deduction",
  };

  Object.entries(genreMapping).forEach(([game, genre]) => {
    GENRE_MAPPING_CACHE.set(game.toLowerCase(), genre);
  });
};

// Initialize cache on module load
initializeGenreCache();

// Cache cleanup function to prevent memory leaks
const cleanupCache = () => {
  const now = Date.now();

  // Clean up CSV cache (single value cache)
  if (csvDataCache && (now - csvDataCacheTime) > CSV_CACHE_TTL * 2) {
    csvDataCache = null;
    csvDataCacheTime = 0;
    // console.log('CSV cache cleaned up'); // Commented out for production
  }

  // LRU caches handle their own cleanup, but we can trigger manual cleanup
  const genreRemoved = GENRE_MAPPING_CACHE.cleanup();
  const achievementRemoved = userAchievementCache.cleanup();

  if (genreRemoved > 0 || achievementRemoved > 0) {
    // console.log(`Cache cleanup: ${genreRemoved} genre mappings, ${achievementRemoved} achievements removed`); // Commented out for production
  }

  // Clean up request deduplication cache (remove completed requests)
  const pendingKeysToDelete: string[] = [];
  pendingRequests.forEach((promise, key) => {
    // Check if promise is settled (completed or rejected)
    Promise.allSettled([promise]).then(() => {
      pendingKeysToDelete.push(key);
    });
  });

  pendingKeysToDelete.forEach(key => pendingRequests.delete(key));

  if (pendingKeysToDelete.length > 0) {
    // console.log(`Request deduplication cache cleaned up ${pendingKeysToDelete.length} entries`); // Commented out for production
  }
};

// Set up periodic cache cleanup (every 10 minutes)
setInterval(cleanupCache, 10 * 60 * 1000);

// Log cache initialization
// console.log(`Genre mapping cache initialized with ${GENRE_MAPPING_CACHE.size} entries`); // Commented out for production
// console.log('CSV data caching enabled with 5-minute TTL'); // Commented out for production
// console.log('Achievement cache enabled with 2-minute TTL'); // Commented out for production
// console.log('Request deduplication enabled with 30-second TTL'); // Commented out for production

// Function to fetch game information from IGDB API
interface IGDBGame {
  name: string;
  release_dates?: { date: string }[];
  genres?: { name: string }[];
  platforms?: { name: string }[];
  involved_companies?: { company: { name: string }, publisher: boolean, developer: boolean }[];
  url?: string;
}

// Function to fetch game information from IGDB API
const fetchGamesFromIGDB = async (query: string): Promise<string | null> => {
  const cacheKey = `igdb:${query.toLowerCase().trim()}`;

  return deduplicateRequest(cacheKey, async () => {
    try {
      const accessToken = await getClientCredentialsAccessToken();
      // console.log('IGDB Access Token obtained:', accessToken ? 'Yes' : 'No'); // Commented out for production

      const headers = {
        'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      };

      // Limit query to 255 characters (IGDB API limit)
      const limitedQuery = query.length > 255 ? query.substring(0, 252) + '...' : query;

      // Sanitize the query to prevent injection
      const sanitizedQuery = limitedQuery.replace(/['"\\]/g, '');

      // Modified IGDB query
      const body = `
      search "${sanitizedQuery}";
      fields name,genres.name,platforms.name,release_dates.date,involved_companies.company.name,involved_companies.publisher,involved_companies.developer;
      limit 5;
    `;

      // console.log('IGDB Request:', {
      //   headers: {
      //     'Client-ID': 'present',
      //     'Authorization': 'Bearer present'
      //   },
      //   body: body
      // }); // Commented out for production

      const response = await axios.post('https://api.igdb.com/v4/games', body, { headers });

      if (response.data.length > 0) {
        const games = response.data as IGDBGame[];
        // Prefer exact name match, then fall back to first result
        const queryLower = sanitizedQuery.toLowerCase();
        const best = games.find(g => g.name.toLowerCase() === queryLower) || games[0];

        const releaseDate = best.release_dates?.[0]?.date
          ? new Date(Number(best.release_dates[0].date) * 1000).toLocaleDateString()
          : null;
        const platforms = best.platforms?.map(p => p.name).join(', ') || null;
        const genres = best.genres?.map(g => g.name).join(', ') || null;
        const developers = best.involved_companies?.filter(ic => ic.developer).map(ic => ic.company.name).join(', ') || null;

        let info = best.name;
        if (releaseDate) info += ` (Released: ${releaseDate})`;
        if (platforms) info += `, Platforms: ${platforms}`;
        if (genres) info += `, Genres: ${genres}`;
        if (developers) info += `, Developer: ${developers}`;

        return info;
      } else {
        return `No games found matching "${sanitizedQuery}"`;
      }
    } catch (error: any) {
      console.error('IGDB Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      return null; // Return null instead of throwing error to allow fallback to other sources
    }
  });
};

// Function to fetch game information from RAWG API
interface RAWGGame {
  name: string;
  released?: string;
  genres?: { name: string }[];
  platforms?: { platform: { name: string } }[];
  slug?: string;
}

// Function to fetch game information from RAWG API
const fetchGamesFromRAWG = async (searchQuery: string): Promise<string> => {
  const cacheKey = `rawg:${searchQuery.toLowerCase().trim()}`;

  return deduplicateRequest(cacheKey, async () => {
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(searchQuery)}`;
    try {
      const response = await axios.get(url);
      //console.log("RAWG API Response:", response.data); // Log the RAWG response data - commented out for production
      if (response.data && response.data.results.length > 0) {
        const queryLower = searchQuery.toLowerCase().trim();
        // Prefer exact name match, then fall back to the first result
        const bestMatch: RAWGGame = response.data.results.find((g: RAWGGame) =>
          g.name.toLowerCase().trim() === queryLower
        ) || response.data.results.find((g: RAWGGame) =>
          g.name.toLowerCase().includes(queryLower) || queryLower.includes(g.name.toLowerCase())
        ) || response.data.results[0];

        return `${bestMatch.name} (Released: ${bestMatch.released ? new Date(bestMatch.released).toLocaleDateString() : 'N/A'}, ` +
          `Genres: ${bestMatch.genres?.map((genre: { name: string }) => genre.name).join(', ') || 'N/A'}, ` +
          `Platforms: ${bestMatch.platforms?.map((platform: { platform: { name: string } }) => platform.platform.name).join(', ') || 'N/A'}, ` +
          `URL: https://rawg.io/games/${bestMatch.slug})`;
      } else {
        return `No games found related to ${searchQuery}.`;
      }
    } catch (error: any) {
      console.error("Error fetching data from RAWG:", error.message);
      return "Failed to fetch data from RAWG.";
    }
  });
};

// Function to combine game data from multiple sources (RAWG, IGDB, and local CSV)
const fetchAndCombineGameData = async (question: string, answer: string): Promise<string> => {
  // Extract game name from question using the AI-powered extractor
  let gameName = await extractGameTitleFromQuestion(question) || '';

  // Fallback: try simple release-date pattern or enhanced question context
  if (!gameName) {
    gameName = question.replace(/when (was|did) (.*?) (released|come out)/i, "$2").trim();
    if (gameName.includes('\n\n[') || gameName.length > 200) {
      const gameMatch = gameName.match(/Game:\s*([^\n,]+)/i);
      if (gameMatch && gameMatch[1]) {
        gameName = gameMatch[1].trim();
      } else {
        const questionPart = gameName.split('\n\n[')[0];
        gameName = questionPart.replace(/when (was|did) (.*?) (released|come out)/i, "$2").trim();
      }
    }
  }

  // Limit game name to 100 characters (safety limit, IGDB will further limit to 255)
  if (gameName.length > 100) {
    gameName = gameName.substring(0, 97) + '...';
  }

  try {
    // Fetch data from RAWG, IGDB, and CSV
    const [rawgResult, igdbResult, csvData] = await Promise.allSettled([
      fetchGamesFromRAWG(gameName),
      fetchGamesFromIGDB(gameName),
      getCSVData()
    ]);

    // Extract responses from promises
    const rawgResponse = rawgResult.status === 'fulfilled' ? rawgResult.value : null;
    const igdbResponse = igdbResult.status === 'fulfilled' ? igdbResult.value : null;
    const csvGameInfo =
      csvData.status === 'fulfilled'
        ? csvData.value.find((game: any) => game.title.toLowerCase() === gameName.toLowerCase())
        : null;

    if (csvGameInfo) {
      const formattedInfo = formatGameInfo(csvGameInfo);
      return `${answer}\n\nAdditional details from our library:\n${formattedInfo}`;
    }

    // Fallback enrichment: if our local CSV didn't match, use external sources (already fetched above).
    const enrichmentParts: string[] = [];

    if (
      typeof rawgResponse === "string" &&
      rawgResponse.trim() &&
      !rawgResponse.toLowerCase().includes("failed to fetch")
    ) {
      // Keep this bounded so answers don't explode in size.
      enrichmentParts.push(
        `From RAWG:\n${rawgResponse.trim().slice(0, 1200)}${rawgResponse.length > 1200 ? "…" : ""}`
      );
    }

    if (
      typeof igdbResponse === "string" &&
      igdbResponse.trim() &&
      !igdbResponse.toLowerCase().includes("error")
    ) {
      enrichmentParts.push(`From IGDB:\n${igdbResponse.trim().slice(0, 600)}${igdbResponse.length > 600 ? "…" : ""}`);
    }

    if (enrichmentParts.length > 0) {
      return `${answer}\n\nAdditional details from external sources:\n${enrichmentParts.join("\n\n")}`;
    }

    return answer;
  } catch (error) {
    console.error("Error combining game data:", error);
    return answer; // Return original answer even on error
  }
};

// Function to get game genre from predefined mapping
const getGenreFromMapping = (gameTitle: string): string | null => {
  return GENRE_MAPPING_CACHE.get(gameTitle.toLowerCase()) || null;
};

// Utility function to extract game title from user questions
const extractGameTitle = (question: string): string => {
  // First, handle titles with colons and apostrophes
  const fullTitleMatch = question.match(/["']([^"']+)["']|[:]?\s([^:?]+?)(?:\s(?:chapter|level|stage|part|area|boss|item|character|section|location|quest)|\?|$)/i);

  if (fullTitleMatch) {
    // Return the first captured group that isn't undefined
    return (fullTitleMatch[1] || fullTitleMatch[2]).trim();
  }

  // Fallback to the original pattern if no match
  const match = question.match(/(?:guide|walkthrough|progress|unlock|strategy|find).*?\s(.*?)(?:\s(?:chapter|level|stage|part|area|boss|item|character|section|location|quest))/i);
  return match ? match[1].trim() : '';
};

// Deduplicate a list of game names by series, keeping only the first game per series.
// Prevents sequels/prequels from appearing together (e.g., Portal + Portal 2).
const deduplicateBySeries = (games: string[]): string[] => {
  const extractSeriesName = (gameName: string): string => {
    let series = gameName
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*Game\s+of\s+the\s+Year\s+Edition/gi, '')
      .replace(/\s*Remastered/gi, '')
      .replace(/\s*Remaster/gi, '')
      .replace(/\s*Definitive\s+Edition/gi, '')
      .replace(/\s*Enhanced\s+Edition/gi, '')
      .replace(/\s*Ultimate\s+Edition/gi, '')
      .replace(/\s*Deluxe\s+Edition/gi, '')
      .replace(/\s*Complete\s+Edition/gi, '')
      .trim();

    // Handle "and the [subtitle]" pattern
    const andTheMatch = series.match(/^(.+?)\s+and\s+the\s+/i);
    if (andTheMatch) series = andTheMatch[1].trim();

    // Handle colons: strip subtitle (keep base before colon)
    // Exception: keep number when subtitle contains "Episode"
    const colonIndex = series.indexOf(':');
    let hadColonWithEpisode = false;
    if (colonIndex > 0) {
      const afterColon = series.substring(colonIndex + 1).trim();
      if (/\bepisode\b/i.test(afterColon)) {
        series = series.substring(0, colonIndex).trim();
        hadColonWithEpisode = true;
      } else {
        series = series.substring(0, colonIndex).trim();
      }
    }

    if (!hadColonWithEpisode) {
      // Strip "Part N" / "Part [Roman]"
      const withoutPart = series.replace(/\s+Part\s+[IVXLCDM\d]+$/i, '').trim();
      if (withoutPart.length > 0) series = withoutPart;
      // Strip trailing numbers (Portal 2 → Portal, Halo 3 → Halo)
      const withoutNumber = series.replace(/\s+\d+$/, '').trim();
      if (withoutNumber.length > 0) series = withoutNumber;
      // Strip trailing Roman numerals (Final Fantasy IX → Final Fantasy)
      const withoutRoman = series.replace(/\s+[IVXLCDM]+$/i, '').trim();
      if (withoutRoman.length > 0) series = withoutRoman;
    }

    return (series.trim().replace(/\s+/g, ' ') || gameName).toLowerCase();
  };

  const seenSeries = new Set<string>();
  return games.filter(game => {
    const series = extractSeriesName(game);
    if (seenSeries.has(series)) return false;
    seenSeries.add(series);
    return true;
  });
};

// Function to determine question category for achievement tracking
export const checkQuestionType = (question: string): string[] => {
  const lowerQuestion = question.toLowerCase();
  const detectedGenres = new Set<string>(); // Use Set for automatic deduplication
  // Track which specific terms triggered each achievement (for disambiguation)
  const matchEvidence: Record<string, string[]> = {};

  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * Keyword matching that avoids substring false positives.
   * - For simple alphanumeric tokens: use word boundaries and allow common suffixes (s/es/ed/ing)
   * - For multi-word / punctuation-heavy keywords: fall back to substring match
   */
  const hasKeyword = (text: string, keyword: string): boolean => {
    const k = (keyword || "").toLowerCase().trim();
    if (!k) return false;

    // Phrases / punctuated tokens: substring match
    if (!/^[a-z0-9]+$/i.test(k)) {
      return text.includes(k);
    }

    // Single token: word boundary match + common suffixes
    const re = new RegExp(`\\b${escapeRegExp(k)}(?:s|es|ed|ing)?\\b`, "i");
    return re.test(text);
  };

  // Early return for very short questions (less than 10 characters)
  if (lowerQuestion.length < 10) {
    // console.log('Question too short for genre detection:', question); // Commented out for production
    return [];
  }

  // Comprehensive game title to genre mapping
  const platformerGames = [
    'super mario bros', 'super mario world', 'super mario 64', 'super mario sunshine',
    'super mario galaxy', 'super mario odyssey', 'new super mario bros', 'donkey kong',
    'crash bandicoot', 'spyro', 'rayman', 'sonic the hedgehog', 'sonic adventure',
    'hollow knight', 'celeste', 'ori', 'little big planet', 'ratchet', 'clank',
    'jak', 'daxter', 'sly cooper', 'banjo', 'kazooie', 'metroid',
    'mega man', 'kirby', 'yoshi', 'platformer', 'jumping', 'a hat in time',
    'psychonauts', 'braid', 'shovel knight', 'cuphead', 'platforming', 'freedom planet',
    'sackboy', 'yooka-laylee', 'bubsy', 'pac-man world'
  ];

  const rpgGames = [
    'final fantasy', 'dragon quest', 'xenoblade', 'persona', 'shin megami',
    'pokemon', 'chrono trigger', 'mass effect', 'elder scrolls', 'skyrim',
    'fallout', 'witcher', 'dark souls', 'elden ring', 'bloodborne', 'sekiro',
    'tales of', 'kingdom hearts', 'ni no kuni', 'dragon age', 'baldur\'s gate',
    'pillars of eternity', 'divinity', 'octopath traveler', 'bravely default',
    'fire emblem', 'xenogears', 'xenosaga', 'saga', 'star ocean', 'ys', 'paper mario',
    'mario & luigi', 'triangle strategy', 'mega man battle network', 'mega man star force',
    'hades', 'mana', 'rune factory', 'skies of arcadia', 'shining force', 'phantasy star',
    'lufia', 'mother', 'earthbound', 'super mario rpg', 'mystery dungeon'
  ];

  const actionGames = [
    'devil may cry', 'bayonetta', 'god of war', 'ninja gaiden',
    'metal gear rising: revengeance', 'dynasty warriors', 'nier', 'automata',
    'darksiders', 'prototype', 'infamous', 'asura\'s wrath',
    'kingdom hearts', 'monster hunter', 'dragons dogma', 'grand theft auto',
    'the legend of zelda', 'red dead redemption', 'batman', 'lego',
    'arkham', 'assassin\'s creed', 'star wars', 'dead rising'
  ];

  const survivalGames = [
    'resident evil', 'silent hill', 'dead space', 'amnesia',
    'outlast', 'dying light', 'dead by daylight', 'left 4 dead',
    'state of decay', 'the forest', 'subnautica', 'rust',
    'dayz', '7 days to die', 'minecraft', 'valheim', 'no man\'s sky'
  ];

  const strategyGames = [
    'civilization', 'age of empires', 'starcraft', 'warcraft',
    'command & conquer', 'total war', 'xcom', 'fire emblem',
    'advance wars', 'into the breach', 'valkyria chronicles',
    'disgaea', 'triangle strategy', 'tactics ogre', 'homeworld'
  ];

  const shooterGames = [
    'call of duty', 'battlefield', 'halo', 'doom', 'overwatch',
    'counter strike', 'apex legends', 'titanfall', 'destiny',
    'borderlands', 'bioshock', 'half life', 'portal', 'valorant',
    'rainbow six', 'team fortress 2', 'quake', 'unreal tournament',
    'splatoon', 'far cry', 'battleborn', 'gears of war', 'wolfenstein'
  ];

  const sportsGames = [
    'fifa', 'nba', 'madden', 'nhl', 'pga', 'wii sports',
    'tony hawk', 'skate', 'mario tennis', 'mario golf',
    'mario strikers', 'rocket league', 'sports story', 'ea sports',
    'mlb', '2k', 'wwe', 'the show', 'olympic games', 'punch-out!!',
    'ufc', 'mario sports', 'mario superstar baseball', 'college football'
  ];

  const racingGames = [
    'forza', 'gran turismo', 'need for speed', 'mario kart',
    'burnout', 'dirt', 'f1', 'project cars', 'assetto corsa',
    'wipeout', 'crash team racing', 'sonic racing', 'crazy taxi',
    'destruction derby', 'excitebike', 'f-zero', 'hot wheels',
    'monster jam', 'monster energy', 'rally', 'ridge racer',
    'trackmania', 'twisted metal', 'sonic riders', 'sonic racing',
    'all-star racing'
  ];

  const stealthGames = [
    'metal gear solid', 'splinter cell', 'hitman', 'assassin\'s creed',
    'thief', 'dishonored', 'deus ex', 'death loop', 'aragami', 'metal gear'
  ];

  const battleRoyaleGames = [
    'players unknown battlegrounds', 'pubg', 'apex legends', 'fortnite',
    'fall guys', 'call of duty: warzone', 'eternal return'
  ];

  const visualNovelGames = [
    'phoenix wright', 'ace attorney', 'doki doki literature club', 'sakura wars',
    'danganronpa', 'steins gate', 'hatoful boyfriend', 'coffee talk'
  ];

  const simulationGames = [
    'sim city', 'the sims', 'animal crossing', 'farming simulator',
    'microsoft flight simulator', 'bus simulator', 'train simulator', 'goat simulator',
    'cities: skylines', 'stardew valley', 'harvest moon', 'story of seasons'
  ];

  const horrorGames = [
    'resident evil', 'silent hill', 'dead space', 'amnesia',
    'outlast', 'layers of fear', 'little nightmares', 'evil within',
    'until dawn', 'five nights at freddy\'s', 'phasmophobia', 'state of decay'
  ];

  const adventureGames = [
    'the legend of zelda', 'the last of us', 'the witcher', 'the elder scrolls',
    'the walking dead', 'the last guardian', 'blaster master', 'turnip boy', 'luigi\'s mansion',
    'shenmue', 'hogwarts legacy', 'far cry', 'assassin\'s creed', 'uncharted',
    'red dead redemption', 'god of war', 'wolfenstein', 'batman', 'arkham', 'star wars'
  ];

  const fightingGames = [
    'street fighter', 'tekken', 'rival schools', 'super smash bros', 'darkstalkers',
    'marvel vs capcom', 'capcom vs snk', 'fatal fury', 'mortal kombat', 'art of fighting',
    'soulcalibur', 'dead or alive', 'king of fighters', 'guilty gear', 'injustice',
    'virtua fighter', 'blazblue', 'capcom vs', 'playstation all stars', 'brawlhalla',
    'jump', 'dragon ball z', 'fighting vipers', 'dragon ball fighterz'
  ];

  const puzzleGames = [
    'dr. mario', 'portal', 'baba is you', 'tetris', 'professor layton',
    'the witness', 'talos principle', 'braid', 'fez',
    'human fall flat', 'untitled goose game', 'it takes two',
    'candy crush', 'bejeweled', 'inside', 'outer wilds'
  ];

  const beatEmUpGames = [
    'streets of rage', 'river city girls', 'final fight', 'yakuza', 'like a dragon',
    'double dragon', 'sifu', 'golden axe', 'battletoads', 'castle crashers', 'scott pilgrim',
    'teenage mutant ninja turtles'
  ];

  const rhythmGames = [
    'crypt of the necrodancer', 'dance dance revolution', 'space channel 5', 'samba de amigo',
    'beat saber', 'rhythm heaven', 'parappa the rapper', 'friday night funkin', 'geometry dash',
    'arcaea', 'guitar hero', 'rock band', 'donkey konga', 'theatrhythm final fantasy', 'osu!',
    'taiko no tatsujin', 'thumper', 'hi-fi rush', 'rhythm doctor', 'metal: hellslinger',
    'sayonara wild hearts', 'fuser'
  ];

  const sandboxGames = ['minecraft', 'garry\'s mod', 'roblox', 'lego', 'terraria', 'teardown',
    'no man\'s sky', 'valheim', 'astroneer', 'besiege', 'unturned'
  ];

  const shootemUpGames = ['Gunstar Heroes', 'gradius', 'Enter the Gungeon', 'Ikaruga', 'Radiant Silvergun', 'DoDonPachi',
    'Thunder Force', 'Fantasy Zone', 'Magical Chase', 'Centipede', 'Galaxian', 'Metal Slug', 'Contra', 'Steel Empire',
    'Paradius', 'Darius', 'Space Invaders', 'Raiden', 'Shock Troopers'
  ];

  const roguelikeGames = [
    'hades',
    'hades ii',
    'the binding of isaac',
    'binding of isaac',
    'risk of rain',
    'dead cells',
    'balatro',
    'slay the spire',
    'into the breach',
    'ftl: faster than light',
    'vampire survivors',
    'against the storm',
    // Roguelike dungeon-crawler RPGs
    'pokemon mystery dungeon',
    'mystery dungeon',
  ];

  // Check for genre keywords in the question
  const genreKeywords = {
    platformerPro: ['platform', 'jump', 'collect coins', 'collect', '3d platformer', '2d platformer'],
    rpgEnthusiast: ['rpg', 'role playing', 'role-playing', 'jrpg', 'level up', 'stats', 'character build'],
    bossBuster: ['boss fight', 'boss battle', 'defeat boss', 'beat the boss', 'final boss', 'superboss'],
    survivalSpecialist: ['survival', 'survive', 'horror', 'zombie', 'craft', 'resource', 'gather'],
    strategySpecialist: ['strategy', 'tactics', 'turn-based', 'rts', 'build', 'command'],
    actionAficionado: ['action', 'combat', 'combo', 'fight', 'hack and slash', 'battle system'],
    battleRoyaleMaster: ['battle royale', 'fortnite', 'pubg', 'last man standing', 'battle pass'],
    sportsChampion: ['sports', 'score', 'tournament', 'championship', 'league', 'competition', 'event'],
    // include variants since hasKeyword() uses word boundaries
    adventureAddict: ['adventure', 'explore', 'exploring', 'exploration', 'open world', 'quest', 'quests', 'story', 'stories'],
    shooterSpecialist: ['shooter', 'fps', 'first person shooter', 'third person shooter', 'aim', 'gun', 'shooting'],
    simulationSpecialist: ['simulation', 'sim', 'management', 'construction', 'management simulation', 'town', 'city'],
    fightingFanatic: ['fighting', 'combo', 'cancel', 'air dodge', 'frame', 'mixup', 'throw', 'hit stun', 'stun lock', 'block'],
    puzzlePro: ['puzzle', 'solve', 'riddle', 'brain teaser', 'logic'],
    racingRenegade: ['racing', 'race', 'drift', 'track', 'lap', 'speed', 'kart', 'wheelie'],
    stealthExpert: ['stealth', 'sneak', 'hide', 'assassination', 'silent'],
    horrorHero: ['horror', 'scary', 'survival horror', 'fear', 'terror', 'suspense', 'jump scare'],
    storySeeker: ['story', 'narrative', 'plot', 'dialogue', 'cutscene', 'cinematic', 'visual novel'],
    triviaMaster: ['trivia', 'quiz', 'knowledge', 'question', 'answer', 'category'],
    beatEmUpBrawler: ['brawler', 'side-scrolling', 'frame advantage', 'belt-scroll', 'pressure', 'dash'],
    rhythmMaster: ['rhythm', 'music', 'beat', 'dance', 'song', 'beatmap', 'notes', 'streams', 'beats per minute'],
    sandboxBuilder: ['sandbox', 'build', 'construct', 'create', 'world', 'craft', 'creative', 'free-form gameplay', 'design', 'materials'],
    shootemUpSniper: ['fixed shooter, side-scrolling shooter, vertical shooter, top-down shooter, run and gun', 'multidirectional shooter'],
    rogueRenegade: [
      'roguelike',
      'rogue-like',
      'roguelite',
      'rogue-lite',
      'dungeon crawler',
      'procedural',
      'procedurally generated',
      'randomized',
      'randomly generated',
      'permadeath',
      'perma-death',
      'run-based',
      'run based',
      'replayability'
    ]
  };

  // Check all game genres and collect all matches
  const genreChecks = [
    { games: racingGames, achievement: 'racingRenegade' },
    { games: sportsGames, achievement: 'sportsChampion' },
    { games: rpgGames, achievement: 'rpgEnthusiast' },
    { games: actionGames, achievement: 'actionAficionado' },
    { games: survivalGames, achievement: 'survivalSpecialist' },
    { games: strategyGames, achievement: 'strategySpecialist' },
    { games: shooterGames, achievement: 'shooterSpecialist' },
    { games: simulationGames, achievement: 'simulationSpecialist' },
    { games: battleRoyaleGames, achievement: 'battleRoyaleMaster' },
    { games: stealthGames, achievement: 'stealthExpert' },
    { games: horrorGames, achievement: 'horrorHero' },
    { games: adventureGames, achievement: 'adventureAddict' },
    { games: fightingGames, achievement: 'fightingFanatic' },
    { games: visualNovelGames, achievement: 'storySeeker' },
    { games: puzzleGames, achievement: 'puzzlePro' },
    { games: beatEmUpGames, achievement: 'beatEmUpBrawler' },
    { games: rhythmGames, achievement: 'rhythmMaster' },
    { games: platformerGames, achievement: 'platformerPro' },
    { games: sandboxGames, achievement: 'sandboxBuilder' },
    { games: shootemUpGames, achievement: 'shootemUpSniper' },
    { games: roguelikeGames, achievement: 'rogueRenegade' }
  ];

  for (const check of genreChecks) {
    let matchedTerm: string | undefined;
    for (const game of check.games) {
      const gameLower = String(game).toLowerCase();
      if (gameLower && lowerQuestion.includes(gameLower)) {
        matchedTerm = gameLower;
        break;
      }
    }
    if (matchedTerm) {
      detectedGenres.add(check.achievement);
      (matchEvidence[check.achievement] ||= []).push(matchedTerm);
    }
  }

  // Check for genre keywords and add them
  for (const [achievement, keywords] of Object.entries(genreKeywords)) {
    if (keywords.some((keyword) => hasKeyword(lowerQuestion, keyword))) {
      detectedGenres.add(achievement);
    }
  }

  // Special achievements based on question content with consolidated regex patterns
  const specialPatterns = [
    { pattern: /(speedrun|fast completion|world record|fastest way)/, achievement: 'speedrunner' },
    { pattern: /(collect|items|100%|completion|achievements|trophies)/, achievement: 'collectorPro' },
    { pattern: /(stats|data|numbers|analysis)/, achievement: 'dataDiver' },
    { pattern: /(performance|fps|graphics|optimization|settings|lag)/, achievement: 'performanceTweaker' }
  ];

  for (const { pattern, achievement } of specialPatterns) {
    if (pattern.test(lowerQuestion)) {
      detectedGenres.add(achievement);
    }
  }

  // ---------------------------------------------------------------------------
  // Disambiguation safeguards
  //
  // Problem: some single-word game names (e.g. "destiny") can appear as common
  // nouns inside other games’ locations/items (e.g. "Destiny Tower" in PMD).
  // That can incorrectly award genre achievements (and thus daily challenges).
  //
  // Solution: if a genre match was triggered *only* by ambiguous terms, and we
  // also detected another "core genre" signal, drop the ambiguous one.
  // ---------------------------------------------------------------------------
  const CORE_GENRE_ACHIEVEMENTS = new Set([
    'platformerPro',
    'rpgEnthusiast',
    'strategySpecialist',
    'actionAficionado',
    'survivalSpecialist',
    'sportsChampion',
    'adventureAddict',
    'fightingFanatic',
    'shooterSpecialist',
    'simulationSpecialist',
    'puzzlePro',
    'racingRenegade',
    'stealthExpert',
    'horrorHero',
    'storySeeker',
    'beatEmUpBrawler',
    'rhythmMaster',
    'sandboxBuilder',
    'battleRoyaleMaster',
    'shootemUpSniper',
    'rogueRenegade'
  ]);

  const hasOtherCoreGenre = Array.from(detectedGenres).some(
    (g) => g !== 'shooterSpecialist' && CORE_GENRE_ACHIEVEMENTS.has(g)
  );

  const shooterEvidence = matchEvidence['shooterSpecialist'] || [];
  const AMBIGUOUS_SHOOTER_TERMS = new Set([
    // "Destiny Tower" is a Pokémon Mystery Dungeon location; "destiny" alone is ambiguous.
    'destiny',
    // Portal is a puzzle game; the word can also be used generically.
    'portal',
  ]);
  const shooterIsAmbiguousOnly =
    shooterEvidence.length > 0 &&
    shooterEvidence.every((t) => AMBIGUOUS_SHOOTER_TERMS.has(t));

  if (shooterIsAmbiguousOnly && hasOtherCoreGenre) {
    detectedGenres.delete('shooterSpecialist');
  }

  // Remove duplicates and return
  const uniqueGenres: string[] = Array.from(detectedGenres);
  return uniqueGenres;
};

// Function to check and award achievements based on user progress
export const checkAndAwardAchievements = async (username: string, progress: any, session: mongoose.ClientSession | null = null) => {
  // console.log('Checking achievements for user:', username); // Commented out for production
  // console.log('Current progress:', progress); // Commented out for production

  const now = Date.now();
  const cacheKey = username;
  const cached = userAchievementCache.get(cacheKey);

  // Use cache if available (LRU cache handles TTL automatically)
  if (cached && (now - cached.lastChecked) < ACHIEVEMENT_CACHE_TTL) {
    // console.log('Using cached achievement data for user:', username); // Commented out for production
    const currentAchievements = cached.achievements;
    const hasProAccess = cached.hasProAccess;

    // Check if any new achievements can be earned with current progress
    const newAchievements: { name: string; dateEarned: Date }[] = [];

    // Check each achievement condition using cached data
    const achievementChecks = [
      { name: 'RPG Enthusiast', field: 'rpgEnthusiast', threshold: 5 },
      { name: 'Boss Buster', field: 'bossBuster', threshold: 5 },
      { name: 'Platformer Pro', field: 'platformerPro', threshold: 5 },
      { name: 'Survival Specialist', field: 'survivalSpecialist', threshold: 5 },
      { name: 'Strategy Specialist', field: 'strategySpecialist', threshold: 5 },
      { name: 'Action Aficionado', field: 'actionAficionado', threshold: 5 },
      { name: 'Battle Royale Master', field: 'battleRoyaleMaster', threshold: 5 },
      { name: 'Sports Champion', field: 'sportsChampion', threshold: 5 },
      { name: 'Adventure Addict', field: 'adventureAddict', threshold: 5 },
      { name: 'Shooter Specialist', field: 'shooterSpecialist', threshold: 5 },
      { name: 'Fighting Fanatic', field: 'fightingFanatic', threshold: 5 },
      { name: 'Simulation Specialist', field: 'simulationSpecialist', threshold: 5 },
      { name: 'Puzzle Pro', field: 'puzzlePro', threshold: 5 },
      { name: 'Racing Renegade', field: 'racingRenegade', threshold: 5 },
      { name: 'Stealth Expert', field: 'stealthExpert', threshold: 5 },
      { name: 'Horror Hero', field: 'horrorHero', threshold: 5 },
      { name: 'Trivia Master', field: 'triviaMaster', threshold: 5 },
      { name: 'Story Seeker', field: 'storySeeker', threshold: 5 },
      { name: 'Beat Em Up Brawler', field: 'beatEmUpBrawler', threshold: 5 },
      { name: 'Rhythm Master', field: 'rhythmMaster', threshold: 5 },
      { name: 'Sandbox Builder', field: 'sandboxBuilder', threshold: 5 },
      { name: 'Shootem Up Sniper', field: 'shootemUpSniper', threshold: 5 },
      { name: 'Rogue Renegade', field: 'rogueRenegade', threshold: 5 }
    ];

    // Check each achievement
    for (const check of achievementChecks) {
      const progressValue = progress[check.field] || 0;
      if (progressValue >= check.threshold &&
        !currentAchievements.some((a: { name: string; }) => a.name === check.name)) {
        newAchievements.push({
          name: check.name,
          dateEarned: new Date()
        });
        // console.log(`Achievement earned: ${check.name}`); // Commented out for production
      }
    }

    // Check Pro achievements if user has Pro access
    if (hasProAccess) {
      const proAchievementChecks = [
        {
          name: 'Game Master',
          field: 'proAchievements.gameMaster',
          threshold: 10,
          condition: () => {
            const genreCounts = Object.entries(progress)
              .filter(([key]) => !key.startsWith('proAchievements'))
              .filter(([_, value]) => (value as number) >= 5)
              .length;
            return genreCounts >= 5;
          }
        },
        {
          name: 'Speed Demon',
          field: 'proAchievements.speedDemon',
          threshold: 20,
          condition: () => progress.totalQuestions >= 100
        },
        {
          name: 'Community Leader',
          field: 'proAchievements.communityLeader',
          threshold: 15,
          condition: () => progress.totalQuestions >= 200
        },
        {
          name: 'Achievement Hunter',
          field: 'proAchievements.achievementHunter',
          threshold: 1,
          condition: () => currentAchievements.length >= 15
        },
        {
          name: 'Pro Streak',
          field: 'proAchievements.proStreak',
          threshold: 7,
          condition: () => progress.dailyExplorer >= 7
        },
        {
          name: 'Expert Advisor',
          field: 'proAchievements.expertAdvisor',
          threshold: 50,
          condition: () => progress.totalQuestions >= 500
        },
        {
          name: 'Genre Specialist',
          field: 'proAchievements.genreSpecialist',
          threshold: 1,
          condition: () => {
            const maxGenre = Object.entries(progress)
              .filter(([key]) => !key.startsWith('proAchievements'))
              .reduce((max, [_, value]) => Math.max(max, value as number), 0);
            return maxGenre >= 20;
          }
        },
        {
          name: 'Pro Contributor',
          field: 'proAchievements.proContributor',
          threshold: 1,
          condition: () => progress.totalQuestions >= 1000
        }
      ];

      for (const check of proAchievementChecks) {
        if (check.condition() &&
          !currentAchievements.some((a: { name: string; }) => a.name === check.name)) {
          newAchievements.push({
            name: check.name,
            dateEarned: new Date()
          });
          // console.log(`Pro achievement earned: ${check.name}`); // Commented out for production
        }
      }
    }

    // If new achievements found, update cache and return them
    if (newAchievements.length > 0) {
      // console.log('New achievements found using cache:', newAchievements.length); // Commented out for production
      // Update cache with new achievements
      userAchievementCache.set(cacheKey, {
        achievements: [...currentAchievements, ...newAchievements],
        hasProAccess,
        lastChecked: now
      });
      return newAchievements;
    }

    return []; // No new achievements
  }

  // Cache miss or expired - fetch from database
  // console.log('Cache miss for user achievements, fetching from database:', username); // Commented out for production
  const user = await User.findOne({ username }).session(session);
  const currentAchievements = user?.achievements || [];
  const newAchievements: { name: string; dateEarned: Date }[] = [];

  // Log current state
  // console.log('Current achievements:', currentAchievements); // Commented out for production

  // Check each achievement condition
  const achievementChecks = [
    { name: 'RPG Enthusiast', field: 'rpgEnthusiast', threshold: 5 },
    { name: 'Boss Buster', field: 'bossBuster', threshold: 5 },
    { name: 'Platformer Pro', field: 'platformerPro', threshold: 5 },
    { name: 'Survival Specialist', field: 'survivalSpecialist', threshold: 5 },
    { name: 'Strategy Specialist', field: 'strategySpecialist', threshold: 5 },
    { name: 'Action Aficionado', field: 'actionAficionado', threshold: 5 },
    { name: 'Battle Royale Master', field: 'battleRoyaleMaster', threshold: 5 },
    { name: 'Sports Champion', field: 'sportsChampion', threshold: 5 },
    { name: 'Adventure Addict', field: 'adventureAddict', threshold: 5 },
    { name: 'Shooter Specialist', field: 'shooterSpecialist', threshold: 5 },
    { name: 'Fighting Fanatic', field: 'fightingFanatic', threshold: 5 },
    { name: 'Simulation Specialist', field: 'simulationSpecialist', threshold: 5 },
    { name: 'Puzzle Pro', field: 'puzzlePro', threshold: 5 },
    { name: 'Racing Renegade', field: 'racingRenegade', threshold: 5 },
    { name: 'Stealth Expert', field: 'stealthExpert', threshold: 5 },
    { name: 'Horror Hero', field: 'horrorHero', threshold: 5 },
    { name: 'Trivia Master', field: 'triviaMaster', threshold: 5 },
    { name: 'Story Seeker', field: 'storySeeker', threshold: 5 },
    { name: 'Beat Em Up Brawler', field: 'beatEmUpBrawler', threshold: 5 },
    { name: 'Rhythm Master', field: 'rhythmMaster', threshold: 5 },
    { name: 'Sandbox Builder', field: 'sandboxBuilder', threshold: 5 },
    { name: 'Shootem Up Sniper', field: 'shootemUpSniper', threshold: 5 },
    { name: 'Rogue Renegade', field: 'rogueRenegade', threshold: 5 }
  ];

  // Check each achievement
  for (const check of achievementChecks) {
    const progressValue = progress[check.field] || 0;
    // console.log(`Checking ${check.name}: ${progressValue}/${check.threshold}`); // Commented out for production

    if (progressValue >= check.threshold &&
      !currentAchievements.some((a: { name: string; }) => a.name === check.name)) {
      newAchievements.push({
        name: check.name,
        dateEarned: new Date()
      });
      // console.log(`Achievement earned: ${check.name}`); // Commented out for production
    }
  }

  // Check Pro achievements if user has Pro access
  if (user?.hasProAccess) {
    const proAchievementChecks = [
      {
        name: 'Game Master',
        field: 'proAchievements.gameMaster',
        threshold: 10,
        condition: () => {
          const genreCounts = Object.entries(progress)
            .filter(([key]) => !key.startsWith('proAchievements'))
            .filter(([_, value]) => (value as number) >= 5)
            .length;
          return genreCounts >= 5;
        }
      },
      {
        name: 'Speed Demon',
        field: 'proAchievements.speedDemon',
        threshold: 20,
        condition: () => progress.totalQuestions >= 100
      },
      {
        name: 'Community Leader',
        field: 'proAchievements.communityLeader',
        threshold: 15,
        condition: () => progress.totalQuestions >= 200
      },
      {
        name: 'Achievement Hunter',
        field: 'proAchievements.achievementHunter',
        threshold: 1,
        condition: () => currentAchievements.length >= 15
      },
      {
        name: 'Pro Streak',
        field: 'proAchievements.proStreak',
        threshold: 7,
        condition: () => progress.dailyExplorer >= 7
      },
      {
        name: 'Expert Advisor',
        field: 'proAchievements.expertAdvisor',
        threshold: 50,
        condition: () => progress.totalQuestions >= 500
      },
      {
        name: 'Genre Specialist',
        field: 'proAchievements.genreSpecialist',
        threshold: 1,
        condition: () => {
          const maxGenre = Object.entries(progress)
            .filter(([key]) => !key.startsWith('proAchievements'))
            .reduce((max, [_, value]) => Math.max(max, value as number), 0);
          return maxGenre >= 20;
        }
      },
      {
        name: 'Pro Contributor',
        field: 'proAchievements.proContributor',
        threshold: 1,
        condition: () => progress.totalQuestions >= 1000
      }
    ];

    for (const check of proAchievementChecks) {
      if (check.condition() &&
        !currentAchievements.some((a: { name: string; }) => a.name === check.name)) {
        newAchievements.push({
          name: check.name,
          dateEarned: new Date()
        });
        // console.log(`Pro achievement earned: ${check.name}`); // Commented out for production
      }
    }
  }

  if (newAchievements.length > 0) {
    // console.log('New achievements to award:', newAchievements); // Commented out for production

    // Update the user with the new achievements
    await User.findOneAndUpdate(
      { username },
      {
        $set: { progress },
        $push: { achievements: { $each: newAchievements } }
      },
      { session: session || undefined, new: true }
    );

    // Emit achievement event with enhanced data for Pro users (only if Socket.IO is available)
    if (newAchievements.length > 0) {
      try {
        const io = getIO();
        if (io) {
          io.emit('achievementEarned', {
            username,
            achievements: newAchievements,
            isPro: user?.hasProAccess || false,
            message: `Congratulations! You've earned ${newAchievements.length} new achievement${newAchievements.length > 1 ? 's' : ''}!`,
            totalAchievements: (currentAchievements.length + newAchievements.length)
          });
        }
      } catch (e) {
        console.warn('Socket.IO not initialized, skipping achievement emit.');
      }
    }

    // Update cache with new achievements and user data
    userAchievementCache.set(cacheKey, {
      achievements: [...currentAchievements, ...newAchievements],
      hasProAccess: user?.hasProAccess || false,
      lastChecked: now
    }, ACHIEVEMENT_CACHE_TTL);
    // console.log('Achievement cache updated for user:', username); // Commented out for production

    return newAchievements;
  }

  // Update cache even when no new achievements (to avoid repeated DB calls)
  userAchievementCache.set(cacheKey, {
    achievements: currentAchievements,
    hasProAccess: user?.hasProAccess || false,
    lastChecked: now
  }, ACHIEVEMENT_CACHE_TTL);
  // console.log('Achievement cache updated (no new achievements) for user:', username); // Commented out for production

  return [];
};

// Optimized memory measurement with caching
let memoryCache: { data: any; timestamp: number } | null = null;
const MEMORY_CACHE_TTL = 1000; // 1 second cache

const measureMemoryUsage = (forceRefresh: boolean = false) => {
  const now = Date.now();

  // Return cached data if recent and not forcing refresh
  if (!forceRefresh && memoryCache && (now - memoryCache.timestamp) < MEMORY_CACHE_TTL) {
    return memoryCache.data;
  }

  const used = process.memoryUsage();
  const data = {
    heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100 + 'MB',
    heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100 + 'MB',
    rss: Math.round(used.rss / 1024 / 1024 * 100) / 100 + 'MB',
    external: Math.round(used.external / 1024 / 1024 * 100) / 100 + 'MB'
  };

  // Cache the result
  memoryCache = { data, timestamp: now };
  return data;
};

// Optimized response size measurement
const measureResponseSize = (data: any, estimateOnly: boolean = false) => {
  if (estimateOnly) {
    // Quick estimation without full JSON.stringify
    const estimatedSize = JSON.stringify(data).length;
    return {
      bytes: estimatedSize,
      kilobytes: (estimatedSize / 1024).toFixed(2) + 'KB',
      estimated: true
    };
  }

  const size = Buffer.byteLength(JSON.stringify(data));
  return {
    bytes: size,
    kilobytes: (size / 1024).toFixed(2) + 'KB',
    estimated: false
  };
};

// Optimized database query measurement
const measureDBQuery = async (operation: string, query: () => Promise<any>, enableDetailedMetrics: boolean = false) => {
  const startTime = performance.now();

  // Only measure memory if detailed metrics are enabled
  const startMemory = enableDetailedMetrics ? process.memoryUsage().heapUsed : 0;

  const result = await query();

  const endTime = performance.now();
  const executionTime = endTime - startTime;

  const metrics: any = {
    operation,
    executionTime: `${executionTime.toFixed(2)}ms`,
    result
  };

  // Only add memory metrics if detailed monitoring is enabled
  if (enableDetailedMetrics) {
    const endMemory = process.memoryUsage().heapUsed;
    metrics.memoryUsed = `${((endMemory - startMemory) / 1024 / 1024).toFixed(2)}MB`;
  }

  return metrics;
};

// Optimized request rate monitoring
class RequestMonitor {
  private requests: number = 0;
  private startTime: number = Date.now();
  private lastRateCalculation: number = 0;
  private cachedRate: { totalRequests: number; requestsPerSecond: string } | null = null;
  private readonly RATE_CACHE_TTL = 5000; // 5 seconds

  incrementRequest() {
    this.requests++;
  }

  getRequestRate() {
    const now = Date.now();

    // Return cached rate if recent
    if (this.cachedRate && (now - this.lastRateCalculation) < this.RATE_CACHE_TTL) {
      return this.cachedRate;
    }

    const elapsed = (now - this.startTime) / 1000; // seconds
    const rate = {
      totalRequests: this.requests,
      requestsPerSecond: (this.requests / elapsed).toFixed(2)
    };

    // Cache the result
    this.cachedRate = rate;
    this.lastRateCalculation = now;

    return rate;
  }
}

// Performance monitoring configuration
const PERFORMANCE_CONFIG = {
  enableDetailedMetrics: process.env.NODE_ENV === 'development' || process.env.ENABLE_DETAILED_METRICS === 'true',
  enableLogging: process.env.NODE_ENV === 'development' || process.env.ENABLE_PERFORMANCE_LOGGING === 'true',
  enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true',
  logLevel: process.env.LOG_LEVEL || 'info'
};

// Optimized logger with conditional file transport
const logger = winston.createLogger({
  level: PERFORMANCE_CONFIG.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'game-assistant' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
      silent: !PERFORMANCE_CONFIG.enableLogging
    }),
    ...(PERFORMANCE_CONFIG.enableFileLogging ? [
      new winston.transports.File({ filename: 'performance-metrics.log' })
    ] : [])
  ]
});

// Add custom error classes
class AssistantError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message);
    this.name = 'AssistantError';
  }
}

class ValidationError extends AssistantError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

// Main API handler function that processes incoming requests
const assistantHandler = async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const startTime = performance.now();
  const { question, code, imageFilePath, imageUrl } = req.body;
  const metrics: Metrics = {};
  const requestMonitor = new RequestMonitor();
  const aiCache = getAICache();
  let username: string | undefined; // Declare outside try block for error handling

  try {
    // Authenticate user - get username from authenticated session
    const authResult = await requireAuth(req, res);

    if (!authResult.authenticated || !authResult.username) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please sign in to use the assistant',
        metrics
      });
    }

    // Use authenticated username (security: prevent username spoofing)
    username = authResult.username;

    // Validate question
    if (!question || typeof question !== 'string') {
      throw new ValidationError('Invalid question format - question must be a non-empty string');
    }

    // Check for offensive content first
    const contentCheck = await containsOffensiveContent(question, username);
    if (contentCheck.isOffensive) {
      if (contentCheck.violationResult?.action === 'banned') {
        logger.warn('User banned for offensive content', { username, question });
        return res.status(403).json({
          error: 'Account Suspended',
          message: 'Your account is temporarily suspended',
          banExpiresAt: contentCheck.violationResult.expiresAt,
          metrics
        });
      }

      if (contentCheck.violationResult?.action === 'warning') {
        logger.warn('A warning has been issued for offensive content', { username, question, warningCount: contentCheck.violationResult.count });
        return res.status(400).json({
          error: 'Content Warning',
          message: `Warning ${contentCheck.violationResult.count}/3: Please avoid using inappropriate language`,
          offendingWords: contentCheck.offendingWords,
          metrics
        });
      }
    }

    // Connect to MongoDB (required for downstream operations)
    // Measure connection latency while connecting
    const { latency: dbLatency } = await measureLatency('MongoDB Connection', async () => {
      await connectToMongoDB();
    }, PERFORMANCE_CONFIG.enableLogging);
    metrics.dbConnection = dbLatency;

    // Load the user to update streak/usage data later
    const user = await User.findOne({ username });

    // Track request
    requestMonitor.incrementRequest();

    // Measure memory at start (only if detailed metrics enabled)
    if (PERFORMANCE_CONFIG.enableDetailedMetrics) {
      metrics.initialMemory = measureMemoryUsage();
    }

    let answer: string | null;

    // Add timeout promises - longer timeout for vision API calls (60s), shorter for text-only (25s)
    // Track cancellation for telemetry/debug visibility
    let timeoutCancelled = false;
    let visionTimeoutCancelled = false;

    // Create cancellable timeout promises that won't reject if cancelled
    const createTimeoutPromise = (ms: number, errorMessage: string): { promise: Promise<never>, cancel: () => void, id: NodeJS.Timeout | null } => {
      let id: NodeJS.Timeout | null = null;
      // Use an object to ensure the reference is shared correctly in closures
      const state = { cancelled: false };
      let rejectFn: ((error: Error) => void) | null = null;

      // Create a promise that will be rejected on timeout, but can be cancelled
      const promise = new Promise<never>((_, reject) => {
        rejectFn = reject;
        id = setTimeout(() => {
          // Double-check cancellation state atomically
          if (!state.cancelled && rejectFn) {
            // Mark as about to reject to prevent race conditions
            const shouldReject = !state.cancelled;
            if (shouldReject && rejectFn) {
              try {
                rejectFn(new Error(errorMessage));
              } catch (e) {
                // Ignore errors from rejecting an already-settled promise
                // This can happen if the promise was already resolved/rejected
              }
            }
          }
        }, ms);
      });

      // CRITICAL: Attach catch handler IMMEDIATELY and SYNCHRONOUSLY to prevent unhandled rejections
      // This must happen before any await or async operations
      const catchHandler = (err: any) => {
        // Silently swallow all rejections - we handle them through the wrapper
        // This prevents "unhandledRejection" errors
      };
      promise.catch(catchHandler);

      // We use a wrapper that only rejects if not cancelled
      // This ensures Promise.race works correctly while preventing unhandled rejections
      const safePromise = new Promise<never>((resolve, reject) => {
        promise.then(
          resolve,
          (err) => {
            // Only propagate rejection if not cancelled
            if (!state.cancelled) {
              reject(err);
            }
            // If cancelled, we don't reject - Promise.race will use the other promise
          }
        );
      });

      // CRITICAL: Also attach catch handler to safePromise to prevent any unhandled rejections
      // This is a safety net in case the rejection propagates
      safePromise.catch(() => {
        // Silently handle - this prevents unhandled rejection warnings
      });

      const cancel = () => {
        // Set cancelled flag in shared state object (must be first to prevent race conditions)
        state.cancelled = true;
        // Clear the reject function BEFORE clearing timeout to prevent it from being called
        rejectFn = null;
        if (id) {
          clearTimeout(id);
          id = null;
        }
      };

      return { promise: safePromise, cancel, id };
    };

    // Increased timeouts to 30 seconds to give more time for API responses
    // Note: Heroku has a 30-second H12 limit, so this is at the edge - requests may still timeout
    // if they exceed 30 seconds due to network latency or processing overhead
    const timeoutWrapper = createTimeoutPromise(30000, 'Request timeout');
    const timeoutPromise = timeoutWrapper.promise;

    const visionTimeoutWrapper = createTimeoutPromise(30000, 'Vision API request timeout');
    const visionTimeoutPromise = visionTimeoutWrapper.promise;

    // Helper function to clear timeouts
    const clearTimeouts = () => {
      timeoutWrapper.cancel();
      visionTimeoutWrapper.cancel();
      timeoutCancelled = true;
      visionTimeoutCancelled = true;
    };

    // If image is provided, analyze it first and enhance the question
    let imageAnalysisData: any = null;
    let imageEnhancedQuestion = question;

    if (imageFilePath || imageUrl) {
      try {
        // Directly use Google Vision API for image analysis (more efficient than API call)
        const { ImageAnnotatorClient } = await import('@google-cloud/vision');
        const credentials = process.env.GOOGLE_CREDENTIALS
          ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
          : null;

        if (credentials) {
          const client = new ImageAnnotatorClient({ credentials });

          // Determine image path - download from URL if needed
          let imagePath: string | null = null;

          if (imageUrl && imageUrl.startsWith('http')) {
            // Download cloud image temporarily for analysis with timeout protection
            try {
              const downloadPromise = fetch(imageUrl);
              const downloadTimeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Image download timeout after 5 seconds')), 5000)
              );

              const response = await Promise.race([downloadPromise, downloadTimeout]);
              if (response.ok) {
                const buffer = await response.arrayBuffer();
                const tempPath = path.join(process.cwd(), 'tmp', 'analysis', `temp-${Date.now()}.jpg`);
                const tempDir = path.dirname(tempPath);
                if (!fs.existsSync(tempDir)) {
                  fs.mkdirSync(tempDir, { recursive: true });
                }
                fs.writeFileSync(tempPath, Buffer.from(buffer));
                imagePath = tempPath;
              }
            } catch (downloadError) {
              console.error('Error downloading image for analysis:', downloadError);
              // Continue without image analysis if download fails
            }
          } else if (imageFilePath) {
            imagePath = path.join(process.cwd(), 'public', imageFilePath);
          }

          if (imagePath && fs.existsSync(imagePath)) {
            // Get labels and text from image
            const [labelResult] = await client.labelDetection(imagePath);
            const [textResult] = await client.textDetection(imagePath);

            // Get all labels with their confidence scores
            const allLabels = (labelResult.labelAnnotations || [])
              .map(l => ({
                description: l?.description || '',
                score: l?.score || 0
              }))
              .filter(l => l.description)
              .sort((a, b) => (b.score || 0) - (a.score || 0)); // Sort by confidence

            // Use top labels by confidence (up to 20 for detailed analysis)
            const topLabels = allLabels.slice(0, 20).map(l => l.description);
            const labels = topLabels.length > 0 ? topLabels :
              (labelResult.labelAnnotations?.map(l => l?.description).filter((desc): desc is string => Boolean(desc)) || []) as string[];

            const detectedText = textResult.textAnnotations?.[0]?.description || '';

            imageAnalysisData = { labels, detectedText, labelCount: labels.length };

            // Extract game title from question and/or image context
            const gameTitle = await extractGameTitleFromImageContext(
              question,
              labels.length > 0 ? labels : undefined,
              detectedText || undefined
            );

            console.log('Image analysis:', {
              topLabels: labels.slice(0, 10),
              textPreview: detectedText.substring(0, 150),
              detectedGameTitle: gameTitle,
              totalLabelsFound: allLabels.length
            });

            // Enhance question with game context and image analysis
            imageEnhancedQuestion = await enhanceQuestionWithGameContext(
              question,
              gameTitle,
              labels,
              detectedText
            );

            // Clean up temp file if it was downloaded
            if (imagePath.startsWith(path.join(process.cwd(), 'tmp'))) {
              try {
                fs.unlinkSync(imagePath);
              } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
              }
            }
          }
        }
      } catch (imageError: any) {
        console.error('Error analyzing image:', imageError);
        // Continue without image analysis if it fails - don't block the question
      }
    }

    // Measure question processing time (use enhanced question if image was analyzed)
    const questionToProcess = imageEnhancedQuestion || question;
    const { result: processedAnswer, latency: processingLatency } = await measureLatency('Question Processing', async () => {
      // Handle recommendation questions - check these BEFORE trying to extract a specific game
      const lowerQuestion = questionToProcess.toLowerCase();

      // Detect "best X games" patterns (e.g., "best platformer games for beginners")
      const isBestGamesQuestion = /best\s+.*?\s+games?\s+(for|right now|currently|to play|that|which)/i.test(questionToProcess) ||
        /what\s+(are|is)\s+the\s+best\s+.*?\s+games?/i.test(questionToProcess) ||
        /recommend.*?\s+(me\s+)?(some|a|the\s+best)\s+.*?\s+games?/i.test(questionToProcess);

      if (isBestGamesQuestion) {
        // Extract genre from question - handle multiple patterns
        let genreText = '';

        // Pattern 1: "best [genre] games" or "the best [genre] games"
        const pattern1 = questionToProcess.match(/(?:the\s+)?best\s+([a-z\s]+?)\s+games?/i);
        if (pattern1 && pattern1[1]) {
          genreText = pattern1[1].toLowerCase().trim();
          // Remove trailing words like "right now", "currently", "for beginners", etc.
          genreText = genreText.replace(/\s+(right\s+now|currently|to\s+play|that|which|for\s+.*?)$/i, '').trim();
        }

        // Pattern 2: "what are the best [genre] games"
        if (!genreText) {
          const pattern2 = questionToProcess.match(/what\s+(are|is)\s+the\s+best\s+([a-z\s]+?)\s+games?/i);
          if (pattern2 && pattern2[2]) {
            genreText = pattern2[2].toLowerCase().trim();
            // Remove trailing words
            genreText = genreText.replace(/\s+(right\s+now|currently|to\s+play|that|which|for\s+.*?)$/i, '').trim();
          }
        }

        let detectedGenre = 'Action-Adventure'; // Default genre

        if (genreText) {
          // Map common genre terms
          const genreMap: { [key: string]: string } = {
            'platformer': 'Platformer',
            'platform': 'Platformer',
            'rpg': 'RPG',
            'role-playing': 'RPG',
            'action': 'Action',
            'adventure': 'Adventure',
            'strategy': 'Strategy',
            'puzzle': 'Puzzle',
            'racing': 'Racing',
            'fighting': 'Fighting',
            'shooter': 'Shooter',
            'fps': 'Shooter',
            'first-person shooter': 'Shooter',
            'horror': 'Horror',
            'simulation': 'Simulation',
            'sports': 'Sports',
            'indie': 'Indie',
            'casual': 'Casual',
            'multiplayer': 'Multiplayer',
            'single-player': 'Single-player',
            'single player': 'Single-player'
          };

          // Check for exact matches first, then partial matches
          for (const [key, value] of Object.entries(genreMap)) {
            if (genreText === key || genreText.includes(key)) {
              detectedGenre = value;
              break;
            }
          }
        }

        // Check if it's asking for beginners
        const isForBeginners = /for\s+beginners?|beginner|new to|starting|first time/i.test(questionToProcess);

        // Check if asking for current/popular games
        const isCurrentPopular = /right now|currently|popular|trending|recent|what.*best.*now/i.test(questionToProcess);

        // Fetch recommendations for the detected genre with appropriate options
        const cacheKey = `recommendations:${detectedGenre}:${isForBeginners ? 'beginners' : isCurrentPopular ? 'current' : 'general'}`;
        const recommendations = await deduplicateRequest(cacheKey, () =>
          fetchRecommendations(detectedGenre, {
            forBeginners: isForBeginners,
            currentPopular: isCurrentPopular,
            userQuery: questionToProcess
          })
        );

        if (recommendations.length > 0) {
          const gameList = deduplicateBySeries(recommendations).slice(0, 5).join(', ');
          if (isForBeginners) {
            return `Here are some great ${detectedGenre.toLowerCase()} games for beginners: ${gameList}. These games are known for being accessible and fun for players new to the genre. Would you like to know more about any of these games?`;
          } else if (isCurrentPopular) {
            return `Here are some of the best ${detectedGenre.toLowerCase()} games right now: ${gameList}. These are currently popular and highly regarded titles in the genre. Would you like more details about any specific game?`;
          } else {
            return `Here are some of the best ${detectedGenre.toLowerCase()} games: ${gameList}. These are highly regarded titles in the genre. Would you like more details about any specific game?`;
          }
        } else {
          return `I'd be happy to recommend some ${detectedGenre.toLowerCase()} games! What aspects are you most interested in - story, gameplay mechanics, or something else?`;
        }
      }

      // Handle "What should I play?" with personalized recommendations based on user history
      if (lowerQuestion.includes("what should i play") || lowerQuestion.includes("what game should i play") || lowerQuestion.includes("recommend me a game")) {
        // Fetch user's question history
        const previousQuestionsRaw = await Question.find({ username })
          .sort({ timestamp: -1 })
          .limit(50)
          .select('question response detectedGame detectedGenre timestamp')
          .lean() as unknown as Array<{
            question: string;
            response: string;
            detectedGame?: string;
            detectedGenre?: string[];
            timestamp: Date;
          }>;

        if (previousQuestionsRaw.length === 0) {
          // No history - give a general recommendation
          const cacheKey = `recommendations:new-user:default`;
          const recommendations = await deduplicateRequest(cacheKey, () => fetchRecommendations('Action-Adventure'));
          return recommendations.length > 0
            ? `Since you're new here, here are some great games to get started: ${deduplicateBySeries(recommendations).slice(0, 3).join(', ')}. Feel free to ask me about any game you're interested in!`
            : "I'd love to help you find a game! What types of games do you enjoy? Action, RPG, strategy, or something else?";
        }

        // Extract games and genres from user's history
        const gamesAskedAbout = previousQuestionsRaw
          .filter(q => q.detectedGame)
          .map(q => q.detectedGame!)
          .filter((game, index, self) => self.indexOf(game) === index) // Remove duplicates
          .slice(0, 10); // Top 10 unique games

        // Map to expected format for analyzeUserQuestions
        const questionsForAnalysis = previousQuestionsRaw.map(q => ({
          question: q.question,
          response: q.response
        }));

        const genres = analyzeUserQuestions(questionsForAnalysis);
        const topGenres = genres.slice(0, 3); // Top 3 genres

        // Build context for AI recommendation
        let contextMessage = `Based on your gaming history, I can see you've asked about ${previousQuestionsRaw.length} games. `;

        if (gamesAskedAbout.length > 0) {
          contextMessage += `You've shown interest in games like: ${gamesAskedAbout.slice(0, 5).join(', ')}. `;
        }

        if (topGenres.length > 0) {
          contextMessage += `Your favorite genres seem to be: ${topGenres.join(', ')}. `;
        }

        contextMessage += `Based on this, what game would you recommend I play next? Please suggest 2-3 specific games with brief reasons why they'd be a good fit for me.`;

        // Use AI to generate personalized recommendation
        const cacheKey = `personalized-recommendation:${username}:${topGenres[0] || 'default'}`;
        const personalizedRecommendation = await deduplicateRequest(cacheKey, async () => {
          return await getChatCompletion(contextMessage);
        });

        return personalizedRecommendation || "Based on your gaming history, I'd recommend exploring games similar to what you've enjoyed before. What genres interest you most?";
      } else if (lowerQuestion.includes("daily gaming tip") || lowerQuestion.includes("daily tip") || lowerQuestion.includes("give me a tip")) {
        // Handle personalized daily gaming tip based on user history
        const Forum = (await import('../../models/Forum')).default;

        // Fetch user's question history
        const previousQuestionsRaw = await Question.find({ username })
          .sort({ timestamp: -1 })
          .limit(30)
          .select('question detectedGame detectedGenre timestamp')
          .lean() as unknown as Array<{
            question: string;
            detectedGame?: string;
            detectedGenre?: string[];
            timestamp: Date;
          }>;

        // Fetch user's forum activity (forums they created or posted in)
        const userForums = await Forum.find({
          $or: [
            { createdBy: username },
            { 'posts.username': username }
          ]
        })
          .select('gameTitle posts')
          .lean() as unknown as Array<{
            gameTitle: string;
            posts: Array<{ username: string; message: string }>;
          }>;

        // Extract games from questions
        const gamesFromQuestions = previousQuestionsRaw
          .filter(q => q.detectedGame)
          .map(q => q.detectedGame!)
          .filter((game, index, self) => self.indexOf(game) === index)
          .slice(0, 5);

        // Extract games from forums
        const gamesFromForums = userForums
          .map(f => f.gameTitle)
          .filter((game, index, self) => self.indexOf(game) === index)
          .slice(0, 5);

        // Combine and deduplicate
        const allGames = Array.from(new Set([...gamesFromQuestions, ...gamesFromForums])).slice(0, 5);

        // Get genres from questions
        const questionsForAnalysis = previousQuestionsRaw.map(q => ({
          question: q.question,
          response: '' // Not needed for genre analysis
        }));
        const genres = analyzeUserQuestions(questionsForAnalysis);
        const topGenres = genres.slice(0, 2);

        // Build personalized tip context
        let tipContext = `Generate a helpful, practical daily gaming tip. `;

        if (allGames.length > 0) {
          tipContext += `The user has been asking about or discussing these games: ${allGames.join(', ')}. `;
        }

        if (topGenres.length > 0) {
          tipContext += `They seem to enjoy ${topGenres.join(' and ')} games. `;
        }

        if (allGames.length === 0 && topGenres.length === 0) {
          tipContext += `The user is new or hasn't asked about specific games yet. `;
        }

        tipContext += `Provide a useful, actionable gaming tip that would be relevant to their interests. Make it specific and practical, not generic. Keep it to 2-3 sentences.`;

        // Generate personalized tip
        const cacheKey = `daily-tip:${username}:${allGames[0] || topGenres[0] || 'default'}`;
        const personalizedTip = await deduplicateRequest(cacheKey, async () => {
          return await getChatCompletion(tipContext);
        });

        return personalizedTip || "Here's a daily gaming tip: Take regular breaks every 45-60 minutes to keep your mind sharp and avoid fatigue. Your performance actually improves when you give yourself time to rest!";
      } else if (questionToProcess.toLowerCase().includes("recommendations")) {
        const previousQuestions = await Question.find({ username });
        const genres = analyzeUserQuestions(previousQuestions);
        const cacheKey = `recommendations:${username}:${genres[0] || 'default'}`;
        const recommendations = genres.length > 0 ? await deduplicateRequest(cacheKey, () => fetchRecommendations(genres[0])) : [];

        return recommendations.length > 0
          ? `Based on your previous questions, I recommend these games: ${deduplicateBySeries(recommendations).slice(0, 5).join(', ')}.`
          : "I couldn't find any recommendations based on your preferences.";

      } else if (questionToProcess.toLowerCase().includes("when was") || questionToProcess.toLowerCase().includes("when did")) {
        // Existing release date logic
        const cacheKey = `chat:${questionToProcess.toLowerCase().trim()}`;
        try {
          const raceResult = await Promise.race([
            deduplicateRequest(cacheKey, () => getChatCompletion(questionToProcess)),
            timeoutPromise
          ]);
          // Cancel timeout IMMEDIATELY after race completes (synchronously)
          timeoutWrapper.cancel();
          const baseAnswer = raceResult as string;

          if (baseAnswer) {
            try {
              return await fetchAndCombineGameData(questionToProcess, baseAnswer);
            } catch (dataError) {
              console.error('Error fetching additional game data:', dataError);
              return baseAnswer;
            }
          }
          throw new Error('Failed to generate response for release date question');
        } catch (error) {
          // Cancel timeout on error too
          timeoutWrapper.cancel();
          throw error;
        }
      } else if (question.toLowerCase().includes("twitch user data")) {
        // Existing Twitch logic
        if (!code) {
          redirectToTwitch(res);
          return null;
        }
        const codeValue = Array.isArray(code) ? code[0] : code;
        const accessTokenCacheKey = `twitch_token:${codeValue}`;
        const accessToken = await deduplicateRequest(accessTokenCacheKey, () => getAccessToken(codeValue));

        const userDataCacheKey = `twitch_user:${accessToken}`;
        const userData = await deduplicateRequest(userDataCacheKey, () => getTwitchUserData(accessToken));
        return `Twitch User Data: ${JSON.stringify(userData)}`;
      } else if (questionToProcess.toLowerCase().includes("genre") &&
        !questionToProcess.toLowerCase().includes("level") &&
        !questionToProcess.toLowerCase().includes("stage") &&
        !questionToProcess.toLowerCase().includes("item")) {
        // Existing genre logic - only if it's actually a genre question
        const gameTitle = extractGameTitle(questionToProcess);
        // Only proceed if we got a valid game title (not empty or just question words)
        if (gameTitle && gameTitle.length > 2 && !gameTitle.toLowerCase().match(/^(what|which|is|the|name|of|in|this|image|from|a|an)$/i)) {
          const genre = getGenreFromMapping(gameTitle);
          return genre
            ? `${gameTitle} is categorized as ${genre}.`
            : `I couldn't find genre information for ${gameTitle}.`;
        }
        // If extractGameTitle failed, fall through to general question handling
      } else {
        // General questions - use OpenAI Vision API if image is provided (ChatGPT-style analysis)
        const cacheKey = `chat:${questionToProcess.toLowerCase().trim()}:${imageUrl || imageFilePath || 'no-image'}`;

        // Create enhanced system message for image-based questions
        let systemMessage: string | undefined;
        const isLevelQuestion = questionToProcess.toLowerCase().includes('level') ||
          questionToProcess.toLowerCase().includes('stage') ||
          questionToProcess.toLowerCase().includes('area') ||
          questionToProcess.toLowerCase().includes('chapter');
        const isItemQuestion = questionToProcess.toLowerCase().includes('item') ||
          questionToProcess.toLowerCase().includes('weapon') ||
          questionToProcess.toLowerCase().includes('equipment');
        const isGameQuestion = questionToProcess.toLowerCase().includes('what game') ||
          questionToProcess.toLowerCase().includes('which game') ||
          questionToProcess.toLowerCase().includes('character') ||
          questionToProcess.toLowerCase().includes('what is this from');

        if (isLevelQuestion || isItemQuestion || isGameQuestion) {
          systemMessage = `You are an expert video game assistant specializing in identifying games, levels, stages, items, and locations from screenshots. When analyzing images:

CRITICAL INSTRUCTIONS:
1. Analyze the SPECIFIC visual features in the image (environment, landmarks, architecture, colors, structures, UI elements, character designs)
2. For level identification: Match the actual visual content to specific levels - if you see a futuristic city with neon lights and a Ferris wheel, identify that specific level (e.g., Eggmanland in Sonic Unleashed)
3. Pay attention to distinctive landmarks, unique structures, color palettes, and environmental features
4. Read any text visible in the image (level names, UI elements, etc.)
5. Cross-reference visual elements with your knowledge of the game's levels
6. Be precise and base your answer on the actual visual content shown, not general patterns
7. If you can identify specific visual features (like "neon pink Eggman face Ferris wheel" or "tall green-lit industrial towers"), use those to pinpoint the exact level`;
        }

        let baseAnswer: string;

        // Use OpenAI Vision API if image is available (ChatGPT-style direct image analysis)
        if (imageUrl || imageFilePath) {
          try {
            // Convert local image to base64 if needed, or use URL
            let imageForVision: string | undefined;

            if (imageUrl && imageUrl.startsWith('http')) {
              // Use URL directly (works for cloud storage)
              imageForVision = imageUrl;
            } else if (imageFilePath) {
              // Convert local file to base64
              const localImagePath = path.join(process.cwd(), 'public', imageFilePath);
              if (fs.existsSync(localImagePath)) {
                const imageBuffer = fs.readFileSync(localImagePath);
                const base64Image = imageBuffer.toString('base64');
                imageForVision = `data:image/jpeg;base64,${base64Image}`;
              }
            }

            if (imageForVision) {
              try {
                const raceResult = await Promise.race([
                  deduplicateRequest(cacheKey, () => getChatCompletionWithVision(
                    questionToProcess,
                    imageForVision?.startsWith('http') ? imageForVision : undefined,
                    imageForVision?.startsWith('data:') ? imageForVision : undefined,
                    systemMessage
                  )),
                  visionTimeoutPromise // Use longer timeout for vision API calls
                ]);
                // Cancel timeout IMMEDIATELY after race completes (synchronously)
                visionTimeoutWrapper.cancel();
                baseAnswer = raceResult as string;
              } catch (error) {
                // Cancel timeout on error too (synchronously)
                visionTimeoutWrapper.cancel();
                // Enhanced error logging for debugging
                console.error('Error in vision API call:', {
                  error: error instanceof Error ? error.message : String(error),
                  question: questionToProcess.substring(0, 100),
                  hasImage: !!imageForVision,
                  stack: error instanceof Error ? error.stack : undefined
                });
                throw error;
              }
            } else {
              // Fallback to text-only if image conversion fails
              try {
                const raceResult = await Promise.race([
                  deduplicateRequest(cacheKey, () => getChatCompletion(questionToProcess, systemMessage)),
                  timeoutPromise
                ]);
                // Cancel timeout IMMEDIATELY after race completes (synchronously)
                timeoutWrapper.cancel();
                baseAnswer = raceResult as string;
              } catch (error) {
                // Cancel timeout on error too (synchronously)
                timeoutWrapper.cancel();
                throw error;
              }
            }
          } catch (visionError) {
            console.error('Error using vision API, falling back to text-only:', visionError);
            // Clear any remaining timeouts
            clearTimeouts();
            // Fallback to text-only API
            try {
              // Create a new timeout for the fallback (30s to match main timeout)
              const fallbackTimeout = createTimeoutPromise(30000, 'Request timeout');
              baseAnswer = await Promise.race([
                deduplicateRequest(cacheKey, () => getChatCompletion(questionToProcess, systemMessage)),
                fallbackTimeout.promise
              ]) as string;
              // Cancel timeout since request completed successfully
              fallbackTimeout.cancel();
            } catch (error) {
              // Cancel timeout on error too
              console.error('Error in fallback text-only API call:', {
                error: error instanceof Error ? error.message : String(error),
                question: questionToProcess.substring(0, 100),
                stack: error instanceof Error ? error.stack : undefined
              });
              throw error;
            }
          }
        } else {
          // No image, use text-only API
          try {
            const raceResult = await Promise.race([
              deduplicateRequest(cacheKey, () => getChatCompletion(questionToProcess, systemMessage)),
              timeoutPromise
            ]);
            // Cancel timeout IMMEDIATELY after race completes (synchronously)
            timeoutWrapper.cancel();
            baseAnswer = raceResult as string;
          } catch (error) {
            // Cancel timeout on error too (synchronously)
            timeoutWrapper.cancel();
            // Enhanced error logging for debugging
            console.error('Error in text-only API call:', {
              error: error instanceof Error ? error.message : String(error),
              question: questionToProcess.substring(0, 100),
              stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
          }
        }

        if (!baseAnswer) {
          // Enhanced error message for failed response generation
          const errorDetails = {
            question: questionToProcess.substring(0, 100),
            hasImage: !!(imageUrl || imageFilePath),
            timestamp: new Date().toISOString()
          };
          console.error('Failed to generate response from AI:', errorDetails);
          throw new AssistantError(
            'Unable to generate a response. The AI service may be temporarily unavailable. Please try again in a moment.',
            503 // Service Unavailable
          );
        }

        try {
          return await fetchAndCombineGameData(questionToProcess, baseAnswer);
        } catch (dataError) {
          console.error('Error fetching additional data:', dataError);
          return baseAnswer;
        }
      }
    });

    answer = processedAnswer;
    metrics.questionProcessing = processingLatency;

    // Measure database operations with enhanced metrics
    const dbMetrics = await measureDBQuery('Create Question', async () => {
      try {
        // Start a session for transaction
        const session = await mongoose.startSession();
        let result;

        try {
          await session.withTransaction(async () => {
            // Create question with proper username handling
            // Include imageUrl if provided (use imageUrl from cloud storage, fallback to imageFilePath)
            const questionImageUrl = imageUrl || (imageFilePath ? `/uploads/question-images/${path.basename(imageFilePath)}` : undefined);
            const questionData = {
              username: username || 'anonymous',
              question,
              response: answer,
              imageUrl: questionImageUrl // Save image URL with the question
            };
            const questionDoc = await Question.create([questionData], { session });

            // Record question usage for free users
            if (user) {
              user.recordQuestionUsage();
              // Update daily streak
              user.updateStreak();
              await user.save({ session });
            }

            // Check question type first to prepare bulk update operations
            const questionType = await checkQuestionType(question);
            // console.log('Question type detected:', questionType); // Debug log - commented out for production

            // Check if user exists first to determine update strategy
            const existingUser = await User.findOne({ username }).session(session);

            if (existingUser) {
              // User exists - use $inc for progress fields
              const updateOperations: any = {
                $inc: { conversationCount: 1 }
              };

              // Add genre increments in bulk
              if (questionType.length > 0) {
                questionType.forEach(genre => {
                  updateOperations.$inc[`progress.${genre}`] = 1;
                });
              }

              // Single database operation for existing user
              const userDoc = await User.findOneAndUpdate(
                { username },
                updateOperations,
                { new: true, session }
              );

              result = { questionDoc, userDoc };
            } else {
              // User doesn't exist - create with initial structure
              const initialProgress = {
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
              };

              // Add genre increments to initial progress
              if (questionType.length > 0) {
                questionType.forEach(genre => {
                  if (genre in initialProgress) {
                    (initialProgress as any)[genre] = 1;
                  }
                });
              }

              // Create new user with initial data
              const userDoc = await User.create([{
                userId: `user_${Date.now()}`, // Generate a unique userId
                username,
                email: `${username}@placeholder.com`, // Provide a placeholder email
                conversationCount: 1,
                achievements: [],
                progress: initialProgress
              }], { session });

              result = { questionDoc, userDoc: userDoc[0] };
            }

            // Check achievements only once with the updated progress
            if (result.userDoc && questionType.length > 0 && username) {
              await checkAndAwardAchievements(username, result.userDoc.progress, session);
            }
          });

          await session.endSession();
          return result;
        } catch (error) {
          await session.endSession();
          console.error('Transaction error:', error);
          throw new Error(`Database operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Database operation error:', error);
        throw error;
      }
    });
    metrics.databaseMetrics = dbMetrics;

    // Clear conversation cache for this user to ensure fresh data on next fetch
    if (username) {
      clearUserCache(username);
    }

    // Extract question ID for metadata analysis (runs asynchronously after response)
    // questionDoc is an array returned from Question.create
    const questionId = dbMetrics.result?.questionDoc?.[0]?._id?.toString();

    // Measure final memory usage
    metrics.finalMemory = measureMemoryUsage();

    // Add cache metrics to response
    metrics.aiCacheMetrics = aiCache.getMetrics();

    // Measure response size
    const responseData = { answer, metrics };
    metrics.responseSize = measureResponseSize(responseData);

    // Add request rate
    metrics.requestRate = requestMonitor.getRequestRate();

    // Log performance metrics
    const endTime = performance.now();
    metrics.totalTime = endTime - startTime;
    logger.info('API request completed', {
      username,
      questionLength: question.length,
      metrics
    });

    // Phase 2 Step 1: Question Metadata Analysis
    // Extract and update question metadata asynchronously after response is sent
    // This runs in the background and doesn't affect user experience
    if (questionId) {
      // console.log('[Background Metadata] Scheduling metadata extraction for question ID:', questionId);
      setImmediate(async () => {
        try {
          // console.log('[Background Metadata] Starting background metadata extraction...');
          // Extract metadata using the existing checkQuestionType function
          const metadata = await extractQuestionMetadata(question, checkQuestionType);

          // Update the question document with metadata
          await updateQuestionMetadata(questionId, metadata);
          // console.log('[Background Metadata] Background metadata extraction completed successfully');
        } catch (error) {
          // Log error but don't throw - this is a background operation
          console.error('[Background Metadata] Error in background metadata extraction:', error);
        }
      });
    } else {
      // console.log('[Background Metadata] No question ID available, skipping metadata extraction');
    }

    // Phase 2 Step 2: Pattern Analysis
    // Analyze gameplay patterns asynchronously after response is sent
    // This runs in the background and doesn't affect user experience
    // Phase 4.3: Rate Limiting - Only run if enough time has passed since last analysis
    if (username) {
      const authenticatedUsername = username; // Type narrowing for async callback
      setImmediate(async () => {
        try {
          // Phase 4.3: Check if analysis should run (rate limiting)
          const shouldRun = await shouldRunAnalysis(authenticatedUsername);

          if (!shouldRun) {
            // Skip analysis if rate limit hasn't been reached
            // Note: This does NOT affect the user's question - it only skips optional background pattern analysis
            console.log(`[Pattern Analysis] Skipping optional background analysis for ${authenticatedUsername} (rate limit: once per 3 hours) - question was already answered successfully`);
            return;
          }

          // Phase 4.1: Run pattern analysis with caching (getOrCalculatePatterns handles caching internally)
          // This will use cached results if available, or calculate and cache new results
          const patterns = await analyzeGameplayPatterns(authenticatedUsername);

          // Log patterns for debugging (commented out for production)
          // console.log('[Pattern Analysis] Completed pattern analysis for user:', authenticatedUsername);
          // console.log('[Pattern Analysis] Results:', JSON.stringify(patterns, null, 2));

          // Store patterns in User model for future use in recommendations
          // Only store if we have meaningful data (at least some questions analyzed)
          if (patterns.frequency.totalQuestions > 0) {
            await storeUserPatterns(authenticatedUsername, patterns);
          }
        } catch (error) {
          // Log error but don't throw - this is a background operation
          console.error('[Pattern Analysis] Error in background pattern analysis:', error);
        }
      });
    }

    // Phase 3 Step 3: Generate Personalized Recommendations
    // Generate recommendations in background after response is sent
    // Recommendations respect progressive disclosure and are stored for later retrieval
    // This doesn't block the user's response
    if (username) {
      const authenticatedUsername = username; // Type narrowing for async callback
      setImmediate(async () => {
        try {
          // Generate recommendations with current question as context
          // Don't force show - respect progressive disclosure
          await generatePersonalizedRecommendations(authenticatedUsername, question, false);

          // Note: updateRecommendationHistory is called inside generatePersonalizedRecommendations
          // if recommendations are actually shown (progressive disclosure passed)
        } catch (error) {
          // Log error but don't throw - this is a background operation
          console.error('[Recommendations] Error generating recommendations:', error);
        }
      });
    }

    // Return just the base answer
    // Recommendations are generated in background and can be fetched separately
    return res.status(200).json({
      answer: answer,
      metrics,
      // Include a flag to indicate recommendations may be available
      recommendationsAvailable: !!username
    });

  } catch (error) {
    console.error("Error in API route:", error);
    const endTime = performance.now();
    metrics.totalTime = endTime - startTime;
    metrics.aiCacheMetrics = aiCache.getMetrics();

    // Check if this is a timeout error
    const isTimeoutError = error instanceof Error && (
      error.message.includes('timeout') ||
      error.message.includes('Request timeout') ||
      error.message.includes('Vision API request timeout') ||
      error.message.includes('ECONNABORTED') ||
      error.message.includes('ETIMEDOUT')
    );

    // Enhanced error logging
    logger.error('API request failed', {
      username: username || 'unknown',
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        isTimeout: isTimeoutError
      } : 'Unknown error',
      metrics,
      requestDuration: metrics.totalTime
    });

    if (error instanceof AssistantError) {
      res.status(error.statusCode).json({
        error: error.message,
        details: 'An error occurred while processing your request',
        metrics
      });
    } else if (isTimeoutError) {
      // Special handling for timeout errors
      res.status(504).json({
        error: "Request Timeout",
        details: 'The request took too long to process. This may happen with complex questions or when the AI service is slow. Please try again with a simpler question or wait a moment.',
        metrics,
        timeout: true
      });
    } else {
      res.status(500).json({
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : 'An unexpected error occurred',
        metrics,
        // Include error type in development for debugging
        ...(process.env.NODE_ENV === 'development' && error instanceof Error ? {
          errorType: error.name,
          errorStack: error.stack
        } : {})
      });
    }
  }
};

// Apply request size limiting middleware to prevent DoS attacks
export default withRequestSizeLimit(assistantHandler);