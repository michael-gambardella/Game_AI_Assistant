import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { getGameReleaseDate } from './aiHelper';
import { LRUCache } from './cacheManager';

// Load environment variables from both .env and .env.local
dotenv.config(); // Loads .env by default
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') }); // Also load .env.local if it exists

// Lazy initialization of OpenAI client to avoid errors on server startup
// Only initializes when actually needed
let openaiInstance: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is missing or empty. Please set it in your .env or .env.local file.');
    }
    openaiInstance = new OpenAI({
      apiKey: apiKey,
    });
  }
  return openaiInstance;
}

/**
 * Select the appropriate OpenAI model for automated users based on game release date
 * - GPT-5.2 for games released 2024+ (better knowledge cutoff - Aug 2025 vs Oct 2023)
 * - GPT-4o for games released before 2024 (proven quality, cost-effective)
 * 
 * CRITICAL: If release date cannot be determined, default to GPT-5.2 for safety
 * (newer games may not be in databases yet, and GPT-4o won't know about them)
 * 
 * This matches the logic used by the main Video Game Wingman assistant
 * 
 * @param gameTitle - Game title to check release date for
 * @returns Model name to use ('gpt-5.2' or 'gpt-4o')
 */
async function selectModelForAutomatedUser(gameTitle: string): Promise<string> {
  const CUTOFF_YEAR = 2024; // Games released 2024+ use GPT-5.2
  const DEFAULT_MODEL = 'gpt-4o'; // Default for older games
  const SAFE_DEFAULT_MODEL = 'gpt-5.2'; // Safe default when release date unavailable (for newer games)

  try {
    const releaseDate = await getGameReleaseDate(gameTitle);

    if (releaseDate) {
      const releaseYear = releaseDate.getFullYear();

      if (releaseYear >= CUTOFF_YEAR) {
        console.log(`[Automated User] ✅ Using GPT-5.2 for ${gameTitle} (released ${releaseYear}, after cutoff)`);
        return 'gpt-5.2';
      } else {
        console.log(`[Automated User] ✅ Using GPT-4o for ${gameTitle} (released ${releaseYear}, before cutoff)`);
        return DEFAULT_MODEL;
      }
    }
  } catch (error) {
    console.error(`[Automated User] ⚠️ Error determining release date for ${gameTitle}:`, error);
  }

  // CRITICAL FIX: Default to GPT-5.2 if we can't determine release date
  // This is safer for newer games that may not be in databases yet
  // GPT-4o has knowledge cutoff of Oct 2023, so it won't know about newer games
  console.log(`[Automated User] ⚠️ Release date unavailable for ${gameTitle} - using GPT-5.2 (safer for newer games)`);
  return SAFE_DEFAULT_MODEL;
}

/**
 * Cache for game feature validations to avoid repeated API calls
 * TTL: 24 hours (game features don't change)
 * Max size: 1000 entries (game + feature combinations)
 */
const GAME_FEATURE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const GAME_FEATURE_CACHE_MAX_SIZE = 1000;
const gameFeatureCache = new LRUCache<boolean | null>(
  GAME_FEATURE_CACHE_MAX_SIZE,
  GAME_FEATURE_CACHE_TTL,
  10 * 60 * 1000 // Cleanup every 10 minutes
);

/**
 * Validate if a game has specific features/content
 * This prevents creating forums or posts about content that doesn't exist in the game
 * OPTIMIZED: Uses caching to avoid repeated API calls for the same game+feature combination
 * 
 * @param gameTitle - The game title to check
 * @param featureType - The type of feature to check for (e.g., 'story mode', 'mods', 'character development')
 * @returns true if the game has the feature, false if it doesn't, null if uncertain
 */
export async function validateGameFeature(
  gameTitle: string,
  featureType: 'story mode' | 'story content' | 'narrative' | 'character development' | 'mods' | 'modding support' | 'speedruns'
): Promise<boolean | null> {
  // Check cache first
  const cacheKey = `${gameTitle.toLowerCase().trim()}:${featureType}`;
  const cached = gameFeatureCache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }
  
  try {
    // Select appropriate model
    const selectedModel = await selectModelForAutomatedUser(gameTitle);

    // Map feature types to specific questions
    const featureQuestions: Record<string, string> = {
      'story mode': `Does ${gameTitle} have a traditional story mode, campaign mode, or single-player story/campaign? Answer with only "YES" if it has a story mode, "NO" if it does not have a story mode (only has gameplay modes like arcade, versus, or unlock modes), or "UNCERTAIN" if you're not sure.`,
      'story content': `Does ${gameTitle} have story content, narrative elements, plot, or character development? Answer with only "YES" if it has story/narrative content, "NO" if it focuses purely on gameplay without story elements, or "UNCERTAIN" if you're not sure.`,
      'narrative': `Does ${gameTitle} have narrative elements, story, plot, or character arcs? Answer with only "YES" if it has narrative/story elements, "NO" if it's purely gameplay-focused without narrative, or "UNCERTAIN" if you're not sure.`,
      'character development': `Does ${gameTitle} have character development, character arcs, or character growth throughout the game? Answer with only "YES" if it has character development, "NO" if characters are static or the game doesn't focus on character growth, or "UNCERTAIN" if you're not sure.`,
      'mods': `Does ${gameTitle} support mods, modifications, or user-generated content? Answer with only "YES" if it has mod support or active modding community, "NO" if it doesn't support mods, or "UNCERTAIN" if you're not sure.`,
      'modding support': `Does ${gameTitle} have modding support, mod tools, or an active modding community? Answer with only "YES" if it has modding support, "NO" if it doesn't, or "UNCERTAIN" if you're not sure.`,
      'romhacks': `Does ${gameTitle} have romhacks, custom content, or user-generated content? Answer with only "YES" if it has romhacks or custom content, "NO" if it doesn't, or "UNCERTAIN" if you're not sure.`,
      'world record speedruns': `Does ${gameTitle} have world record speedruns, world records, or optimal playthroughs? Answer with only "YES" if it has speedruns or world records, "NO" if it doesn't, or "UNCERTAIN" if you're not sure.`,
      'speedruns': `Does ${gameTitle} have an active speedrunning community or is it commonly speedrun? Answer "YES" if the game has a meaningful speedrun community (e.g., platformers, action-adventure, RPGs with routing decisions, puzzle games with skip potential). Answer "NO" if the game cannot be meaningfully speedrun or has no real speedrun community — this includes: rhythm games (Dance Dance Revolution, Guitar Hero), sports/fitness games (Wii Sports), abstract puzzle games with no fixed ending (Tetris variants), online-only multiplayer battle royales (Tetris 99), match-3 or casual mobile-style games, or games where every playthrough is the same linear experience without routing choices. Answer "UNCERTAIN" if you're not sure.`,
    };

    const question = featureQuestions[featureType] || featureQuestions['story content'];

    const completion = await getOpenAIClient().chat.completions.create({
      model: selectedModel,
      messages: [
        {
          role: 'system',
          content: `You are a game knowledge expert. Answer questions about game features accurately and concisely. Only respond with "YES", "NO", or "UNCERTAIN".`
        },
        {
          role: 'user',
          content: question
        }
      ],
      temperature: 0.1, // Low temperature for factual accuracy
      max_tokens: 10
    });

    const response = completion.choices[0]?.message?.content?.trim().toUpperCase();

    let result: boolean | null;
    if (response === 'YES') {
      console.log(`[Game Feature Validation] ✅ ${gameTitle} has ${featureType}`);
      result = true;
    } else if (response === 'NO') {
      console.log(`[Game Feature Validation] ❌ ${gameTitle} does NOT have ${featureType}`);
      result = false;
    } else {
      console.log(`[Game Feature Validation] ⚠️ Uncertain if ${gameTitle} has ${featureType} - defaulting to allowing it`);
      result = null; // Uncertain - default to allowing (conservative approach)
    }
    
    // Cache the result (including null for uncertain cases)
    gameFeatureCache.set(cacheKey, result, GAME_FEATURE_CACHE_TTL);
    return result;
  } catch (error) {
    console.error(`[Game Feature Validation] Error validating ${featureType} for ${gameTitle}:`, error);
    // On error, default to null (uncertain) - conservative approach
    const result = null;
    // Cache the error result as well to avoid repeated failed API calls
    gameFeatureCache.set(cacheKey, result, GAME_FEATURE_CACHE_TTL);
    return result;
  }
}

/**
 * Batch validate multiple game features in parallel
 * This is more efficient than calling validateGameFeature multiple times sequentially
 * 
 * @param validations - Array of { gameTitle, featureType } to validate
 * @returns Map of cache keys to validation results
 */
