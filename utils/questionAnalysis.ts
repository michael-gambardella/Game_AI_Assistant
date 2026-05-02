import { extractGameTitleFromQuestion } from './gameTitleExtractor';
import { LRUCache, cacheManager } from './cacheManager';
// Interface for question metadata
export interface QuestionMetadata {
  detectedGame?: string;
  detectedGenre?: string[];
  questionCategory?: string;
  difficultyHint?: string;
  interactionType?: string;
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
const PATTERN_CACHE_MAX_SIZE = 250; // Max 250 users — 1000 was ~50-100MB; reduced to cap memory pressure

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