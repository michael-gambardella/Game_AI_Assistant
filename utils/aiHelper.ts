import axios from 'axios';
import { externalApiClient } from './axiosConfig';
import { getClientCredentialsAccessToken } from './twitchAuth';
import { LRUCache, cacheManager } from './cacheManager';
import { getOpenAIClient, openaiRequestOptionsForModel, aiCache } from './openaiClient';
export * from './openaiClient';
import { fetchFromIGDB, fetchFromRAWG, fetchVersionInfo, fetchSeriesFromIGDB, fetchSeriesFromRAWG, fetchGameLevelsFromIGDB, fetchGameDetailsFromRAWG, cleanAndMatchTitle, validateGameMatch } from './gameMetadata';
export * from './gameMetadata';
import { getGameReleaseDate, selectModelForQuestion, getModelUsageStats, resetModelUsageStats, modelUsageStats } from './modelSelection';
export * from './modelSelection';
import { extractGameTitleFromQuestion } from './gameTitleExtractor';
export * from './gameTitleExtractor';
import { getChatCompletion, getChatCompletionWithVision, enhanceQuestionWithGameContext, extractGameTitleFromImageContext } from './chatCompletion';
export * from './chatCompletion';
import { analyzeUserQuestions, fetchRecommendations } from './recommendations';
export * from './recommendations';
import { QuestionMetadata, extractQuestionMetadata, updateQuestionMetadata, analyzeGameplayPatterns, shouldRunAnalysis } from './questionAnalysis';
export * from './questionAnalysis';
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