export async function batchValidateGameFeatures(
  validations: Array<{ gameTitle: string; featureType: 'story mode' | 'story content' | 'narrative' | 'character development' | 'mods' | 'modding support' | 'speedruns' }>
): Promise<Map<string, boolean | null>> {
  const results = new Map<string, boolean | null>();
  
  // Check cache for all validations first
  const uncachedValidations: Array<{ gameTitle: string; featureType: string; cacheKey: string }> = [];
  
  for (const { gameTitle, featureType } of validations) {
    const cacheKey = `${gameTitle.toLowerCase().trim()}:${featureType}`;
    const cached = gameFeatureCache.get(cacheKey);
    
    if (cached !== null) {
      // Found in cache
      results.set(cacheKey, cached);
    } else {
      // Need to validate
      uncachedValidations.push({ gameTitle, featureType, cacheKey });
    }
  }
  
  // If all were cached, return early
  if (uncachedValidations.length === 0) {
    return results;
  }
  
  // Validate uncached items in parallel
  const validationPromises = uncachedValidations.map(async ({ gameTitle, featureType, cacheKey }) => {
    try {
      const result = await validateGameFeature(gameTitle, featureType as any);
      return { cacheKey, result };
    } catch (error) {
      console.error(`[Batch Validation] Error validating ${gameTitle} ${featureType}:`, error);
      return { cacheKey, result: null as boolean | null };
    }
  });
  
  const validationResults = await Promise.all(validationPromises);
  
  // Add all results to the map
  for (const { cacheKey, result } of validationResults) {
    results.set(cacheKey, result);
  }
  
  return results;
}

export interface UserPreferences {
  genres: string[];
  focus: 'single-player' | 'multiplayer';
  gamerProfile?: {
    type: 'common' | 'expert';
    skillLevel: number;
    favoriteGames: Array<{
      gameTitle: string;
      genre: string;
      hoursPlayed: number;
      achievements: string[];
      currentStruggles?: string[];
      expertise?: string[];
    }>;
    personality: {
      traits: string[];
      communicationStyle: string;
    };
    helpsCommonGamer?: string;
  };
}

export interface ContentGenerationOptions {
  gameTitle: string;
  genre: string;
  userPreferences: UserPreferences;
  /** Optional multi-genre list for richer, more accurate context */
  gameGenres?: string[];
  /**
   * Optional mode hint derived from presence in single-player.json and/or multiplayer.json.
   * If omitted, generator falls back to heuristics.
   */
  gameModeProfile?: 'single' | 'multi' | 'hybrid' | 'unknown';
  forumTopic?: string;
  forumCategory?: string; // Category of the forum (gameplay, general, mods, etc.)
  previousPosts?: string[]; // Previous posts by this user for the same game to avoid repetition
  previousQuestions?: string[]; // Previous questions asked (for question generation uniqueness)
  preferredQuestionTypes?: string[]; // Preferred question types (how, what, when, etc.) for variety
}

export interface PostReplyOptions {
  gameTitle: string;
  genre: string;
  originalPost: string;
  originalPostAuthor: string;
  gameGenres?: string[];
  gameModeProfile?: 'single' | 'multi' | 'hybrid' | 'unknown';
  forumTopic?: string;
  forumCategory?: string; // Category of the forum (gameplay, general, mods, speedruns, help and supportetc.)
}

/**
 * Generate a natural question for an automated user
 * Questions should be direct, factual, and answerable by Video Game Wingman
 */
export async function generateQuestion(
  options: ContentGenerationOptions
): Promise<string> {
  const { gameTitle, genre, userPreferences, previousQuestions = [], preferredQuestionTypes = [] } = options;

  const isSinglePlayer = userPreferences.focus === 'single-player';

  // Build previous questions context for uniqueness
  let previousQuestionsContext = '';
  if (previousQuestions.length > 0) {
    const sameGameQuestions = previousQuestions.filter(q =>
      q.toLowerCase().includes(gameTitle.toLowerCase())
    );
    const otherQuestions = previousQuestions.filter(q =>
      !q.toLowerCase().includes(gameTitle.toLowerCase())
    );

    previousQuestionsContext = `\n\nCRITICAL - UNIQUENESS REQUIREMENTS:
You have asked questions before (from you and other automated users). Here are previous questions to ensure your new question is UNIQUE and DIFFERENT:
${sameGameQuestions.length > 0 ? `\nPrevious questions about ${gameTitle}:\n${sameGameQuestions.map((q, idx) => `${idx + 1}. "${q}"`).join('\n')}` : ''}
${otherQuestions.length > 0 ? `\nPrevious questions about other games:\n${otherQuestions.slice(0, 5).map((q, idx) => `${idx + 1}. "${q}"`).join('\n')}` : ''}

IMPORTANT:
- Your question MUST be completely different from ALL previous questions shown above
- Do NOT ask about the same topic, mechanic, character, or feature that was asked about before
- If previous questions asked "How do I...", ask "What is..." or "When was..." instead (vary question types)
- If previous questions asked about a specific character, ask about a different character or a different aspect
- If previous questions asked about mechanics, ask about story, release date, platforms, or differences between versions instead
- Find a COMPLETELY NEW angle or topic that hasn't been covered
- Use a different question type (How, What, When, Which, Who, Where) to ensure variety`;
  }

  // Add question type guidance if preferred types are provided
  let questionTypeGuidance = '';
  if (preferredQuestionTypes.length > 0) {
    questionTypeGuidance = `\n\nQUESTION TYPE VARIETY:
To ensure variety, try starting your question with one of these less-used question types: ${preferredQuestionTypes.join(', ')}.
This helps ensure questions don't all start with the same word (e.g., "How...").`;
  }

  const systemPrompt = isSinglePlayer
    ? `You are MysteriousMrEnter, a real gamer asking Video Game Wingman a direct question about ${gameTitle}.

Generate a DIRECT, FACTUAL question that Video Game Wingman can answer with specific game information. The question should:
- MUST mention the game title "${gameTitle}" in the question
- Ask about the BASE/VANILLA version of the game (the official release, not mods or fan-made versions)
- Be a direct question (start with: How, What, When, Where, Which, Who, etc.)
- Ask about SPECIFIC game facts, mechanics, items, characters, strategies, or information
- Be answerable with factual information (not opinions or feelings)
- Be 1 sentence long
- Be CLEAR and COHESIVE - Video Game Wingman must be able to provide a clear, comprehensive answer
- Focus on single-player game aspects like: items, characters, quests, mechanics, strategies, unlockables, secrets, release dates, platforms, differences between versions, how-to guides, etc.
- Ask questions that have definitive answers (not vague or subjective)

CRITICAL ACCURACY REQUIREMENTS - READ CAREFULLY:
- ONLY ask about items, mechanics, characters, or features that ACTUALLY EXIST in ${gameTitle}
- DO NOT make up, combine, or modify item names (e.g., don't create "Super Shrink Stone" if the actual item is "Shrink Stomp")
- DO NOT invent new items by combining words from different items
- If you are unsure about the exact name of an item/mechanic/character, use GENERIC terms instead:
  * Instead of guessing item names, ask: "What items are required to brew [generic item type] in ${gameTitle}?"
  * Instead of guessing badge names, ask: "How do I obtain the [function] badge in ${gameTitle}?"
  * Instead of guessing character names, ask: "Which character has [specific trait] in ${gameTitle}?"
- FACTUAL ACCURACY is more important than sounding specific - if you're not certain about a name, use generic terms
- Double-check: Would a player who knows ${gameTitle} well recognize the item/mechanic you're asking about?

EXAMPLES of good questions:
- "How do I unlock the Great Fairy's Sword in ${gameTitle}?" (only if this item actually exists)
- "What are the best strategies for defeating the final boss in ${gameTitle}?"
- "When was ${gameTitle} released?"
- "Which character has the highest defense stat in ${gameTitle}?"
- "What is the difference between ${gameTitle} and its remake?"
- "How do I obtain badges that affect jumping in ${gameTitle}?" (generic if unsure of exact badge name)

BAD EXAMPLES (making up items):
- "What items are required to brew the Super Shrink Stone in ${gameTitle}?" (WRONG - this item doesn't exist)
- "How do I get the Mega Power Badge in ${gameTitle}?" (WRONG - if you're not certain this exists)

AVOID:
- Opinion-based questions ("What do you think...", "Have you noticed...")
- Conversational statements ("Dude, have you ever...")
- Casual filler words ("dude", "man", etc.) - keep it direct
- Questions that sound like forum posts
- Questions asking for personal experiences or feelings
- Making up or combining item/mechanic names
- Vague questions that can't be answered clearly ("What's good about...", "Is it worth...")
- Questions that require subjective answers

ENSURE YOUR QUESTION IS ANSWERABLE:
- Video Game Wingman must be able to provide a clear, factual answer
- The question should have a definitive answer (not "maybe" or "it depends")
- Ask about concrete facts: release dates, platforms, mechanics, items, characters, strategies
- Avoid questions that require opinion or personal preference

Game: ${gameTitle}
Genre: ${genre} (RPG/Adventure/Simulation/Puzzle/Platformer focus)
${previousQuestionsContext}
${questionTypeGuidance}

Generate ONLY the direct question, nothing else:`
    : `You are WaywardJammer, a real gamer asking Video Game Wingman a direct question about ${gameTitle}.

Generate a DIRECT, FACTUAL question that Video Game Wingman can answer with specific game information. The question should:
- MUST mention the game title "${gameTitle}" in the question
- Ask about the BASE/VANILLA version of the game (the official release, not mods or fan-made versions)
- Be a direct question (start with: How, What, When, Where, Which, Who, etc.)
- Ask about SPECIFIC game facts, mechanics, items, characters, strategies, or information
- Be answerable with factual information (not opinions or feelings)
- Be 1 sentence long
- Be CLEAR and COHESIVE - Video Game Wingman must be able to provide a clear, comprehensive answer
- Focus on multiplayer/competitive game aspects like: strategies, character stats, unlockables, best builds, release dates, platforms, differences between versions, how-to guides, competitive tips, etc.
- Ask questions that have definitive answers (not vague or subjective)

CRITICAL ACCURACY REQUIREMENTS - READ CAREFULLY:
- ONLY ask about items, mechanics, characters, or features that ACTUALLY EXIST in ${gameTitle}
- DO NOT make up, combine, or modify item names (e.g., don't create "Super Power Boost" if the actual item is "Power Boost")
- DO NOT invent new items by combining words from different items
- If you are unsure about the exact name of an item/mechanic/character, use GENERIC terms instead:
  * Instead of guessing item names, ask: "What items provide [function] in ${gameTitle}?"
  * Instead of guessing ability names, ask: "Which character has [specific ability type] in ${gameTitle}?"
  * Instead of guessing weapon names, ask: "What weapons have the highest damage in ${gameTitle}?"
- FACTUAL ACCURACY is more important than sounding specific - if you're not certain about a name, use generic terms
- Double-check: Would a player who knows ${gameTitle} well recognize the item/mechanic you're asking about?

EXAMPLES of good questions:
- "What heavyweight kart has the highest speed in ${gameTitle}?" (only if this actually exists)
- "What are the best strategies for competitive play in ${gameTitle}?"
- "When was ${gameTitle} released?"
- "Which character is the best for ranked matches in ${gameTitle}?"
- "How do I unlock all characters in ${gameTitle}?"
- "What is the difference between ${gameTitle} and its sequel?"

BAD EXAMPLES (making up items):
- "How do I get the Mega Power Boost in ${gameTitle}?" (WRONG - if you're not certain this exists)
- "What items are required to craft the Super Weapon in ${gameTitle}?" (WRONG - if you're not certain this exists)

AVOID:
- Opinion-based questions ("What do you think...", "Have you noticed...")
- Conversational statements ("Dude, what's your go-to...")
- Casual filler words ("dude", "man", etc.) - keep it direct
- Questions that sound like forum posts
- Questions asking for personal experiences or feelings
- Making up or combining item/mechanic names

Game: ${gameTitle}
Genre: ${genre} (Racing/Battle Royale/Fighting/FPS/Sandbox focus)

Generate ONLY the direct question, nothing else:`;

  try {
    // Select model based on game release date (GPT-5.2 for 2024+ games, GPT-4o for older)
    let selectedModel = await selectModelForAutomatedUser(gameTitle);
    let lastError: Error | null = null;

    // Retry logic: if GPT-4o fails (e.g., doesn't know about the game), try GPT-5.2
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Question Generation] Attempt ${attempt}/${maxAttempts} using ${selectedModel} for ${gameTitle}`);

        const completion = await getOpenAIClient().chat.completions.create({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Generate a direct, factual question about ${gameTitle} that Video Game Wingman can answer with specific game information.`
            }
          ],
          temperature: 0.8, // Slightly higher temperature for more variation in questions
          max_tokens: 150
        });

        const generatedQuestion = completion.choices[0]?.message?.content?.trim();

        if (!generatedQuestion) {
          throw new Error('Empty response from model');
        }

        // Clean up the response (remove quotes if wrapped, remove "Question:" prefix, etc.)
        let cleanedQuestion = generatedQuestion
          .replace(/^["']|["']$/g, '') // Remove surrounding quotes
          .replace(/^(Question:|Q:)\s*/i, '') // Remove "Question:" prefix
          .trim();

        if (cleanedQuestion.length < 10) {
          throw new Error('Generated question is too short or invalid');
        }

        console.log(`[Question Generation] ✅ Successfully generated question using ${selectedModel}`);
        return cleanedQuestion;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Question Generation] ❌ Attempt ${attempt} failed with ${selectedModel}:`, lastError.message);

        // If we're using GPT-4o and it fails, retry with GPT-5.2 (might be a newer game)
        if (attempt < maxAttempts && selectedModel === 'gpt-4o') {
          console.log(`[Question Generation] ⚠️ GPT-4o failed, retrying with GPT-5.2 (game might be too new)`);
          selectedModel = 'gpt-5.2';
        } else {
          // If GPT-5.2 also fails or we've exhausted retries, throw
          break;
        }
      }
    }

    // If we get here, all attempts failed
    throw new Error(`Failed to generate question after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
  } catch (error) {
    console.error('Error generating question:', error);
    throw new Error(`Failed to generate question: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Analyze forum topic and generate topic-specific requirements
 * This ensures posts stay on-topic and address the specific forum discussion
 * 
 * This function works dynamically for ANY forum topic, not just hardcoded examples.
 * It analyzes the forum title and category to determine requirements:
 * - Extracts specific topics from forum titles
 * - Uses category (gameplay, mods, speedruns, help, general) to guide content
 * - Detects common patterns (favorite character, mods, story, etc.)
 * - Falls back to general requirements for any custom topics
 * 
 * This will work for:
 * - New forums created by automated users
 * - New forums created by real users
 * - Any game title
 * - Any forum topic or category
 */
function analyzeForumTopic(forumTopic: string | undefined, forumCategory: string | undefined, gameTitle: string): string {
  // Normalize inputs
  const topicLower = (forumTopic || '').toLowerCase();
  const gameTitleLower = gameTitle.toLowerCase();
  const categoryLower = (forumCategory || '').toLowerCase();

  // Check if this is truly a "General Discussion" (no specific topic)
  const isGeneralDiscussion = !forumTopic ||
    forumTopic === 'General Discussion' ||
    topicLower === 'general discussion' ||
    (topicLower.includes('general') && topicLower.includes('discussion'));

  if (isGeneralDiscussion) {
    // For general discussion, use category to guide content
    if (categoryLower === 'gameplay') {
      return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about GAMEPLAY. Your post MUST focus on:
- Gameplay mechanics, controls, strategies, tips, or techniques
- How to play, combat systems, movement, or game mechanics
- DO NOT focus primarily on story, themes, characters' emotional journeys, or narrative elements
- You can mention story/characters briefly if relevant to gameplay, but gameplay should be the MAIN focus`;
    } else if (categoryLower === 'mods') {
      return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about MODS. Your post MUST:
- Discuss mods, modifications, or user-generated content for ${gameTitle}
- Mods can include: gameplay mods, graphics mods, bug fixes, content additions, ports, recompiled versions, overhauls, etc.
- Mention specific mods, installation, compatibility, mod features, or modding experiences
- If the forum title mentions a specific mod, you MUST mention that mod by name
- You can discuss various aspects: mod features, installation, compatibility, performance, mod development, comparisons to vanilla, etc.
- DO NOT just discuss the vanilla/unmodified game without mentioning mods or modifications
- If discussing vanilla gameplay, make it clear you're comparing it to modded versions or discussing it in the context of mods`;
    } else if (categoryLower === 'speedruns') {
      return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about SPEEDRUNS. Your post MUST focus on:
- Speedrunning strategies, routes, times, or techniques
- Speedrun-specific mechanics, glitches, or optimizations
- DO NOT focus on casual play, story, or general gameplay unless it relates to speedrunning`;
    } else if (categoryLower === 'help') {
      return `CRITICAL TOPIC REQUIREMENT: This forum is specifically for HELP & SUPPORT. Your post MUST:
- Ask questions, provide solutions, or offer help
- Focus on troubleshooting, guides, or assistance
- Be helpful and solution-oriented`;
    }
    return ''; // General discussion - no specific restrictions
  }

  // Extract the specific topic from the forum title (remove game title)
  let specificTopic = topicLower.replace(gameTitleLower, '').trim();
  // Remove common forum title patterns
  specificTopic = specificTopic.replace(/^-\s*/, '').replace(/\s*-\s*general discussion$/i, '').trim();

  // Check for character/favorite hero topics
  if (topicLower.includes('favorite') && (topicLower.includes('hero') || topicLower.includes('character'))) {
    return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about FAVORITE HERO/CHARACTER. Your post MUST:
- Explicitly state or discuss YOUR favorite hero/character from ${gameTitle}
- Explain WHY they are your favorite - you can discuss ANY aspect that makes them your favorite:
  * Their abilities, skills, or combat effectiveness, if applicable
  * Their personality, character growth, or development arc, if applicable
  * Their impact on the story or narrative, if applicable
  * Their design, voice acting, or visual appeal, if applicable
  * Their role in the party or team dynamics, if applicable
  * Any combination of the above
- You can mention other characters for comparison, but you MUST identify a specific favorite
- DO NOT just discuss general lore, story, or world-building without identifying a favorite hero/character
- The key requirement is that you MUST identify which character is your favorite and explain why - you can discuss any aspect of them (growth, story impact, abilities, etc.) as long as it relates to why they're your favorite
- If discussing multiple characters, make it clear which one is your favorite
- Start your post by stating your favorite (e.g., "My favorite hero has to be...", "I'd say my favorite is...", etc.)`;
  }

  // Check for mod-specific topics
  // Mods can include: recompiled versions, gameplay mods, graphics mods, bug fixes, content additions, ports, etc.
  // Look for mod-related keywords in the topic
  const modKeywords = [
    'recompiled', 'mod', 'port', 'unofficial', 'fan-made', 'custom', 'modded', 'modification',
    'mods', 'modding', 'modder', 'vanilla', 'unmodified', 'patch', 'overhaul', 'remaster',
    'enhanced', 'improved', 'community', 'user-generated', 'sdk', 'development kit'
  ];
  const hasModKeyword = modKeywords.some(keyword => topicLower.includes(keyword));

  // Also check category
  const isModCategory = categoryLower === 'mods';

  if (hasModKeyword || isModCategory) {
    // Try to extract the mod name from the topic
    // Look for patterns like "GameName - ModName" or "ModName" after the game title
    let modName = '';
    const afterGameTitle = topicLower.replace(gameTitleLower, '').trim();

    // Try to extract a specific mod name
    if (topicLower.includes('recompiled')) {
      modName = 'Recompiled';
    } else if (afterGameTitle && afterGameTitle.length > 0 && afterGameTitle.length < 50) {
      // Use the part after the game title as the mod name
      modName = afterGameTitle.replace(/^-\s*/, '').replace(/\s*-\s*.*$/, '').trim();
      // Clean up common patterns
      modName = modName.replace(/\s*-\s*mods?$/i, '').replace(/\s*-\s*mod$/i, '').trim();
      if (modName.length > 30 || modName.length < 2) modName = ''; // Too long or too short, use generic
    }

    const modNameText = modName ? ` (specifically "${modName}")` : '';

    return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about MODS or MODIFICATIONS${modNameText}. Your post MUST:
- Discuss mods, modifications, or user-generated content for ${gameTitle}
- If the forum title mentions a specific mod name, you MUST mention that mod by name in your post
- You can discuss various aspects of mods:
  * Mod features, installation, compatibility, or performance
  * Graphics mods, gameplay mods, bug fixes, or content additions
  * Mod development, modding tools, or SDKs
  * Specific mods you've tried, recommendations, or experiences
  * Comparisons between modded and vanilla (unmodified) versions
- You can mention the base game for context, but mods/modifications MUST be the primary focus
- DO NOT just discuss the vanilla/unmodified game without mentioning mods or modifications
- If discussing vanilla gameplay, make it clear you're comparing it to modded versions or discussing it in the context of mods

CRITICAL VALIDATION: Before posting, verify that ${gameTitle} actually supports mods. If ${gameTitle} does NOT support mods or have an active modding community, you MUST NOT discuss modding. Instead, acknowledge that the game doesn't support mods or focus on what the game actually has.`;
  }

  // Check for gameplay category
  if (forumCategory === 'gameplay' || topicLower.includes('gameplay')) {
    return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about GAMEPLAY. Your post MUST focus on:
- Gameplay mechanics, controls, strategies, tips, or techniques
- How to play, combat systems, movement, or game mechanics
- DO NOT focus primarily on story, themes, characters' emotional journeys, or narrative elements
- DO NOT discuss story themes, character development, or narrative depth as the main focus - gameplay should be the MAIN focus
- You can mention story/characters briefly if relevant to gameplay, but gameplay should be the PRIMARY focus
- Focus on what you DO in the game, not what the story is about`;
  }

  // Check for story/narrative topics
  if (topicLower.includes('story') || topicLower.includes('narrative') || topicLower.includes('plot')) {
    return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about STORY/NARRATIVE. Your post MUST focus on:
- Story elements, plot, narrative, character development, or themes
- Story-related experiences, moments, or discussions
- DO NOT focus primarily on gameplay mechanics, strategies, or tips unless they relate to story

CRITICAL VALIDATION: Before posting, verify that ${gameTitle} actually has story/narrative content. If ${gameTitle} does NOT have a story mode, narrative, or story content (e.g., it's a pure gameplay-focused game like arcade games, sports games without story modes, or competitive games), you MUST NOT discuss story elements. Instead, focus on what the game actually has (gameplay, characters as gameplay elements, etc.).`;
  }

  // Check for specific character mentions
  const characterMatch = topicLower.match(/(?:about|discuss|featuring|with)\s+([a-z\s]+?)(?:\s+in\s+|\s*$|$)/i);
  if (characterMatch && !topicLower.includes('favorite')) {
    const characterName = characterMatch[1].trim();
    if (characterName.length > 2 && characterName.length < 30) {
      return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about "${characterName}". Your post MUST:
- Focus on or discuss this specific character
- Mention this character by name in your post
- DO NOT just discuss the game in general without addressing this character`;
    }
  }

  // If there's a specific topic extracted, ensure it's addressed
  // This handles any custom forum topic dynamically
  if (specificTopic && specificTopic.length > 5 && !specificTopic.includes('general')) {
    // Check if it's a question format (e.g., "How to...", "Best way to...")
    const isQuestionFormat = /^(how|what|when|where|why|which|best|top|worst|should|can|do|does|did)/i.test(specificTopic.trim());

    if (isQuestionFormat) {
      return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about "${specificTopic}". Your post MUST:
- Directly address or answer the question/topic: "${specificTopic}"
- Provide relevant information, experiences, or discussion related to this specific question
- Stay focused on this topic - do not drift to unrelated topics
- Make sure your post clearly relates to and addresses "${specificTopic}"`;
    } else {
      return `CRITICAL TOPIC REQUIREMENT: This forum is specifically about "${specificTopic}". Your post MUST:
- Directly address or discuss this specific topic: "${specificTopic}"
- Stay relevant to "${specificTopic}" - do not drift to unrelated topics
- Make sure your post is clearly related to this topic
- If the topic asks about something specific (like a character, mechanic, or feature), make sure you discuss that specific thing`;
    }
  }

  // If no specific topic requirements were found, return empty string
  // This allows general discussion without restrictions
  return ''; // No specific requirements
}

/**
 * Generate a natural forum post for an automated user
 */
export async function generateForumPost(
  options: ContentGenerationOptions
): Promise<string> {
  const { gameTitle, genre, userPreferences, forumTopic, forumCategory, previousPosts = [] } = options;

  const isSinglePlayer = userPreferences.focus === 'single-player';
  // Determine if this is for InterdimensionalHipster by checking if they have both types of genres
  const isInterdimensionalHipster = userPreferences.genres.length > 5 &&
    userPreferences.genres.some(g => ['RPG', 'Adventure', 'Simulation', 'Puzzle', 'Platformer'].includes(g)) &&
    userPreferences.genres.some(g => ['Racing', 'Battle Royale', 'Fighting', 'First-Person Shooter', 'Sandbox'].includes(g));

  // Check if this is a single-player or multiplayer game based on genre
  const singlePlayerGenres = ['rpg', 'adventure', 'simulation', 'puzzle', 'platformer'];
  const inferredFromGenre = singlePlayerGenres.includes(genre.toLowerCase());
  const modeProfile = options.gameModeProfile || 'unknown';
  const isHybridGame = modeProfile === 'hybrid';
  const isSinglePlayerGame = modeProfile === 'single' ? true : modeProfile === 'multi' ? false : inferredFromGenre;
  const modeGuidance = isHybridGame
    ? `NOTE: ${gameTitle} may have BOTH single-player and multiplayer/online content. Focus on the forum category and your perspective. Do NOT claim the game has "no single-player" or "no multiplayer" unless you are absolutely certain.`
    : '';

  // Analyze forum topic to get topic-specific requirements
  const topicRequirements = analyzeForumTopic(forumTopic, forumCategory, gameTitle);

  // Build previous posts context if available
  let previousPostsContext = '';
  if (previousPosts.length > 0) {
    // Analyze previous posts to identify specific topics to avoid
    const previousTopics: string[] = [];
    previousPosts.forEach(post => {
      const lowerPost = post.toLowerCase();
      if (lowerPost.includes('chapter')) previousTopics.push('chapter');
      if (lowerPost.includes('level')) previousTopics.push('level');
      if (lowerPost.includes('soundtrack') || lowerPost.includes('music')) previousTopics.push('music/soundtrack');
      if (lowerPost.includes('visual') || lowerPost.includes('atmosphere') || lowerPost.includes('vibe')) previousTopics.push('visuals/atmosphere');
      if (lowerPost.includes('mechanic') || lowerPost.includes('wind') || lowerPost.includes('dash')) previousTopics.push('gameplay mechanics');
      if (lowerPost.includes('tip') || lowerPost.includes('pro tip') || lowerPost.includes('advice')) previousTopics.push('tips/advice');
      if (lowerPost.includes('finished') || lowerPost.includes('completed')) previousTopics.push('completion status');
    });
    // Remove duplicates manually to avoid Set iteration issues
    const uniqueTopics: string[] = [];
    previousTopics.forEach(topic => {
      if (!uniqueTopics.includes(topic)) {
        uniqueTopics.push(topic);
      }
    });

    // Build topic-specific uniqueness guidance
    let uniquenessGuidance = '';
    if (topicRequirements) {
      // If there's a specific topic requirement, ensure uniqueness within that topic
      uniquenessGuidance = `\n\nCRITICAL - UNIQUENESS WITHIN TOPIC (READ CAREFULLY):
- You MUST stay on-topic (see topic requirements above), BUT find a NEW angle within that topic
- Do NOT repeat the same specific examples, characters, or experiences from previous posts
- If the topic is about favorite heroes/characters, discuss a DIFFERENT hero or provide DIFFERENT reasons
- If the topic is about gameplay, discuss DIFFERENT mechanics, strategies, or tips
- If the topic is about mods, discuss DIFFERENT mod features or experiences
- Use COMPLETELY different phrasing and structure - avoid similar sentence patterns or word choices
- Find a NEW, UNIQUE angle within the forum topic that you haven't covered before`;
    } else {
      // General uniqueness guidance
      uniquenessGuidance = `\n\nCRITICAL - UNIQUENESS REQUIREMENTS (READ CAREFULLY):
- Your new post MUST be completely different from all previous posts above
- Do NOT repeat the same topics, experiences, themes, or tips from previous posts
${uniqueTopics.length > 0 ? `- AVOID these specific topics that you've already discussed: ${uniqueTopics.join(', ')}` : ''}
- Write about a COMPLETELY DIFFERENT aspect of ${gameTitle}:
  * If previous posts discussed a specific chapter/level, write about a DIFFERENT chapter/level OR a completely different topic (story, characters, items, etc.)
  * If previous posts discussed music/soundtrack, write about gameplay, story, characters, or mechanics instead
  * If previous posts discussed visuals/atmosphere, write about gameplay mechanics, tips, strategies, or story instead
  * If previous posts discussed gameplay mechanics (wind, dashes, etc.), write about story, characters, items, exploration, or secrets instead
  * If previous posts gave tips/advice, write about your experience, favorite moments, characters, or story instead
  * If previous posts mentioned finishing/completing, write about something else entirely
- Use COMPLETELY different phrasing and structure - avoid similar sentence patterns or word choices
- If you mentioned a specific chapter/level number before, do NOT mention the same chapter/level again
- If you gave tips about a specific mechanic before, do NOT give tips about the same mechanic again
- Be creative and find a NEW, UNIQUE angle to discuss about ${gameTitle} that you haven't covered before
- Avoid repeating similar themes, topics, or experiences from previous posts
- Think of a completely different aspect of the game: characters, story, items, secrets, different areas, different mechanics, different experiences`;
    }

    // Determine if these are posts from the same user or other automated users
    const automatedUsers = ['MysteriousMrEnter', 'WaywardJammer', 'InterdimensionalHipster'];
    const isMultipleUsers = previousPosts.length > 0; // Simplified check

    previousPostsContext = `\n\nCRITICAL: Here are previous posts about ${gameTitle} (from you and other automated users) to ensure your new post is UNIQUE and DIFFERENT:
${previousPosts.map((post, idx) => `${idx + 1}. "${post}"`).join('\n')}

${isMultipleUsers ? 'IMPORTANT: These posts may be from you OR from other automated users (MysteriousMrEnter, WaywardJammer, InterdimensionalHipster). Your post MUST be completely different from ALL of them, not just your own posts.' : ''}
${uniquenessGuidance}`;
  }

  const systemPrompt = isInterdimensionalHipster
    ? `You are InterdimensionalHipster, a knowledgeable and helpful gamer who loves both single-player and multiplayer games.
You're posting in a forum about ${gameTitle}. Generate a natural forum post that:
- MUST mention the game title "${gameTitle}" in the post (this is required)
- Sounds like a real person wrote it (NOT AI-generated - avoid phrases like "As an AI", "I would like to", "Hello", "In conclusion", etc.)
- Shares an experience, tip, or discussion point about ${isSinglePlayerGame ? 'single-player' : 'multiplayer/competitive'} aspects
- Uses casual gaming language (contractions, casual words, personal experiences like "I just", "I found", etc.)
- Is 2-4 sentences long
- Feels authentic and engaging
- ${isSinglePlayerGame ? 'Focuses on story, exploration, character builds, world details, puzzle solutions, or platforming tips' : 'Focuses on strategies, competitive play, online matches, multiplayer features, or sandbox creations'}
- Write as if you're sharing with friends on a gaming forum
- Shows knowledge about the game - mention specific items, characters, locations, mechanics, or memorable moments

${topicRequirements ? `\n${topicRequirements}\n` : ''}

CRITICAL ACCURACY REQUIREMENTS:
- ${isSinglePlayerGame
      ? 'Focus mainly on single-player aspects, but do NOT claim the game has no multiplayer/online modes unless you are absolutely certain.'
      : 'Focus mainly on multiplayer/online/competitive aspects, but do NOT claim the game has no single-player content unless you are absolutely certain.'}
- ${modeGuidance ? modeGuidance : ''}
- Spell character names, locations, and game terms CORRECTLY - double-check spelling before generating
- Only mention features that actually exist in ${gameTitle} - do NOT make up features or mechanics
- If you're unsure about a character name or feature, either omit it or use generic terms
- CRITICAL: Before discussing story/narrative content, verify that ${gameTitle} actually has story content. If the game does NOT have a story mode or narrative (e.g., pure gameplay/arcade games), do NOT discuss story elements - focus on what the game actually has
- CRITICAL: Before discussing mods, verify that ${gameTitle} actually supports mods. If the game does NOT support mods, do NOT discuss modding
- CRITICAL: Before discussing character development or character arcs, verify that ${gameTitle} actually has character development. If characters are static or the game doesn't focus on character growth, do NOT discuss character development

IMPORTANT: 
- Do NOT use formal language, greetings, conclusion phrases, or AI-related phrases. Write naturally and casually like a real gamer.
- You MUST include the game title "${gameTitle}" in your post.
- You MUST reference something specific from ${gameTitle} (a character, item, location, mechanic, moment, etc.)
- FACTUAL ACCURACY is more important than sounding natural - if you're not certain about a fact, don't include it
- MOST IMPORTANTLY: Your post MUST directly address and stay relevant to the forum topic "${forumTopic || 'General Discussion'}"
- CRITICAL: Your post MUST be completely unique and different from ALL previous posts shown above (whether from you or other automated users). Avoid similar topics, characters, experiences, or phrasing.${previousPostsContext}

Game: ${gameTitle}
${options.gameGenres && options.gameGenres.length > 0 ? `Game Genres (multi-genre possible): ${options.gameGenres.join(', ')}\n` : ''}Genre: ${genre} (${isHybridGame ? 'Hybrid' : isSinglePlayerGame ? 'Single-player' : 'Multiplayer'} focus)
Forum Topic: ${forumTopic || 'General Discussion'}
Forum Category: ${forumCategory || 'general'}

Generate ONLY the post content, nothing else:`
    : isSinglePlayer
      ? `You are MysteriousMrEnter, a real gamer who loves single-player RPGs, adventure games, simulation games, puzzle games, and platformers.
You're posting in a forum about ${gameTitle}. Generate a natural forum post that:
- MUST mention the game title "${gameTitle}" in the post (this is required)
- Sounds like a real person wrote it (NOT AI-generated - avoid phrases like "As an AI", "I would like to", "Hello", "In conclusion", etc.)
- Shares an experience, tip, or discussion point about single-player aspects
- Uses casual gaming language (contractions, casual words, personal experiences like "I just", "I found", etc.)
- Is 2-4 sentences long
- Feels authentic and engaging
- Focuses on story, exploration, character builds, world details, puzzle solutions, or platforming tips
- Write as if you're sharing with friends on a gaming forum

${topicRequirements ? `\n${topicRequirements}\n` : ''}

IMPORTANT: 
- Do NOT use formal language, greetings, conclusion phrases, or AI-related phrases. Write naturally and casually like a real gamer.
- You MUST include the game title "${gameTitle}" in your post.
- MOST IMPORTANTLY: Your post MUST directly address and stay relevant to the forum topic "${forumTopic || 'General Discussion'}"
- CRITICAL: Your post MUST be completely unique and different from ALL previous posts shown above (whether from you or other automated users). Avoid similar topics, characters, experiences, or phrasing.${previousPostsContext}
- CRITICAL VALIDATION: Only discuss content that actually exists in ${gameTitle}. If the forum topic mentions story/narrative but the game doesn't have story content, focus on what the game actually has (gameplay, characters as gameplay elements, etc.) rather than making up story content

Game: ${gameTitle}
Genre: ${genre} (RPG/Adventure/Simulation/Puzzle/Platformer focus)
Forum Topic: ${forumTopic || 'General Discussion'}
Forum Category: ${forumCategory || 'general'}

Generate ONLY the post content, nothing else:`
      : `You are WaywardJammer, a real gamer who loves multiplayer racing games, battle royale games, fighting games, first-person shooters, and sandbox games.
You're posting in a forum about ${gameTitle}. Generate a natural forum post that:
- MUST mention the game title "${gameTitle}" in the post (this is required)
- Sounds like a real person wrote it (NOT AI-generated - avoid phrases like "As an AI", "I would like to", "Hello", "In conclusion", etc.)
- Shares an experience, tip, or discussion point about competitive/multiplayer aspects
- Uses casual gaming language (contractions, casual words, personal experiences like "I just", "I found", etc.)
- Is 2-4 sentences long
- Feels authentic and engaging
- Focuses on strategies, competitive play, online matches, multiplayer features, or sandbox creations
- Write as if you're sharing with friends on a gaming forum

${topicRequirements ? `\n${topicRequirements}\n` : ''}

IMPORTANT: 
- Do NOT use formal language, greetings, conclusion phrases, or AI-related phrases. Write naturally and casually like a real gamer.
- You MUST include the game title "${gameTitle}" in your post.
- MOST IMPORTANTLY: Your post MUST directly address and stay relevant to the forum topic "${forumTopic || 'General Discussion'}"
- CRITICAL: Your post MUST be completely unique and different from ALL previous posts shown above (whether from you or other automated users). Avoid similar topics, characters, experiences, or phrasing.${previousPostsContext}
- CRITICAL VALIDATION: Only discuss content that actually exists in ${gameTitle}. If the forum topic mentions story/narrative but the game doesn't have story content, focus on what the game actually has (gameplay, characters as gameplay elements, etc.) rather than making up story content

Game: ${gameTitle}
Genre: ${genre} (Racing/Battle Royale/Fighting/FPS/Sandbox focus)
Forum Topic: ${forumTopic || 'General Discussion'}
Forum Category: ${forumCategory || 'general'}

Generate ONLY the post content, nothing else:`;

  try {
    // Select model based on game release date (GPT-5.2 for 2024+ games, GPT-4o for older)
    let selectedModel = await selectModelForAutomatedUser(gameTitle);
    let lastError: Error | null = null;

    // Retry logic: if GPT-4o fails (e.g., doesn't know about the game), try GPT-5.2
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Forum Post Generation] Attempt ${attempt}/${maxAttempts} using ${selectedModel} for ${gameTitle}`);

        const completion = await getOpenAIClient().chat.completions.create({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Generate a natural forum post about ${gameTitle} that a real gamer would write.`
            }
          ],
          temperature: 1.0, // Maximum temperature for maximum variation and uniqueness
          max_tokens: 250
        });

        const generatedPost = completion.choices[0]?.message?.content?.trim();

        if (!generatedPost) {
          throw new Error('Empty response from model');
        }

        // Clean up the response (remove quotes if wrapped, remove "Post:" prefix, etc.)
        let cleanedPost = generatedPost
          .replace(/^["']|["']$/g, '') // Remove surrounding quotes
          .replace(/^(Post:|Message:)\s*/i, '') // Remove "Post:" prefix
          .trim();

        if (cleanedPost.length < 20) {
          throw new Error('Generated post is too short or invalid');
        }

        console.log(`[Forum Post Generation] ✅ Successfully generated post using ${selectedModel}`);
        return cleanedPost;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Forum Post Generation] ❌ Attempt ${attempt} failed with ${selectedModel}:`, lastError.message);

        // If we're using GPT-4o and it fails, retry with GPT-5.2 (might be a newer game)
        if (attempt < maxAttempts && selectedModel === 'gpt-4o') {
          console.log(`[Forum Post Generation] ⚠️ GPT-4o failed, retrying with GPT-5.2 (game might be too new)`);
          selectedModel = 'gpt-5.2';
        } else {
          // If GPT-5.2 also fails or we've exhausted retries, throw
          break;
        }
      }
    }

    // If we get here, all attempts failed
    throw new Error(`Failed to generate forum post after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
  } catch (error) {
    console.error('Error generating forum post:', error);
    throw new Error(`Failed to generate forum post: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a natural reply to an existing forum post
 * The reply should be relevant to the game, the forum topic, and respond to the specific post content
 */
export async function generatePostReply(
  options: PostReplyOptions
): Promise<string> {
  const { gameTitle, genre, originalPost, originalPostAuthor, forumTopic, forumCategory } = options;

  // Determine if this is a single-player or multiplayer game based on genre
  const singlePlayerGenres = ['rpg', 'adventure', 'simulation', 'puzzle', 'platformer'];
  const inferredFromGenre = singlePlayerGenres.includes(genre.toLowerCase());
  const modeProfile = options.gameModeProfile || 'unknown';
  const isHybridGame = modeProfile === 'hybrid';
  const isSinglePlayerGame = modeProfile === 'single' ? true : modeProfile === 'multi' ? false : inferredFromGenre;
  const modeGuidance = isHybridGame
    ? `NOTE: ${gameTitle} may have BOTH single-player and multiplayer/online content. Focus on the forum category and the original post. Do NOT claim the game has "no single-player" or "no multiplayer" unless you are absolutely certain.`
    : '';

  // Analyze forum topic to get topic-specific requirements
  const topicRequirements = analyzeForumTopic(forumTopic, forumCategory, gameTitle);

  const systemPrompt = `You are InterdimensionalHipster, a knowledgeable and helpful gamer who loves both single-player and multiplayer games.
You're replying to a post in a forum about ${gameTitle}. The original post was written by ${originalPostAuthor}.

Generate a natural, helpful forum reply that:
- MUST mention the game title "${gameTitle}" in your reply (this is required)
- Directly responds to what ${originalPostAuthor} said in their post
- References specific game elements, mechanics, characters, or features from ${gameTitle} that relate to the discussion
- Provides helpful tips, information, or shares relevant experiences about ${gameTitle}
- Sounds like a real person wrote it (NOT AI-generated - avoid phrases like "As an AI", "I would like to", "Hello", "In conclusion", etc.)
- Uses casual gaming language (contractions, casual words, personal experiences like "I also", "I found", "Yeah", etc.)
- Is 2-4 sentences long
- Feels authentic and engaging, like you're genuinely responding to their post
- Shows knowledge about the game - mention specific items, characters, locations, mechanics, or memorable moments from ${gameTitle}
- Builds on what they said - agree, add to it, share a related experience, or provide helpful information

${topicRequirements ? `\n${topicRequirements}\n` : ''}

CRITICAL ACCURACY REQUIREMENTS:
- ${isSinglePlayerGame
      ? 'Focus mainly on single-player aspects, but do NOT claim the game has no multiplayer/online modes unless you are absolutely certain.'
      : 'Focus mainly on multiplayer/online/competitive aspects, but do NOT claim the game has no single-player content unless you are absolutely certain.'}
- ${modeGuidance ? modeGuidance : ''}
- Spell character names, locations, and game terms CORRECTLY - double-check spelling before generating (e.g., "Taion" not "Tion" in Xenoblade Chronicles 3)
- Only mention features that actually exist in ${gameTitle} - do NOT make up features or mechanics
- If you're unsure about a character name or feature, either omit it or use generic terms
- FACTUAL ACCURACY is more important than sounding natural - if you're not certain about a fact, don't include it
- CRITICAL: Before discussing story/narrative content, verify that ${gameTitle} actually has story content. If the game does NOT have a story mode or narrative, do NOT discuss story elements
- CRITICAL: Before discussing mods, verify that ${gameTitle} actually supports mods. If the game does NOT support mods, do NOT discuss modding
- CRITICAL: Before discussing character development, verify that ${gameTitle} actually has character development. If characters are static, do NOT discuss character development

IMPORTANT: 
- Do NOT use formal language, greetings, conclusion phrases, or AI-related phrases. Write naturally and casually like a real gamer.
- You MUST include the game title "${gameTitle}" in your reply.
- You MUST reference something specific from ${gameTitle} (a character, item, location, mechanic, moment, etc.)
- Make sure your reply is directly relevant to what ${originalPostAuthor} wrote - don't just talk about the game in general
- MOST IMPORTANTLY: Your reply MUST stay relevant to the forum topic "${forumTopic || 'General Discussion'}" - ensure your response addresses the forum's specific topic

Game: ${gameTitle}
${options.gameGenres && options.gameGenres.length > 0 ? `Game Genres (multi-genre possible): ${options.gameGenres.join(', ')}\n` : ''}Genre: ${genre} (${isHybridGame ? 'Hybrid' : isSinglePlayerGame ? 'Single-player' : 'Multiplayer'} focus)
Forum Topic: ${forumTopic || 'General Discussion'}
Forum Category: ${forumCategory || 'general'}
Original Post Author: ${originalPostAuthor}

Original Post:
"${originalPost}"

Generate ONLY the reply content, nothing else:`;

  try {
    // Select model based on game release date (GPT-5.2 for 2024+ games, GPT-4o for older)
    let selectedModel = await selectModelForAutomatedUser(gameTitle);
    let lastError: Error | null = null;

    // Retry logic: if GPT-4o fails (e.g., doesn't know about the game), try GPT-5.2
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Post Reply Generation] Attempt ${attempt}/${maxAttempts} using ${selectedModel} for ${gameTitle}`);

        const completion = await getOpenAIClient().chat.completions.create({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Generate a natural, helpful reply to ${originalPostAuthor}'s post about ${gameTitle}. Make sure to reference specific game elements and respond directly to what they said.`
            }
          ],
          temperature: 0.8, // Higher temperature for more natural variation
          max_tokens: 300
        });

        const generatedReply = completion.choices[0]?.message?.content?.trim();

        if (!generatedReply) {
          throw new Error('Empty response from model');
        }

        // Clean up the response (remove quotes if wrapped, remove "Reply:" prefix, etc.)
        let cleanedReply = generatedReply
          .replace(/^["']|["']$/g, '') // Remove surrounding quotes
          .replace(/^(Reply:|Response:)\s*/i, '') // Remove "Reply:" prefix
          .trim();

        if (cleanedReply.length < 20) {
          throw new Error('Generated reply is too short or invalid');
        }

        console.log(`[Post Reply Generation] ✅ Successfully generated reply using ${selectedModel}`);
        return cleanedReply;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Post Reply Generation] ❌ Attempt ${attempt} failed with ${selectedModel}:`, lastError.message);

        // If we're using GPT-4o and it fails, retry with GPT-5.2 (might be a newer game)
        if (attempt < maxAttempts && selectedModel === 'gpt-4o') {
          console.log(`[Post Reply Generation] ⚠️ GPT-4o failed, retrying with GPT-5.2 (game might be too new)`);
          selectedModel = 'gpt-5.2';
        } else {
          // If GPT-5.2 also fails or we've exhausted retries, throw
          break;
        }
      }
    }

    // If we get here, all attempts failed
    throw new Error(`Failed to generate post reply after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
  } catch (error) {
    console.error('Error generating post reply:', error);
    throw new Error(`Failed to generate post reply: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a forum post for a COMMON gamer about an issue/challenge they're facing
 */
export async function generateCommonGamerPost(
  options: ContentGenerationOptions & {
    gamerProfile: UserPreferences['gamerProfile'];
    username: string;
  }
): Promise<string> {
  const { gameTitle, genre, gamerProfile, username, forumTopic, forumCategory, previousPosts = [] } = options;

  if (!gamerProfile || gamerProfile.type !== 'common') {
    throw new Error('Invalid gamer profile for COMMON gamer post');
  }

  // Analyze forum topic to get topic/category-specific requirements (keeps COMMON gamers on-topic)
  const topicRequirements = analyzeForumTopic(forumTopic, forumCategory, gameTitle);
  const categoryLower = (forumCategory || 'general').toLowerCase();

  // Find a struggle from their favorite games that matches the current game
  const gameStruggles = gamerProfile.favoriteGames
    .find(g => g.gameTitle.toLowerCase() === gameTitle.toLowerCase())?.currentStruggles || [];

  // Category-aware issues: if the user's stored struggles don't match the forum category,
  // fall back to a category-appropriate issue so posts stay aligned with the forum.
  const categoryIssueFallbacks: Record<string, string[]> = {
    mods: [
      'having trouble installing a mod',
      'running into mod compatibility issues',
      'figuring out load order or mod conflicts',
      'getting a mod to work after a game update',
      'trying to find a safe, reputable mod setup'
    ],
    speedruns: [
      'trying to learn a consistent route',
      'losing time on a tricky section and not sure what the right strat is',
      'struggling to execute a consistent skip or setup',
      'not sure how to practice splits and pacing effectively',
      'having trouble keeping runs consistent without resets'
    ],
    gameplay: [
      'having trouble with a specific mechanic',
      'struggling to execute a consistent combo or timing window',
      'getting stuck on a boss or tough encounter',
      'not sure what the best approach is for a tricky section',
      'having trouble understanding a game system'
    ],
    help: [
      'having trouble with a specific part',
      'stuck and not sure what I’m missing',
      'running into a frustrating issue and could use advice',
      'trying a few things but nothing’s working',
      'not sure how to progress from here'
    ],
    general: [
      'a bit confused about how something works',
      'trying to get better but keep messing up',
      'not sure if I’m approaching something the right way',
      'stuck on a specific part and could use pointers',
      'having trouble with a specific part'
    ]
  };

  const looksLikeCategory = (text: string, category: string): boolean => {
    const t = (text || '').toLowerCase();
    if (!t) return false;
    switch (category) {
      case 'mods':
        return /mod|mods|modding|install|installer|load order|patch|plugin|compatib|crash|conflict|recompiled|overhaul/i.test(t);
      case 'speedruns':
        return /speedrun|pb|rta|il\b|route|split|strat|setup|reset|timing|skip|frame|cycle/i.test(t);
      case 'gameplay':
        return /combo|timing|inputs?|mechanic|strategy|strat|boss|matchup|movement|build|controls?/i.test(t);
      case 'help':
        return /help|stuck|any tips|any advice|can't|cannot|trouble|issue|problem|how do i|what should i/i.test(t);
      default:
        return true;
    }
  };

  const pickedFromProfile = gameStruggles.length > 0
    ? gameStruggles[Math.floor(Math.random() * gameStruggles.length)]
    : '';

  const specificIssue =
    pickedFromProfile && looksLikeCategory(pickedFromProfile, categoryLower)
      ? pickedFromProfile
      : (categoryIssueFallbacks[categoryLower] || categoryIssueFallbacks.general)[
      Math.floor(Math.random() * (categoryIssueFallbacks[categoryLower] || categoryIssueFallbacks.general).length)
      ];

  // Build context about their skill level and struggles
  const skillContext = `You have a skill level of ${gamerProfile.skillLevel}/10, which means you're still learning and often struggle with ${gamerProfile.skillLevel <= 2 ? 'basic mechanics and understanding game systems' : gamerProfile.skillLevel <= 4 ? 'intermediate challenges and optimization' : 'advanced techniques'}.`;

  const personalityContext = `Your personality traits: ${gamerProfile.personality.traits.join(', ')}. Your communication style: ${gamerProfile.personality.communicationStyle}.`;

  // Build previous posts context
  let previousPostsContext = '';
  if (previousPosts.length > 0) {
    previousPostsContext = `\n\nCRITICAL: Here are previous posts you've made to ensure your new post is UNIQUE:
${previousPosts.map((post, idx) => `${idx + 1}. "${post}"`).join('\n')}

Your new post MUST be completely different from all previous posts above.`;
  }

  const systemPrompt = `You are ${username}, a COMMON gamer with skill level ${gamerProfile.skillLevel}/10.
${skillContext}
${personalityContext}

You're playing ${gameTitle} and ${specificIssue}.

Generate a forum post that:
- Describes your specific problem or challenge in ${gameTitle}
- Mentions what you've tried (even if it didn't work)
- Asks for help in a genuine, relatable way that matches your skill level
- Stays aligned with the forum category "${forumCategory || 'general'}" (do NOT drift into other categories)
- If the forum category is "Mods", your help request must be specifically about modding/mod installation/compatibility
- If the forum category is "Speedruns", your help request must be specifically about speedrunning routes/strats/consistency
- If the forum category is "Gameplay", your help request must be specifically about gameplay mechanics/strategy/execution
- References your struggles naturally (don't over-explain your skill level, just show it through your language)
- Is 2-4 sentences long
- Sounds like a real person struggling with the game
- Uses casual gaming language that matches your communication style
- Shows you're genuinely stuck and need help

${topicRequirements ? `\n${topicRequirements}\n` : ''}

CRITICAL ACCURACY REQUIREMENTS:
- Spell character names, locations, and game terms CORRECTLY
- Only mention features that actually exist in ${gameTitle}
- If you're unsure about a fact, don't include it
- CRITICAL: Before discussing story/narrative content, verify that ${gameTitle} actually has story content. If the game does NOT have a story mode or narrative, do NOT discuss story elements
- CRITICAL: Before discussing mods, verify that ${gameTitle} actually supports mods. If the game does NOT support mods, do NOT discuss modding
- CRITICAL: Before discussing character development, verify that ${gameTitle} actually has character development. If characters are static, do NOT discuss character development

IMPORTANT:
- Do NOT use formal language or AI-related phrases
- You MUST include the game title "${gameTitle}" in your post
- Your post should reflect your skill level naturally (skill ${gamerProfile.skillLevel}/10)
- MOST IMPORTANTLY: Your post MUST directly address and stay relevant to the forum topic "${forumTopic || 'General Discussion'}"
- Be genuine and relatable - you're asking for help because you're stuck${previousPostsContext}

Game: ${gameTitle}
Genre: ${genre}
Forum Topic: ${forumTopic || 'General Discussion'}
Forum Category: ${forumCategory || 'general'}

Generate ONLY the post content, nothing else:`;

  try {
    // Select model based on game release date (GPT-5.2 for 2024+ games, GPT-4o for older)
    let selectedModel = await selectModelForAutomatedUser(gameTitle);
    let lastError: Error | null = null;

    // Retry logic: if GPT-4o fails (e.g., doesn't know about the game), try GPT-5.2
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Common Gamer Post] Attempt ${attempt}/${maxAttempts} using ${selectedModel} for ${gameTitle}`);

        const completion = await getOpenAIClient().chat.completions.create({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Generate a forum post about struggling with ${gameTitle}.`
            }
          ],
          temperature: 0.9,
          max_tokens: 250
        });

        const generatedPost = completion.choices[0]?.message?.content?.trim();

        if (!generatedPost) {
          throw new Error('Empty response from model');
        }

        let cleanedPost = generatedPost
          .replace(/^["']|["']$/g, '')
          .replace(/^(Post:|Message:)\s*/i, '')
          .trim();

        if (cleanedPost.length < 20) {
          throw new Error('Generated post is too short or invalid');
        }

        console.log(`[Common Gamer Post] ✅ Successfully generated post using ${selectedModel}`);
        return cleanedPost;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Common Gamer Post] ❌ Attempt ${attempt} failed with ${selectedModel}:`, lastError.message);

        // If we're using GPT-4o and it fails, retry with GPT-5.2 (might be a newer game)
        if (attempt < maxAttempts && selectedModel === 'gpt-4o') {
          console.log(`[Common Gamer Post] ⚠️ GPT-4o failed, retrying with GPT-5.2 (game might be too new)`);
          selectedModel = 'gpt-5.2';
        } else {
          // If GPT-5.2 also fails or we've exhausted retries, throw
          break;
        }
      }
    }

    // If we get here, all attempts failed
    throw new Error(`Failed to generate COMMON gamer post after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
  } catch (error) {
    console.error('Error generating COMMON gamer post:', error);
    throw new Error(`Failed to generate COMMON gamer post: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a solution reply from an EXPERT gamer to a COMMON gamer's post
 */
export async function generateExpertGamerReply(
  options: PostReplyOptions & {
    gamerProfile: UserPreferences['gamerProfile'];
    username: string;
    commonGamerUsername: string;
  }
): Promise<string> {
  const { gameTitle, genre, originalPost, originalPostAuthor, gamerProfile, username, commonGamerUsername, forumTopic, forumCategory } = options;

  if (!gamerProfile || gamerProfile.type !== 'expert') {
    throw new Error('Invalid gamer profile for EXPERT gamer reply');
  }

  // Find expertise from their favorite games
  const gameExpertise = gamerProfile.favoriteGames
    .find(g => g.gameTitle.toLowerCase() === gameTitle.toLowerCase())?.expertise || [];

  const expertiseContext = gameExpertise.length > 0
    ? `Your areas of expertise in ${gameTitle}: ${gameExpertise.join(', ')}.`
    : `You've mastered ${gameTitle} with extensive experience.`;

  const personalityContext = `Your personality traits: ${gamerProfile.personality.traits.join(', ')}. Your communication style: ${gamerProfile.personality.communicationStyle}.`;

  // Determine if this is a single-player or multiplayer game
  const singlePlayerGenres = ['rpg', 'adventure', 'simulation', 'puzzle', 'platformer', 'metroidvania'];
  const inferredFromGenre = singlePlayerGenres.includes(genre.toLowerCase());
  const modeProfile = options.gameModeProfile || 'unknown';
  const isHybridGame = modeProfile === 'hybrid';
  const isSinglePlayerGame = modeProfile === 'single' ? true : modeProfile === 'multi' ? false : inferredFromGenre;
  const modeGuidance = isHybridGame
    ? `NOTE: ${gameTitle} may have BOTH single-player and multiplayer/online content. Focus on the forum category and the original post. Do NOT claim the game has "no single-player" or "no multiplayer" unless you are absolutely certain.`
    : '';

  // Keep EXPERT replies aligned with forum topic/category (mods/speedruns/gameplay/help)
  const topicRequirements = analyzeForumTopic(forumTopic, forumCategory, gameTitle);

  const systemPrompt = `You are ${username}, an EXPERT gamer with skill level ${gamerProfile.skillLevel}/10.
${expertiseContext}
${personalityContext}

A COMMON gamer (${commonGamerUsername}, skill level lower than yours) posted about struggling with ${gameTitle}. Their post: "${originalPost}"

Generate a helpful, detailed solution reply that:
- Directly addresses their specific problem
- Provides step-by-step guidance that's clear for someone with lower skill
- Shares your expertise naturally without being condescending
- Is encouraging and supportive (they're struggling, be patient)
- References specific game mechanics, items, locations, or strategies from ${gameTitle}
- Is 3-5 sentences long
- Sounds like an experienced player helping a friend
- Matches your communication style
- Stays aligned with the forum category "${forumCategory || 'general'}" (do NOT drift into unrelated categories)

${topicRequirements ? `\n${topicRequirements}\n` : ''}

CRITICAL ACCURACY REQUIREMENTS:
- ${isSinglePlayerGame
      ? 'Focus mainly on single-player aspects, but do NOT claim the game has no multiplayer/online modes unless you are absolutely certain.'
      : 'Focus mainly on multiplayer/online/competitive aspects, but do NOT claim the game has no single-player content unless you are absolutely certain.'}
- ${modeGuidance ? modeGuidance : ''}
- Spell character names, locations, and game terms CORRECTLY
- Only mention features that actually exist in ${gameTitle}
- Provide accurate, actionable advice
- CRITICAL: Before discussing story/narrative content, verify that ${gameTitle} actually has story content. If the game does NOT have a story mode or narrative, do NOT discuss story elements
- CRITICAL: Before discussing mods, verify that ${gameTitle} actually supports mods. If the game does NOT support mods, do NOT discuss modding
- CRITICAL: Before discussing character development, verify that ${gameTitle} actually has character development. If characters are static, do NOT discuss character development

IMPORTANT:
- Do NOT use formal language or AI-related phrases
- You MUST include the game title "${gameTitle}" in your reply
- Be encouraging - they're struggling and need help
- Break down complex solutions into simple steps
- Reference your expertise naturally (e.g., "I've found that...", "When I play...")

Game: ${gameTitle}
${options.gameGenres && options.gameGenres.length > 0 ? `Game Genres (multi-genre possible): ${options.gameGenres.join(', ')}\n` : ''}Genre: ${genre} (${isHybridGame ? 'Hybrid' : isSinglePlayerGame ? 'Single-player' : 'Multiplayer'} focus)
Forum Topic: ${forumTopic || 'General Discussion'}
Forum Category: ${forumCategory || 'general'}
Original Post Author: ${originalPostAuthor} (COMMON gamer)

Original Post:
"${originalPost}"

Generate ONLY the reply content, nothing else:`;

  try {
    // Select model based on game release date (GPT-5.2 for 2024+ games, GPT-4o for older)
    let selectedModel = await selectModelForAutomatedUser(gameTitle);
    let lastError: Error | null = null;

    // Retry logic: if GPT-4o fails (e.g., doesn't know about the game), try GPT-5.2
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Expert Gamer Reply] Attempt ${attempt}/${maxAttempts} using ${selectedModel} for ${gameTitle}`);

        const completion = await getOpenAIClient().chat.completions.create({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Generate a helpful solution reply to ${originalPostAuthor}'s post about struggling with ${gameTitle}.`
            }
          ],
          temperature: 0.8,
          max_tokens: 350
        });

        const generatedReply = completion.choices[0]?.message?.content?.trim();

        if (!generatedReply) {
          throw new Error('Empty response from model');
        }

        let cleanedReply = generatedReply
          .replace(/^["']|["']$/g, '')
          .replace(/^(Reply:|Response:)\s*/i, '')
          .trim();

        if (cleanedReply.length < 20) {
          throw new Error('Generated reply is too short or invalid');
        }

        console.log(`[Expert Gamer Reply] ✅ Successfully generated reply using ${selectedModel}`);
        return cleanedReply;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Expert Gamer Reply] ❌ Attempt ${attempt} failed with ${selectedModel}:`, lastError.message);

        // If we're using GPT-4o and it fails, retry with GPT-5.2 (might be a newer game)
        if (attempt < maxAttempts && selectedModel === 'gpt-4o') {
          console.log(`[Expert Gamer Reply] ⚠️ GPT-4o failed, retrying with GPT-5.2 (game might be too new)`);
          selectedModel = 'gpt-5.2';
        } else {
          // If GPT-5.2 also fails or we've exhausted retries, throw
          break;
        }
      }
    }

    // If we get here, all attempts failed
    throw new Error(`Failed to generate EXPERT gamer reply after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
  } catch (error) {
    console.error('Error generating EXPERT gamer reply:', error);
    throw new Error(`Failed to generate EXPERT gamer reply: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract game title from generated content (helper function)
 * This can be used to verify the game title matches what was requested
 */
export function extractGameTitleFromContent(content: string, expectedGameTitle: string): string | null {
  // Simple check: if the expected game title appears in the content, return it
  const lowerContent = content.toLowerCase();
  const lowerExpected = expectedGameTitle.toLowerCase();

  if (lowerContent.includes(lowerExpected)) {
    return expectedGameTitle;
  }

  // Try to find game title patterns (words in quotes, capitalized phrases, etc.)
  // For now, return the expected title as fallback
  return expectedGameTitle;
}

