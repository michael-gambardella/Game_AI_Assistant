/**
 * Generate personalized recommendations based on stored user patterns
 * Uses the patterns stored in the User model to provide tailored suggestions
 * Includes: strategy tips, learning paths, and personalized tips
 */

import User from '../models/User';
import {
  analyzeGameplayPatterns,
  extractQuestionMetadata,
  getPersonalizedStrategyTip,
  TemplateContext
} from './aiHelper';


/**
 * Map genre name from analysis to template genre key
 * Converts full genre names (e.g., "Role-Playing Game") to template keys (e.g., "rpg")
 * Phase 4 Step 1: Template System Integration
 */
function mapGenreToTemplateKey(genreName: string): string {
  if (!genreName) return '';

  const lowerGenre = genreName.toLowerCase();

  // First, map internal genre names (from checkQuestionType) to template keys
  // These are the internal genre identifiers used in the system
  const internalGenreMap: { [key: string]: string } = {
    'platformerpro': 'platformer',
    'platformer pro': 'platformer',
    'rpgenthusiast': 'rpg',
    'rpg enthusiast': 'rpg',
    'actionaficionado': 'action',
    'action aficionado': 'action',
    'shooterspecialist': 'shooter',
    'shooter specialist': 'shooter',
    'strategyspecialist': 'strategy',
    'strategy specialist': 'strategy',
    'adventureaddict': 'adventure',
    'adventure addict': 'adventure',
    'puzzlepro': 'puzzle',
    'puzzle pro': 'puzzle',
    'fightingfanatic': 'fighting',
    'fighting fanatic': 'fighting',
    'racingrenegade': 'racing',
    'racing renegade': 'racing',
    'sportschampion': 'sports',
    'sports champion': 'sports',
    'survivalspecialist': 'survival',
    'survival specialist': 'survival',
    'horrorhero': 'horror',
    'horror hero': 'horror',
    'stealthexpert': 'stealth',
    'stealth expert': 'stealth',
    'simulationspecialist': 'simulation',
    'simulation specialist': 'simulation',
    'sandboxbuilder': 'sandbox',
    'sandbox builder': 'sandbox',
    'shootemupsniper': 'shootem up',
    'shootem up sniper': 'shootem up',
    'battleroyale': 'battle-royale',
    'battle royale': 'battle-royale',
    'battle royale master': 'battle-royale',
  };

  // Check internal genre names first (remove spaces and check)
  const normalizedInternal = lowerGenre.replace(/\s+/g, '');
  if (internalGenreMap[normalizedInternal]) {
    return internalGenreMap[normalizedInternal];
  }

  // Direct mappings for full genre names
  const genreMap: { [key: string]: string } = {
    'role-playing game': 'rpg',
    'rpg': 'rpg',
    'action-role-playing game': 'rpg', // Prioritize RPG for action-rpg
    'action role-playing game': 'rpg',
    'first-person shooter': 'shooter',
    'third-person shooter': 'shooter',
    'shooter': 'shooter',
    'fps': 'shooter',
    'strategy': 'strategy',
    'real-time strategy': 'strategy',
    'turn-based strategy': 'strategy',
    'action': 'action',
    'action-adventure': 'action',
    'adventure': 'adventure',
    'platformer': 'platformer',
    'puzzle': 'puzzle',
    'fighting': 'fighting',
    'racing': 'racing',
    'sports': 'sports',
    'survival': 'survival',
    'survival horror': 'horror',
    'horror': 'horror',
    'stealth': 'stealth',
    'simulation': 'simulation',
    'roguelike': 'roguelike',
    'rogue-like': 'roguelike',
    'sandbox': 'sandbox',
    'battle royale': 'battle-royale',
    'battle-royale': 'battle-royale',
  };

  // Check for exact match first
  if (genreMap[lowerGenre]) {
    return genreMap[lowerGenre];
  }

  // Check for partial matches (e.g., "Role-Playing Game" contains "rpg")
  for (const [key, value] of Object.entries(genreMap)) {
    if (lowerGenre.includes(key) || key.includes(lowerGenre)) {
      return value;
    }
  }

  // Check for common genre keywords
  if (lowerGenre.includes('rpg') || lowerGenre.includes('role-playing')) return 'rpg';
  if (lowerGenre.includes('shooter') || lowerGenre.includes('fps')) return 'shooter';
  if (lowerGenre.includes('strategy') || lowerGenre.includes('tactical')) return 'strategy';
  if (lowerGenre.includes('action')) return 'action';
  if (lowerGenre.includes('adventure')) return 'adventure';
  if (lowerGenre.includes('platformer')) return 'platformer';
  if (lowerGenre.includes('puzzle')) return 'puzzle';
  if (lowerGenre.includes('fighting')) return 'fighting';
  if (lowerGenre.includes('racing')) return 'racing';
  if (lowerGenre.includes('sports')) return 'sports';
  if (lowerGenre.includes('survival')) return 'survival';
  if (lowerGenre.includes('horror')) return 'horror';
  if (lowerGenre.includes('stealth')) return 'stealth';
  if (lowerGenre.includes('simulation')) return 'simulation';
  if (lowerGenre.includes('roguelike') || lowerGenre.includes('rogue-like')) return 'roguelike';
  if (lowerGenre.includes('sandbox')) return 'sandbox';
  if (lowerGenre.includes('battle-royale') || lowerGenre.includes('battleroyale') || lowerGenre.includes('battle royale')) return 'battle-royale';

  // Return original genre name (will use fallback in template system)
  return lowerGenre;
}

/**
 * Build template context from user patterns and preferences
 * Phase 4 Step 1: Template System Integration
 * Intelligently extracts context values to personalize templates
 */
function buildTemplateContext(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  context: Awaited<ReturnType<typeof extractQuestionContext>>,
  preferences?: any
): TemplateContext {
  const templateContext: TemplateContext = {};
  const topGenre = patterns.genreAnalysis.topGenres[0]?.genre || '';
  const difficulty = context.difficultyHint || patterns.difficulty.currentLevel;
  const playstyleTags = preferences?.playstyleTags || [];
  const questionCategory = context.questionCategory;

  // Extract genre-specific context based on top genre
  const genreKey = mapGenreToTemplateKey(topGenre);

  // RPG context
  if (genreKey === 'rpg') {
    if (difficulty === 'beginner') {
      // For beginners, suggest balanced stats
      templateContext.primaryStat = 'strength and vitality';
    } else if (difficulty === 'intermediate') {
      if (playstyleTags.includes('strategist')) {
        templateContext.specificStrategy = 'a specialized build focusing on one primary stat';
      } else {
        templateContext.specificStrategy = 'different stat distributions to find your preferred playstyle';
      }
    } else if (difficulty === 'advanced') {
      templateContext.minMaxTips = 'focusing on one primary stat and optimizing gear synergies for maximum efficiency';
    }
  }

  // Shooter context
  if (genreKey === 'shooter' || genreKey === 'action') {
    if (difficulty === 'beginner') {
      templateContext.weaponClass = 'assault rifles or SMGs';
    } else if (difficulty === 'intermediate') {
      if (playstyleTags.includes('strategist')) {
        templateContext.specificLoadout = 'a loadout tailored to specific map types';
        templateContext.reasoning = 'different maps require different engagement ranges';
      } else {
        templateContext.specificLoadout = 'different weapon combinations';
        templateContext.reasoning = 'experimentation helps you find what works best';
      }
    } else if (difficulty === 'advanced') {
      templateContext.optimalSetup = 'meta weapons and attachments optimized for TTK';
      templateContext.reasoning = 'they provide the best time-to-kill and competitive advantage';
    }
  }

  // Strategy context
  if (genreKey === 'strategy') {
    if (difficulty === 'beginner') {
      templateContext.resourceTips = 'prioritize resource generation over early aggression';
    } else if (difficulty === 'intermediate') {
      // Extract more specific context if available
      if (questionCategory === 'strategy') {
        templateContext.unitType = 'counters';
        templateContext.specificThreat = 'common enemy strategies';
      } else {
        templateContext.unitType = 'versatile units';
        templateContext.specificThreat = 'various threats';
      }
    } else if (difficulty === 'advanced') {
      templateContext.complexStrategy = 'meta compositions with optimal unit combinations';
    }
  }

  // Action context (for non-shooter action games)
  // Note: Shooter context is handled above, this is for melee/combat action games
  if (genreKey === 'action') {
    // Only add action-specific context if shooter context wasn't already set
    if (!templateContext.weaponClass && !templateContext.specificLoadout && !templateContext.optimalSetup) {
      if (difficulty === 'beginner') {
        templateContext.beginnerWeapon = 'sword and shield for easier combat';
      } else if (difficulty === 'intermediate') {
        templateContext.weaponCombo = 'light and heavy attack combinations';
      } else if (difficulty === 'advanced') {
        templateContext.advancedTechnique = 'perfect dodge timing and parry windows';
      }
    }
  }

  // Adventure context
  if (genreKey === 'adventure') {
    if (difficulty === 'beginner') {
      templateContext.safeAreas = 'starting areas and tutorial zones';
    } else if (difficulty === 'intermediate') {
      templateContext.keyUpgrades = 'health upgrades and movement abilities';
    } else if (difficulty === 'advanced') {
      templateContext.efficientPath = 'sequence breaking and route optimization';
    }
  }

  // Platformer context
  if (genreKey === 'platformer') {
    if (difficulty === 'beginner') {
      templateContext.basicTechnique = 'precise jumping and timing';
    } else if (difficulty === 'intermediate') {
      templateContext.advancedMove = 'wall jumping and air dashing';
    } else if (difficulty === 'advanced') {
      templateContext.speedrunTech = 'wave dashing and frame-perfect inputs';
    }
  }

  // Survival context
  if (genreKey === 'survival') {
    if (difficulty === 'beginner') {
      templateContext.resourcePriority = 'food, water, and shelter';
    } else if (difficulty === 'intermediate') {
      templateContext.survivalStrategy = 'establishing a base and securing resources';
    } else if (difficulty === 'advanced') {
      templateContext.advancedSurvival = 'optimizing resource gathering and crafting efficiency';
    }
  }

  // Horror context
  if (genreKey === 'horror') {
    if (difficulty === 'beginner') {
      templateContext.conservativeApproach = 'explore carefully and save often';
    } else if (difficulty === 'intermediate') {
      templateContext.horrorStrategy = 'managing your resources and knowing when to run';
    } else if (difficulty === 'advanced') {
      templateContext.advancedHorror = 'mastering enemy patterns and optimal routing';
    }
  }

  // Stealth context
  if (genreKey === 'stealth') {
    if (difficulty === 'beginner') {
      templateContext.basicStealth = 'staying in shadows and avoiding direct confrontation';
    } else if (difficulty === 'intermediate') {
      templateContext.stealthTechnique = 'using distractions and environmental advantages';
    } else if (difficulty === 'advanced') {
      templateContext.advancedStealth = 'perfecting timing and route optimization for ghost runs';
    }
  }

  // Simulation context
  if (genreKey === 'simulation') {
    if (difficulty === 'beginner') {
      templateContext.basicManagement = 'learning the core systems and basic controls';
    } else if (difficulty === 'intermediate') {
      templateContext.simulationStrategy = 'balancing multiple systems and optimizing workflows';
    } else if (difficulty === 'advanced') {
      templateContext.advancedSimulation = 'min-maxing efficiency and mastering complex mechanics';
    }
  }

  // Roguelike context
  if (genreKey === 'roguelike') {
    if (difficulty === 'beginner') {
      templateContext.roguelikeBasics = 'learning enemy patterns and item synergies';
    } else if (difficulty === 'intermediate') {
      templateContext.roguelikeStrategy = 'adapting your build to what you find and managing risk';
    } else if (difficulty === 'advanced') {
      templateContext.advancedRoguelike = 'mastering optimal routes and build optimization';
    }
  }

  // Sandbox context
  if (genreKey === 'sandbox') {
    if (difficulty === 'beginner') {
      templateContext.basicExploration = 'experimenting with basic tools and mechanics';
    } else if (difficulty === 'intermediate') {
      templateContext.sandboxCreativity = 'combining systems in creative ways';
    } else if (difficulty === 'advanced') {
      templateContext.advancedSandbox = 'mastering advanced building techniques and optimization';
    }
  }

  // Battle Royale context
  if (genreKey === 'battle-royale' || genreKey === 'battleroyale') {
    if (difficulty === 'beginner') {
      templateContext.safeDrop = 'less populated areas on the map edge';
    } else if (difficulty === 'intermediate') {
      templateContext.brStrategy = 'rotating early and positioning for the final circles';
    } else if (difficulty === 'advanced') {
      templateContext.advancedBr = 'mastering hot drops and end-game positioning';
    }
  }

  return templateContext;
}


/**
 * Generate quick tips based on current question
 * Phase 3 Step 2: Enhanced Personalized Tips - Quick Tips
 */
async function generateQuickTips(
  currentQuestion?: string,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): Promise<string[]> {
  const tips: string[] = [];

  if (!currentQuestion) {
    return tips;
  }

  const questionLower = currentQuestion.toLowerCase();
  const category = context?.questionCategory;
  const difficulty = context?.difficultyHint;
  const detectedGame = context?.detectedGame; // Only use if validated by extractQuestionContext

  // Quick tips based on question category - natural, conversational language
  // Include game name when available (only if detectedGame is validated)
  if (category === 'boss_fight') {
    if (detectedGame) {
      tips.push(`💡 Quick tip: In ${detectedGame}, most bosses follow predictable attack patterns. Watch for 2-3 distinct moves and learn their timing.`);
      tips.push(`⚡ Pro tip: Save your strongest attacks for when the boss is vulnerable or stunned in ${detectedGame} for maximum damage.`);
    } else {
      tips.push('💡 Quick tip: Most bosses follow predictable attack patterns. Watch for 2-3 distinct moves and learn their timing.');
      tips.push('⚡ Pro tip: Save your strongest attacks for when the boss is vulnerable or stunned for maximum damage.');
    }
  } else if (category === 'strategy') {
    if (detectedGame) {
      tips.push(`💡 Quick tip: In ${detectedGame}, test new builds in safe areas first before taking on challenging content.`);
      tips.push(`⚡ Pro tip: Keep an eye on patch notes for ${detectedGame} - meta builds can change significantly with game updates.`);
    } else {
      tips.push('💡 Quick tip: Test new builds in safe areas first before taking on challenging content.');
      tips.push('⚡ Pro tip: Keep an eye on patch notes - meta builds can change significantly with game updates.');
    }
  } else if (category === 'level_walkthrough') {
    if (detectedGame) {
      tips.push(`💡 Quick tip: In ${detectedGame}, check your map regularly. Many secrets are marked but easy to overlook.`);
      tips.push(`⚡ Pro tip: Don't skip NPCs in ${detectedGame} - they often drop hints about hidden locations and collectibles.`);
    } else {
      tips.push('💡 Quick tip: Check your map regularly. Many secrets are marked but easy to overlook.');
      tips.push('⚡ Pro tip: Don\'t skip NPCs - they often drop hints about hidden locations and collectibles.');
    }
  } else if (category === 'item_lookup') {
    if (detectedGame) {
      tips.push(`💡 Quick tip: In ${detectedGame}, item locations can vary between game versions, so check multiple sources if something doesn't match.`);
      tips.push(`⚡ Pro tip: Some items in ${detectedGame} are missable. Save before important story moments to avoid missing out.`);
    } else {
      tips.push('💡 Quick tip: Item locations can vary between game versions, so check multiple sources if something doesn\'t match.');
      tips.push('⚡ Pro tip: Some items are missable. Save before important story moments to avoid missing out.');
    }
  } else if (category === 'achievement') {
    if (detectedGame) {
      tips.push(`💡 Quick tip: For ${detectedGame}, plan your achievement route ahead of time to minimize backtracking.`);
      tips.push(`⚡ Pro tip: Some achievements in ${detectedGame} require multiple playthroughs, so plan your approach accordingly.`);
    } else {
      tips.push('💡 Quick tip: Plan your achievement route ahead of time to minimize backtracking.');
      tips.push('⚡ Pro tip: Some achievements require multiple playthroughs, so plan your approach accordingly.');
    }
  }

  // Quick tips based on difficulty - natural language
  if (difficulty === 'beginner') {
    if (detectedGame) {
      tips.push(`📚 Quick tip: Don't rush through ${detectedGame}. Take your time to understand the core mechanics - it'll pay off later.`);
    } else {
      tips.push('📚 Quick tip: Don\'t rush through the game. Take your time to understand the core mechanics - it\'ll pay off later.');
    }
  } else if (difficulty === 'advanced') {
    if (detectedGame) {
      tips.push(`⚡ Quick tip: Study speedrun techniques and route optimizations for ${detectedGame} for ideas on how to improve your gameplay.`);
    } else {
      tips.push('⚡ Quick tip: Study speedrun techniques and route optimizations for ideas on how to improve your gameplay.');
    }
  }

  // Quick tips based on question keywords - conversational
  if (questionLower.includes('how to') || questionLower.includes('best way')) {
    if (detectedGame) {
      tips.push(`💡 Quick tip: In ${detectedGame}, there's usually multiple ways to approach challenges. Don't be afraid to experiment and find what works for you!`);
    } else {
      tips.push('💡 Quick tip: There\'s usually multiple ways to approach challenges. Don\'t be afraid to experiment and find what works for you!');
    }
  }
  if (questionLower.includes('stuck') || questionLower.includes('can\'t')) {
    if (detectedGame) {
      tips.push(`💡 Quick tip: If you're stuck in ${detectedGame}, take a short break and come back with fresh eyes. Sometimes a new perspective is all you need.`);
    } else {
      tips.push('💡 Quick tip: If you\'re stuck, take a short break and come back with fresh eyes. Sometimes a new perspective is all you need.');
    }
  }

  return tips;
}

/**
 * Generate insights about playing style
 * Phase 3 Step 2: Enhanced Personalized Tips - Playstyle Insights
 */
function generatePlaystyleInsights(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any
): string[] {
  const insights: string[] = [];
  const playstyleTags = preferences?.playstyleTags || [];
  const explorationDepth = patterns.behavior.explorationDepth;
  const learningSpeed = patterns.behavior.learningSpeed;
  const topQuestionType = patterns.behavior.questionTypes[0];
  const genreDiversity = patterns.genreAnalysis.genreDiversity;

  // Priority 1: Question pattern insights (most relevant to current question)
  // Skip if we'll have a redundant playstyle tag insight
  if (topQuestionType?.category === 'boss_fight') {
    insights.push('💪 Insight: You focus on challenging content and enjoy overcoming difficult obstacles. This shows you\'re not afraid to push your limits and learn from tough encounters.');
  } else if (topQuestionType?.category === 'strategy') {
    // Only add if not already covered by strategist tag
    if (!playstyleTags.includes('strategist')) {
      insights.push('📊 Insight: You focus on optimization and enjoy perfecting your approach. This suggests you value efficiency and are always looking for ways to improve your gameplay.');
    }
  } else if (topQuestionType?.category === 'achievement') {
    // Only add if not already covered by completionist tag (they're very similar)
    if (!playstyleTags.includes('completionist')) {
      insights.push('🏅 Insight: You focus on completion and enjoy achieving 100% completion. This shows you have a methodical approach and appreciate the satisfaction of finishing everything a game has to offer.');
    }
  }

  // Priority 2: Playstyle tag insights (one per tag, avoid redundancy)
  // Only add one insight per playstyle tag to avoid repetition
  if (playstyleTags.includes('completionist')) {
    insights.push('🏆 Insight: You\'re a completionist at heart. You enjoy thorough exploration and achievement hunting, which shows your dedication to fully experiencing every game you play.');
  }
  if (playstyleTags.includes('strategist')) {
    insights.push('⚔️ Insight: You\'re a natural strategist. You enjoy optimizing builds and analyzing game mechanics, which means you likely spend time theorycrafting and planning your approach before diving in.');
  }
  if (playstyleTags.includes('explorer')) {
    // Only show explorer insight if not already covered by explorationDepth or completionist
    if (explorationDepth <= 0.7 && !playstyleTags.includes('completionist')) {
      insights.push('🗺️ Insight: You\'re an explorer by nature. You enjoy discovering new areas and secrets, which suggests you take your time to fully appreciate the worlds developers create.');
    }
  }

  // Priority 3: Exploration depth (only if not already covered by playstyle tags)
  // Skip if we already have an explorer/completionist insight to avoid redundancy
  if (!playstyleTags.includes('explorer') && !playstyleTags.includes('completionist')) {
    if (explorationDepth > 0.7) {
      insights.push('🌟 Insight: You enjoy discovering secrets and hidden areas, which shows a thorough approach to gaming.');
    } else if (explorationDepth < 0.3) {
      insights.push('🎯 Insight: You prefer focused, goal-oriented gameplay. Consider trying more exploration for variety - you might discover new favorite aspects of games.');
    }
  }

  // Priority 4: Learning speed
  if (learningSpeed === 'fast') {
    insights.push('🚀 Insight: You learn quickly and adapt well to new challenges. You\'re ready to tackle advanced techniques and push your skills further.');
  } else if (learningSpeed === 'slow') {
    insights.push('📖 Insight: You prefer taking your time to fully understand game mechanics. This methodical approach often leads to deeper understanding and mastery.');
  }

  // Priority 5: Genre diversity (only if we don't have many insights yet)
  if (insights.length < 3) {
    if (genreDiversity > 0.7) {
      insights.push('🎲 Insight: You have diverse gaming interests and enjoy exploring different genres. This versatility means you\'re open to new experiences and can adapt to various gameplay styles.');
    } else if (genreDiversity < 0.3) {
      insights.push('🎯 Insight: You prefer focusing on specific genres, which shows you know what you like. Consider branching out occasionally - you might discover new favorite aspects of gaming you didn\'t know existed.');
    }
  }

  // Limit to 3-4 insights max to avoid redundancy
  return insights.slice(0, 4);
}

/**
 * Generate optimization suggestions
 * Phase 3 Step 2: Enhanced Personalized Tips - Optimization Suggestions
 * Now context-aware: filters tips based on game features (achievements, multiplayer, etc.)
 */
async function generateOptimizationSuggestions(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): Promise<string[]> {
  const suggestions: string[] = [];
  const currentLevel = patterns.difficulty.currentLevel;
  const topGenre = patterns.genreAnalysis.topGenres[0]?.genre || '';
  const playstyleTags = preferences?.playstyleTags || [];
  const topQuestionType = patterns.behavior.questionTypes[0];
  const detectedGame = context?.detectedGame;
  const detectedGenres = context?.detectedGenre || [];
  const detectedPlatform = context?.detectedPlatform;

  // Check if game has achievements (async)
  const hasAchievementSystem = await hasAchievements(detectedGenres, detectedGame, detectedPlatform);

  // Check if game is multiplayer/competitive
  const isMultiplayer = isMultiplayerGame(detectedGenres);

  // Optimization suggestions based on difficulty level - natural language
  // Only add one per difficulty level to avoid redundancy
  if (currentLevel === 'intermediate') {
    // Only mention "meta builds" for multiplayer/competitive games
    if (isMultiplayer) {
      suggestions.push('⚡ Optimization: Study meta builds and optimal strategies for your favorite games to take your gameplay to the next level.');
    } else {
      suggestions.push('⚡ Optimization: Study optimal strategies and techniques for your favorite games to take your gameplay to the next level.');
    }
  } else if (currentLevel === 'advanced') {
    suggestions.push('🔥 Optimization: Focus on mastering frame-perfect techniques and route optimization to maximize your efficiency.');
  }

  // Optimization suggestions based on genre
  if (topGenre.includes('rpg') || topGenre.includes('RPG')) {
    suggestions.push('⚔️ Optimization: Focus on stat allocation and gear synergies for optimal builds');
  } else if (topGenre.includes('shooter') || topGenre.includes('action')) {
    suggestions.push('🎯 Optimization: Master weapon recoil patterns and optimal loadouts');
  } else if (topGenre.includes('strategy') || topGenre.includes('Strategy')) {
    suggestions.push('📊 Optimization: Learn optimal build orders and resource management');
  }

  // Optimization suggestions based on playstyle (only if not already covered)
  if (playstyleTags.includes('strategist') && topQuestionType?.category !== 'strategy') {
    // Only mention "build optimization" for games that have builds (RPGs, strategy games)
    if (topGenre.includes('rpg') || topGenre.includes('RPG') || topGenre.includes('strategy') || topGenre.includes('Strategy')) {
      suggestions.push('📈 Optimization: Deep dive into theorycrafting and build optimization');
    } else {
      suggestions.push('📈 Optimization: Deep dive into theorycrafting and strategy optimization');
    }
  }
  // Only show achievement-related optimization if the game has achievements
  if (playstyleTags.includes('completionist') && hasAchievementSystem) {
    suggestions.push('🏆 Optimization: Plan efficient routes for achievement hunting and completion');
  } else if (playstyleTags.includes('completionist')) {
    // For completionists in games without achievements, suggest completion-focused tips
    suggestions.push('🏆 Optimization: Plan efficient routes for thorough exploration and completion');
  }

  // Optimization suggestions based on question patterns (only if not already covered by playstyle)
  if (topQuestionType?.category === 'strategy' && !playstyleTags.includes('strategist')) {
    // Only mention "builds" for games that have builds
    if (topGenre.includes('rpg') || topGenre.includes('RPG') || topGenre.includes('strategy') || topGenre.includes('Strategy')) {
      suggestions.push('⚔️ Optimization: Experiment with different builds to find optimal combinations');
    } else {
      suggestions.push('⚔️ Optimization: Experiment with different strategies to find optimal approaches');
    }
  }
  if (topQuestionType?.category === 'boss_fight') {
    suggestions.push('💪 Optimization: Study boss patterns and optimize your approach for each phase');
  }

  // Remove semantically similar suggestions
  const uniqueSuggestions: string[] = [];
  for (const suggestion of suggestions) {
    // Extract the core message (remove emoji and "Optimization:" prefix)
    const coreMessage = suggestion.replace(/^[^\s]+\s+Optimization:\s*/i, '').toLowerCase();

    // Check if this suggestion is too similar to any existing one
    const isSimilar = uniqueSuggestions.some(existing => {
      const existingCore = existing.replace(/^[^\s]+\s+Optimization:\s*/i, '').toLowerCase();

      // Check for key overlapping words (more than 3 shared meaningful words = similar)
      const suggestionWords = coreMessage.split(/\s+/).filter(w => w.length > 4);
      const existingWords = existingCore.split(/\s+/).filter(w => w.length > 4);
      const sharedWords = suggestionWords.filter(w => existingWords.includes(w));

      // If they share many key words, they're likely redundant
      if (sharedWords.length >= 2) {
        return true;
      }

      // Also check for very similar phrasing
      const similarity = sharedWords.length / Math.max(suggestionWords.length, existingWords.length);
      return similarity > 0.5;
    });

    if (!isSimilar) {
      uniqueSuggestions.push(suggestion);
    }
  }

  return uniqueSuggestions;
}

/**
 * Check if a game is multiplayer/competitive based on genres
 * Multiplayer games typically have genres like: MMO, Battle Royale, MOBA, etc.
 */
function isMultiplayerGame(detectedGenres?: string[]): boolean {
  if (!detectedGenres || detectedGenres.length === 0) {
    return false;
  }

  const multiplayerKeywords = [
    'mmo', 'massively multiplayer', 'multiplayer online',
    'battle royale', 'battle-royale', 'moba',
    'multiplayer online battle arena', 'competitive',
    'online', 'multiplayer', 'pvp', 'player vs player'
  ];

  const genreString = detectedGenres.join(' ').toLowerCase();
  return multiplayerKeywords.some(keyword => genreString.includes(keyword));
}

/**
 * Generate common mistakes to avoid
 * Phase 3 Step 2: Enhanced Personalized Tips - Common Mistakes
 * Now context-aware: filters tips based on game features (achievements, multiplayer, etc.)
 */
async function generateCommonMistakes(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): Promise<string[]> {
  const mistakes: string[] = [];
  const currentLevel = patterns.difficulty.currentLevel;
  const topQuestionType = patterns.behavior.questionTypes[0];
  const category = context?.questionCategory;
  const playstyleTags = preferences?.playstyleTags || [];
  const detectedGame = context?.detectedGame;
  const detectedGenres = context?.detectedGenre || [];
  const detectedPlatform = context?.detectedPlatform;

  // Check if game has achievements (async)
  const hasAchievementSystem = await hasAchievements(detectedGenres, detectedGame, detectedPlatform);

  // Check if game is multiplayer/competitive
  const isMultiplayer = isMultiplayerGame(detectedGenres);

  // Common mistakes based on difficulty level
  if (currentLevel === 'beginner') {
    mistakes.push('⚠️ Avoid: Rushing through tutorials - take time to understand mechanics');
    mistakes.push('⚠️ Avoid: Ignoring game tips and hints - they\'re there to help you');
    mistakes.push('⚠️ Avoid: Skipping difficulty settings - start at appropriate level');
  } else if (currentLevel === 'intermediate') {
    mistakes.push('⚠️ Avoid: Sticking to one strategy - experiment with different approaches');
    // Only show meta/balance update tip for multiplayer/competitive games
    if (isMultiplayer) {
      mistakes.push('⚠️ Avoid: Ignoring meta changes - game balance updates affect optimal strategies');
    }
  } else if (currentLevel === 'advanced') {
    mistakes.push('⚠️ Avoid: Over-optimizing too early - sometimes fun > efficiency');
    mistakes.push('⚠️ Avoid: Ignoring fundamentals - advanced techniques build on basics');
  }

  // Common mistakes based on question category
  if (category === 'boss_fight' || topQuestionType?.category === 'boss_fight') {
    mistakes.push('⚠️ Avoid: Being too aggressive - learn patterns before going all-out');
    mistakes.push('⚠️ Avoid: Not adapting to phase changes - bosses often have multiple phases');
  }
  if (category === 'strategy' || topQuestionType?.category === 'strategy') {
    mistakes.push('⚠️ Avoid: Copying builds blindly - understand why they work');
    mistakes.push('⚠️ Avoid: Ignoring your playstyle - optimal builds should match how you play');
  }
  // Only show achievement-related mistakes if the game has achievements
  if ((category === 'achievement' || topQuestionType?.category === 'achievement') && hasAchievementSystem) {
    mistakes.push('⚠️ Avoid: Missing missable achievements - check guides before starting');
    mistakes.push('⚠️ Avoid: Not planning routes - backtracking wastes time');
  }

  // Common mistakes based on playstyle
  if (playstyleTags.includes('completionist')) {
    mistakes.push('⚠️ Avoid: Burning out on completion - take breaks between long sessions');
  }
  if (playstyleTags.includes('strategist')) {
    mistakes.push('⚠️ Avoid: Over-analyzing - sometimes action > theory');
  }

  // Common mistakes based on learning speed
  if (patterns.behavior.learningSpeed === 'fast') {
    mistakes.push('⚠️ Avoid: Skipping fundamentals - even fast learners need solid basics');
  } else if (patterns.behavior.learningSpeed === 'slow') {
    mistakes.push('⚠️ Avoid: Comparing yourself to others - everyone learns at their own pace');
  }

  return mistakes;
}

/**
 * Generate personalized tips based on user's playstyle
 * Phase 3 Step 2: Enhanced Personalized Tips
 * Includes: quick tips, playstyle insights, optimization suggestions, common mistakes
 * 
 * @param username - Username to generate tips for
 * @param currentQuestion - Optional current question for context
 * @param patterns - Optional pre-calculated patterns (to avoid duplicate analysis)
 */
export const generatePersonalizedTips = async (
  username: string,
  currentQuestion?: string,
  patterns?: Awaited<ReturnType<typeof analyzeGameplayPatterns>>
): Promise<{
  tips: string[];
  basedOn: string;
}> => {
  try {
    const user = await User.findOne({ username }).lean() as any;

    if (!user || !user?.progress?.personalized) {
      // Even without stored data, we can provide quick tips from current question
      if (currentQuestion) {
        const context = await extractQuestionContext(currentQuestion);
        const quickTips = await generateQuickTips(currentQuestion, context);
        if (quickTips.length > 0) {
          return {
            tips: quickTips.slice(0, 3),
            basedOn: 'Your current question',
          };
        }
      }

      return {
        tips: [],
        basedOn: 'No personalized data available',
      };
    }

    const preferences = user.progress.personalized.preferenceProfile;
    const storedPatterns = user.progress.personalized.gameplayPatterns;
    const tips: string[] = [];

    // Use provided patterns if available (to avoid duplicate analysis), otherwise calculate fresh
    // If called from generatePersonalizedRecommendations, patterns are already calculated
    // If called standalone, calculate fresh patterns for accurate insights
    const freshPatterns = patterns || await analyzeGameplayPatterns(username, true); // forceRefresh=true for fresh analysis
    const context = currentQuestion ? await extractQuestionContext(currentQuestion) : undefined;

    // 1. Quick tips based on current question
    const quickTips = await generateQuickTips(currentQuestion, context);
    tips.push(...quickTips);

    // 2. Insights about their playing style
    const playstyleInsights = generatePlaystyleInsights(freshPatterns, preferences);
    tips.push(...playstyleInsights);

    // 3. Optimization suggestions
    const optimizationSuggestions = await generateOptimizationSuggestions(freshPatterns, preferences, context);
    tips.push(...optimizationSuggestions);

    // 4. Common mistakes to avoid
    const commonMistakes = await generateCommonMistakes(freshPatterns, preferences, context);
    tips.push(...commonMistakes);

    // Fallback: Basic tips if no specific tips generated
    if (tips.length === 0) {
      // Tips based on learning style
      if (preferences?.learningStyle === 'tactical') {
        tips.push('💡 Try focusing on strategy guides and build optimization for deeper understanding');
      } else if (preferences?.learningStyle === 'exploratory') {
        tips.push('🗺️ Explore different game genres to expand your gaming horizons');
      }

      // Tips based on difficulty preference
      if (preferences?.difficultyPreference === 'prefers_challenge') {
        tips.push('🎯 Consider trying speedrun challenges or achievement hunting for extra difficulty');
      } else if (preferences?.difficultyPreference === 'casual') {
        tips.push('🎮 Focus on story-driven games and exploration for a more relaxed experience');
      }

      // Tips based on session frequency
      // Note: sessionPattern is in patterns.frequency, not patterns.sessionFrequency
      const sessionPattern = freshPatterns?.frequency?.sessionPattern;
      if (sessionPattern === 'daily') {
        tips.push('📅 You\'re very active! Consider setting gaming goals to track your progress');
      } else if (sessionPattern === 'sporadic') {
        tips.push('⏰ Try shorter gaming sessions with focused objectives');
      }
    }

    // Remove duplicates and semantically similar tips
    const uniqueTips: string[] = [];
    for (const tip of tips) {
      // Check if this tip is already in the list (exact match)
      if (uniqueTips.includes(tip)) {
        continue;
      }

      // Check for semantic similarity (similar meaning even if different wording)
      const tipCore = tip.replace(/^[^\s]+\s+(?:Insight|Optimization|Quick tip|Pro tip|Avoid):\s*/i, '').toLowerCase();
      const isSimilar = uniqueTips.some(existing => {
        const existingCore = existing.replace(/^[^\s]+\s+(?:Insight|Optimization|Quick tip|Pro tip|Avoid):\s*/i, '').toLowerCase();

        // Extract meaningful words (length > 4)
        const tipWords = tipCore.split(/\s+/).filter(w => w.length > 4 && !['this', 'that', 'your', 'you\'re', 'which', 'shows'].includes(w));
        const existingWords = existingCore.split(/\s+/).filter(w => w.length > 4 && !['this', 'that', 'your', 'you\'re', 'which', 'shows'].includes(w));

        // Count shared meaningful words
        const sharedWords = tipWords.filter(w => existingWords.includes(w));

        // If they share many key words, they're likely redundant
        // For insights about completion/completionist, be more strict
        if (tipCore.includes('completion') && existingCore.includes('completion')) {
          return sharedWords.length >= 2; // More strict for completion-related
        }

        // For optimization tips, check for similar concepts
        if (tipCore.includes('optimization') || tipCore.includes('optimize') || tipCore.includes('improve')) {
          if (existingCore.includes('optimization') || existingCore.includes('optimize') || existingCore.includes('improve')) {
            // Check if they're about the same concept (builds, strategies, playstyle)
            const tipConcepts = ['build', 'strategy', 'playstyle', 'meta', 'technique', 'approach'];
            const existingConcepts = ['build', 'strategy', 'playstyle', 'meta', 'technique', 'approach'];
            const sharedConcepts = tipConcepts.filter(c => tipCore.includes(c) && existingCore.includes(c));
            if (sharedConcepts.length >= 1 && sharedWords.length >= 2) {
              return true; // Similar optimization concepts
            }
          }
        }

        // General similarity check: if they share 3+ meaningful words, likely redundant
        return sharedWords.length >= 3;
      });

      if (!isSimilar) {
        uniqueTips.push(tip);
      }
    }

    // Generate basedOn description - more natural wording
    const basedOnParts: string[] = [];

    // Build natural description
    if (preferences?.learningStyle && preferences?.difficultyPreference) {
      // Format: "Your [learningStyle] style and [difficultyPreference] preferences"
      const styleLabel = preferences.learningStyle === 'tactical' ? 'tactical' :
        preferences.learningStyle === 'exploratory' ? 'exploratory' :
          'gaming';
      const difficultyLabel = preferences.difficultyPreference === 'prefers_challenge' ? 'challenge-seeking' :
        preferences.difficultyPreference === 'casual' ? 'casual' :
          preferences.difficultyPreference === 'balanced' ? 'balanced' : '';

      if (currentQuestion) {
        basedOnParts.push(`Your ${styleLabel} style, ${difficultyLabel} preferences, and current question`);
      } else {
        basedOnParts.push(`Your ${styleLabel} style and ${difficultyLabel} preferences`);
      }
    } else if (preferences?.learningStyle) {
      const styleLabel = preferences.learningStyle === 'tactical' ? 'tactical' :
        preferences.learningStyle === 'exploratory' ? 'exploratory' :
          'gaming';
      if (currentQuestion) {
        basedOnParts.push(`Your ${styleLabel} style and current question`);
      } else {
        basedOnParts.push(`Your ${styleLabel} style`);
      }
    } else if (preferences?.difficultyPreference) {
      const difficultyLabel = preferences.difficultyPreference === 'prefers_challenge' ? 'challenge-seeking' :
        preferences.difficultyPreference === 'casual' ? 'casual' :
          preferences.difficultyPreference === 'balanced' ? 'balanced' : '';
      if (currentQuestion) {
        basedOnParts.push(`Your ${difficultyLabel} preferences and current question`);
      } else {
        basedOnParts.push(`Your ${difficultyLabel} preferences`);
      }
    } else if (currentQuestion) {
      basedOnParts.push('Your current question and gaming patterns');
    } else {
      basedOnParts.push('Your gaming style and preferences');
    }

    const basedOn = basedOnParts[0] || 'Your gaming preferences';

    return {
      tips: uniqueTips.slice(0, 8),
      basedOn,
    };
  } catch (error) {
    console.error('[Recommendations] Error generating personalized tips:', error);
    return {
      tips: [],
      basedOn: 'Error generating tips',
    };
  }
};

// ============================================================================
// Phase 3 Step 1: Main Recommendation Engine - Helper Functions
// ============================================================================

/**
 * Extract context from current question for recommendation personalization
 * Returns simplified context object with key information
 */
/**
 * Fetch game genres and gameplay tags from RAWG API for a detected game
 * This ensures we have genre information even if the question doesn't mention genre keywords
 * Also includes gameplay-specific tags (like "run-and-gun", "boss-fight") for better context
 */
async function fetchGameGenresFromRAWG(gameTitle: string): Promise<string[]> {
  try {
    const axios = (await import('axios')).default;
    const searchUrl = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(gameTitle)}&page_size=1`;

    const searchResponse = await axios.get(searchUrl);
    if (!searchResponse.data?.results || searchResponse.data.results.length === 0) {
      return [];
    }

    const game = searchResponse.data.results[0];
    if (!game.id) {
      return [];
    }

    // Get detailed game info including tags (for gameplay style)
    const detailUrl = `https://api.rawg.io/api/games/${game.id}?key=${process.env.RAWG_API_KEY}`;
    const detailResponse = await axios.get(detailUrl);
    const gameDetails = detailResponse.data;

    // Get genres (slugs)
    const genreSlugs = gameDetails.genres?.map((g: any) => g.slug).filter(Boolean) || [];
    const genreNames = gameDetails.genres?.map((g: any) => g.name).filter(Boolean) || [];

    // Get gameplay-specific tags (filter out generic tags)
    const allTags = gameDetails.tags?.map((t: any) => t.slug).filter(Boolean) || [];
    const genericTags = [
      'singleplayer', 'multiplayer', 'co-op', 'online-co-op', 'local-co-op',
      'steam-achievements', 'steam-cloud', 'steam-trading-cards', 'steam-workshop',
      'full-controller-support', 'partial-controller-support',
      'great-soundtrack', 'atmospheric', 'story-rich', 'narrative',
      'indie', 'free-to-play', 'early-access', 'vr', 'vr-supported',
      'mods', 'moddable', 'level-editor', 'cross-platform-multiplayer',
      'cooperative', '2d', 'funny', 'difficult', 'retro' // These are too generic
    ];

    // Keep only gameplay-specific tags that indicate game mechanics/style
    const gameplayTags = allTags.filter((tag: string) => {
      if (genericTags.includes(tag)) return false;

      // Include tags that clearly indicate gameplay mechanics
      // These are specific gameplay styles, not just descriptive words
      const gameplayStyleTags = [
        'run-and-gun', 'shoot-em-up', 'shmup', 'bullet-hell', 'boss-fight', 'boss-battle',
        'roguelike', 'rogue-lite', 'metroidvania', 'souls-like', 'soulslike',
        'tactical', 'turn-based', 'real-time-strategy', 'rts', 'tower-defense',
        'puzzle-platformer', 'action-rpg', 'hack-and-slash', 'beat-em-up',
        'racing', 'fighting', 'fighting-game', 'platformer', 'adventure',
        'survival', 'survival-horror', 'stealth', 'stealth-action',
        'open-world', 'sandbox', 'simulation', 'city-builder', 'tycoon'
      ];

      // Check for exact matches or partial matches with gameplay keywords
      const isGameplayStyle = gameplayStyleTags.some(styleTag => tag === styleTag || tag.includes(styleTag));

      // Also check for compound tags that include gameplay keywords
      const gameplayKeywords = ['run', 'gun', 'boss', 'fight', 'bullet', 'hell', 'shoot', 'shmup',
        'rogue', 'metroid', 'souls', 'tactical', 'strategy', 'rts',
        'puzzle', 'platform', 'racing', 'fighting', 'rpg', 'adventure',
        'survival', 'stealth', 'sandbox', 'simulation'];
      const hasGameplayKeyword = gameplayKeywords.some(keyword => tag.includes(keyword));

      return isGameplayStyle || hasGameplayKeyword;
    });

    // Combine genres and gameplay tags
    const allGenres = [...genreSlugs, ...gameplayTags.slice(0, 3)]; // Limit gameplay tags to top 3

    console.log(`[extractQuestionContext] Fetched genres for "${gameTitle}":`, {
      slugs: genreSlugs,
      names: genreNames,
      gameplayTags: gameplayTags.slice(0, 5),
      combined: allGenres,
    });

    return allGenres;
  } catch (error) {
    console.error(`[extractQuestionContext] Error fetching genres for "${gameTitle}":`, error);
    return [];
  }
}

/**
 * Extract platform from question if mentioned
 * Returns platform name if detected, undefined otherwise
 */
function extractPlatformFromQuestion(question: string): string | undefined {
  const lowerQuestion = question.toLowerCase();

  // Platform keywords
  const platformPatterns: { [key: string]: string[] } = {
    'nintendo switch': ['switch', 'nintendo switch 2', 'nsw'],
    'nintendo 64': ['n64', 'nintendo 64'],
    'playstation 5': ['ps5', 'playstation 5'],
    'playstation 4': ['ps4', 'playstation 4'],
    'playstation 3': ['ps3', 'playstation 3'],
    'xbox series x': ['xbox series x', 'xsx'],
    'xbox series s': ['xbox series s', 'xss'],
    'xbox one': ['xbox one'],
    'xbox 360': ['xbox 360'],
    'pc': ['pc', 'steam', 'epic', 'gog'],
    'wii u': ['wii u'],
    'wii': ['wii'],
    'gamecube': ['gamecube', 'game cube'],
  };

  for (const [platform, keywords] of Object.entries(platformPatterns)) {
    if (keywords.some(keyword => lowerQuestion.includes(keyword))) {
      return platform;
    }
  }

  return undefined;
}

async function extractQuestionContext(question: string): Promise<{
  detectedGame?: string;
  detectedGenre?: string[];
  questionCategory?: string;
  difficultyHint?: string;
  interactionType?: string;
  detectedPlatform?: string;
}> {
  try {
    // console.log('[extractQuestionContext] Starting extraction for question:', question.substring(0, 100));

    // Import checkQuestionType function for genre detection
    const { analyzeUserQuestions } = await import('./aiHelper');

    // Use existing extractQuestionMetadata function with genre detection
    // Pass a simple genre detection function based on analyzeUserQuestions
    const checkQuestionTypeFn = (q: string) => {
      // Simple genre detection - analyzeUserQuestions expects array of {question, response}
      // For single question, we'll use a simplified approach
      const genres = analyzeUserQuestions([{ question: q, response: '' }]);
      return genres;
    };

    // console.log('[extractQuestionContext] Calling extractQuestionMetadata...');
    const metadata = await extractQuestionMetadata(question, checkQuestionTypeFn);
    // console.log('[extractQuestionContext] extractQuestionMetadata returned:', {
    //   hasDetectedGame: !!metadata.detectedGame,
    //   detectedGame: metadata.detectedGame,
    //   hasQuestionCategory: !!metadata.questionCategory,
    //   questionCategory: metadata.questionCategory,
    //   hasDetectedGenre: !!metadata.detectedGenre,
    //   detectedGenre: metadata.detectedGenre,
    //   hasDifficultyHint: !!metadata.difficultyHint,
    //   difficultyHint: metadata.difficultyHint,
    // });

    // Validate detectedGame - ensure it's a non-empty string
    const validDetectedGame = metadata.detectedGame &&
      typeof metadata.detectedGame === 'string' &&
      metadata.detectedGame.trim().length > 0
      ? metadata.detectedGame.trim()
      : undefined;

    // If we detected a game but no genres, fetch genres from RAWG API
    let detectedGenres = metadata.detectedGenre;
    if (validDetectedGame && (!detectedGenres || detectedGenres.length === 0)) {
      // console.log(`[extractQuestionContext] No genres detected from question, fetching from RAWG for "${validDetectedGame}"...`);
      const apiGenres = await fetchGameGenresFromRAWG(validDetectedGame);
      if (apiGenres.length > 0) {
        detectedGenres = apiGenres;
        // console.log(`[extractQuestionContext] Fetched ${apiGenres.length} genres from RAWG:`, apiGenres);
      }
    }

    // Extract platform from question if mentioned
    const detectedPlatform = extractPlatformFromQuestion(question);

    const result = {
      detectedGame: validDetectedGame,
      detectedGenre: detectedGenres,
      questionCategory: metadata.questionCategory,
      difficultyHint: metadata.difficultyHint,
      interactionType: metadata.interactionType,
      detectedPlatform,
    };

    // console.log('[extractQuestionContext] Returning context:', {
    //   hasDetectedGame: !!result.detectedGame,
    //   detectedGame: result.detectedGame || 'undefined',
    //   hasQuestionCategory: !!result.questionCategory,
    //   questionCategory: result.questionCategory,
    //   hasDetectedGenre: !!result.detectedGenre && result.detectedGenre.length > 0,
    //   detectedGenre: result.detectedGenre,
    // });

    return result;
  } catch (error) {
    console.error('[Recommendations] Error extracting question context:', error);
    if (error instanceof Error) {
      console.error('[Recommendations] Error stack:', error.stack);
    }
    return {};
  }
}

/**
 * Generate personalized loadout suggestions based on genre, difficulty, and playstyle
 * Phase 4 Step 1: Enhanced with Template System Integration
 * Uses template system for natural, personalized strategy tips
 */
function generateLoadoutSuggestions(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  context: Awaited<ReturnType<typeof extractQuestionContext>>,
  preferences?: any
): string[] {
  const suggestions: string[] = [];
  const topGenre = patterns.genreAnalysis.topGenres[0]?.genre || '';
  const difficulty = context.difficultyHint || patterns.difficulty.currentLevel;
  const detectedGame = context?.detectedGame; // Only use if validated by extractQuestionContext

  // Map genre to template key
  const genreKey = mapGenreToTemplateKey(topGenre);

  // Build template context from patterns and preferences
  const templateContext = buildTemplateContext(patterns, context, preferences);

  // Generate template-based suggestions for supported genres
  // Templates are available for: rpg, shooter, strategy, action, adventure, platformer, puzzle, fighting, racing, sports
  if (genreKey) {
    const templateTip = getPersonalizedStrategyTip(genreKey, difficulty, templateContext);

    if (templateTip && !templateTip.includes('[')) { // Only add if no unfilled placeholders
      // Add appropriate emoji based on genre
      const emojiMap: { [key: string]: string } = {
        'rpg': '⚔️',
        'shooter': '🔫',
        'strategy': '📊',
        'action': '⚔️',
        'adventure': '🗺️',
        'platformer': '🎮',
        'puzzle': '🧩',
        'fighting': '👊',
        'racing': '🏎️',
        'sports': '⚽',
        'survival': '🪓',
        'horror': '👻',
        'stealth': '🥷',
        'simulation': '🏭',
        'roguelike': '💀',
        'sandbox': '🧱',
        'battle-royale': '🎯',
        'battleroyale': '🎯',
        'visual novel': '🎥',
        'point and click': '🖱️',
      };
      const emoji = emojiMap[genreKey] || '💡';
      // Include game name in template tip if available
      if (detectedGame) {
        suggestions.push(`${emoji} In ${detectedGame}, ${templateTip}`);
      } else {
        suggestions.push(`${emoji} ${templateTip}`);
      }
    }
  }

  // Add genre-specific additional suggestions that complement templates
  // These provide extra context beyond what templates can offer
  // Include game name when available

  // RPG additional suggestions
  if (genreKey === 'rpg') {
    if (difficulty === 'beginner') {
      if (detectedGame) {
        suggestions.push(`🛡️ In ${detectedGame}, prioritize health and defense stats early - survivability is key`);
      } else {
        suggestions.push('🛡️ Prioritize health and defense stats early - survivability is key');
      }
    } else if (difficulty === 'intermediate') {
      const playstyleTags = preferences?.playstyleTags || [];
      if (playstyleTags.includes('strategist')) {
        if (detectedGame) {
          suggestions.push(`🔮 In ${detectedGame}, consider hybrid builds that combine two complementary playstyles`);
        } else {
          suggestions.push('🔮 Consider hybrid builds that combine two complementary playstyles');
        }
      }
    } else if (difficulty === 'advanced') {
      if (detectedGame) {
        suggestions.push(`⚡ Look for meta builds and optimal stat allocations in ${detectedGame} for your class`);
      } else {
        suggestions.push('⚡ Look for meta builds and optimal stat allocations for your class');
      }
    }
  }

  // Shooter/Action additional suggestions
  if (genreKey === 'shooter' || genreKey === 'action') {
    if (difficulty === 'beginner') {
      if (detectedGame) {
        suggestions.push(`🛡️ In ${detectedGame}, equip armor that boosts survivability over damage`);
      } else {
        suggestions.push('🛡️ Equip armor that boosts survivability over damage');
      }
    } else if (difficulty === 'intermediate') {
      const playstyleTags = preferences?.playstyleTags || [];
      if (playstyleTags.includes('strategist')) {
        if (detectedGame) {
          suggestions.push(`⚔️ In ${detectedGame}, create weapon combinations that cover different engagement ranges`);
        } else {
          suggestions.push('⚔️ Create weapon combinations that cover different engagement ranges');
        }
      }
    } else if (difficulty === 'advanced') {
      if (detectedGame) {
        suggestions.push(`🎖️ Master weapon recoil patterns in ${detectedGame} and create loadouts that minimize weaknesses`);
      } else {
        suggestions.push('🎖️ Master weapon recoil patterns and create loadouts that minimize weaknesses');
      }
    }
  }

  // Strategy additional suggestions
  if (genreKey === 'strategy') {
    if (difficulty === 'beginner') {
      if (detectedGame) {
        suggestions.push(`⚖️ In ${detectedGame}, build a balanced army composition: mix of units for versatility`);
      } else {
        suggestions.push('⚖️ Build a balanced army composition: mix of units for versatility');
      }
    } else if (difficulty === 'intermediate') {
      if (detectedGame) {
        suggestions.push(`⚔️ In ${detectedGame}, create specialized builds for specific matchups or scenarios`);
      } else {
        suggestions.push('⚔️ Create specialized builds for specific matchups or scenarios');
      }
    } else if (difficulty === 'advanced') {
      if (detectedGame) {
        suggestions.push(`⚡ Optimize build orders and resource allocation in ${detectedGame} for maximum efficiency`);
      } else {
        suggestions.push('⚡ Optimize build orders and resource allocation for maximum efficiency');
      }
    }
  }

  // Fallback: If no template suggestions were generated, use genre-specific tips
  // Include game name when available and make tips specific to game type
  if (suggestions.length === 0 && topGenre) {
    const detectedGenres = context?.detectedGenre || [];
    const isBossRush = detectedGenres.some(g =>
      ['boss-fight', 'boss-rush', 'boss-battle'].some(tag =>
        g.toLowerCase().includes(tag.toLowerCase())
      )
    );
    const isRunAndGun = detectedGenres.some(g =>
      ['run-and-gun', 'shoot-em-up', 'bullet-hell'].some(tag =>
        g.toLowerCase().includes(tag.toLowerCase())
      )
    );

    if (difficulty === 'beginner') {
      if (detectedGame) {
        if (isBossRush || isRunAndGun) {
          suggestions.push(`💡 In ${detectedGame}, start by learning boss patterns and basic movement - survival comes first`);
        } else {
          suggestions.push(`💡 In ${detectedGame}, start with balanced approaches and learn the fundamentals`);
        }
      } else {
        if (isBossRush || isRunAndGun) {
          suggestions.push('💡 Start by learning boss patterns and basic movement - survival comes first');
        } else {
          suggestions.push('💡 Start with balanced approaches and learn the fundamentals');
        }
      }
    } else if (difficulty === 'intermediate') {
      if (detectedGame) {
        if (isBossRush || isRunAndGun) {
          suggestions.push(`⚔️ In ${detectedGame}, try different weapon combinations and charm setups to find what works best for each boss`);
        } else if (topGenre.includes('rpg') || topGenre.includes('RPG')) {
          suggestions.push(`⚔️ In ${detectedGame}, experiment with different character builds and stat allocations to find your preferred playstyle`);
        } else if (topGenre.includes('strategy') || topGenre.includes('Strategy')) {
          suggestions.push(`⚔️ In ${detectedGame}, try different unit compositions and build orders to find effective strategies`);
        } else {
          suggestions.push(`⚔️ In ${detectedGame}, experiment with different approaches to find what works best for your playstyle`);
        }
      } else {
        if (isBossRush || isRunAndGun) {
          suggestions.push('⚔️ Try different weapon combinations and charm setups to find what works best for each boss');
        } else if (topGenre.includes('rpg') || topGenre.includes('RPG')) {
          suggestions.push('⚔️ Experiment with different character builds and stat allocations to find your preferred playstyle');
        } else if (topGenre.includes('strategy') || topGenre.includes('Strategy')) {
          suggestions.push('⚔️ Try different unit compositions and build orders to find effective strategies');
        } else {
          suggestions.push('⚔️ Experiment with different approaches to find what works best for your playstyle');
        }
      }
    } else if (difficulty === 'advanced') {
      if (detectedGame) {
        if (isBossRush || isRunAndGun) {
          suggestions.push(`⚡ In ${detectedGame}, optimize your loadout and learn frame-perfect dodges for maximum efficiency`);
        } else {
          suggestions.push(`⚡ In ${detectedGame}, focus on optimization and meta strategies for maximum efficiency`);
        }
      } else {
        if (isBossRush || isRunAndGun) {
          suggestions.push('⚡ Optimize your loadout and learn frame-perfect dodges for maximum efficiency');
        } else {
          suggestions.push('⚡ Focus on optimization and meta strategies for maximum efficiency');
        }
      }
    }
  }

  return suggestions;
}

/**
 * Generate combat strategies based on question patterns
 * Phase 3 Step 2: Enhanced Strategy Tips - Combat Strategies
 * Only uses historical patterns when there's no current question context
 */
function generateCombatStrategies(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  context: Awaited<ReturnType<typeof extractQuestionContext>>
): string[] {
  const strategies: string[] = [];
  const topQuestionType = patterns.behavior.questionTypes[0];
  const category = context.questionCategory || 'general_gameplay';
  const hasCurrentQuestion = !!context.questionCategory;

  const detectedGame = context?.detectedGame; // Only use if validated by extractQuestionContext

  // Only use combat strategies based on current question context
  // When no question context, skip historical pattern-based combat strategies
  // (genre-based tips will be used instead)
  if (hasCurrentQuestion) {
    const detectedGenres = context?.detectedGenre || [];
    const isBossRush = detectedGenres.some(g =>
      ['boss-fight', 'boss-rush', 'boss-battle'].some(tag =>
        g.toLowerCase().includes(tag.toLowerCase())
      )
    );
    const isRunAndGun = detectedGenres.some(g =>
      ['run-and-gun', 'shoot-em-up', 'bullet-hell'].some(tag =>
        g.toLowerCase().includes(tag.toLowerCase())
      )
    );

    // Combat strategies based on current question category
    // Include game name when available and make tips specific to game type
    if (category === 'boss_fight') {
      if (detectedGame) {
        // For boss-rush/run-and-gun games: focus on weapon/loadout selection and pattern recognition
        if (isBossRush || isRunAndGun) {
          strategies.push(`💪 In ${detectedGame}, study each boss's attack patterns: each one has unique telegraphs and safe zones`);
          strategies.push(`⚔️ In ${detectedGame}, experiment with different weapon and charm combinations: some loadouts work better for specific bosses`);
          strategies.push(`⏱️ In ${detectedGame}, master parrying and dodge timing: these are essential for surviving bullet-hell sections`);

          if (patterns.difficulty.challengeSeeking === 'seeking_challenge') {
            strategies.push(`🔥 In ${detectedGame}, try S-rank or no-hit runs: perfect your execution for maximum challenge`);
          }
        } else {
          // For other games: more general boss fight tips
          strategies.push(`💪 In ${detectedGame}, study attack patterns: learn boss telegraphs and safe positioning`);
          strategies.push(`⏱️ Master dodge timing in ${detectedGame}: practice i-frames and perfect dodges`);
          strategies.push(`🔄 Adapt your strategy in ${detectedGame}: switch between aggressive and defensive play based on boss phase`);

          if (patterns.difficulty.challengeSeeking === 'seeking_challenge') {
            strategies.push(`🔥 Try no-hit runs in ${detectedGame}: perfect your timing for maximum challenge`);
          }
        }
      } else {
        if (isBossRush || isRunAndGun) {
          strategies.push('💪 Study each boss\'s attack patterns: each one has unique telegraphs and safe zones');
          strategies.push('⚔️ Experiment with different weapon and charm combinations: some loadouts work better for specific bosses');
          strategies.push('⏱️ Master parrying and dodge timing: these are essential for surviving bullet-hell sections');

          if (patterns.difficulty.challengeSeeking === 'seeking_challenge') {
            strategies.push('🔥 Try S-rank or no-hit runs: perfect your execution for maximum challenge');
          }
        } else {
          strategies.push('💪 Study attack patterns: learn boss telegraphs and safe positioning');
          strategies.push('⏱️ Master dodge timing: practice i-frames and perfect dodges');
          strategies.push('🔄 Adapt your strategy: switch between aggressive and defensive play based on boss phase');

          if (patterns.difficulty.challengeSeeking === 'seeking_challenge') {
            strategies.push('🔥 Try no-hit runs: perfect your timing for maximum challenge');
          }
        }
      }
    }

    if (category === 'strategy') {
      if (detectedGame) {
        strategies.push(`📊 In ${detectedGame}, analyze your playstyle: identify strengths and build around them`);
        strategies.push(`⚔️ Learn combo systems in ${detectedGame}: master attack chains and optimal rotations`);
        strategies.push(`🛡️ Balance offense and defense in ${detectedGame}: know when to be aggressive vs. defensive`);

        if (patterns.behavior.learningSpeed === 'fast') {
          strategies.push(`🚀 Experiment with advanced techniques in ${detectedGame}: frame-perfect inputs and optimization`);
        }
      } else {
        strategies.push('📊 Analyze your playstyle: identify strengths and build around them');
        strategies.push('⚔️ Learn combo systems: master attack chains and optimal rotations');
        strategies.push('🛡️ Balance offense and defense: know when to be aggressive vs. defensive');

        if (patterns.behavior.learningSpeed === 'fast') {
          strategies.push('🚀 Experiment with advanced techniques: frame-perfect inputs and optimization');
        }
      }
    }
  }

  // General combat strategies based on difficulty (only when we have a current question)
  // These are too generic for general gameplay - genre tips are better
  if (hasCurrentQuestion && patterns.difficulty.currentLevel === 'beginner') {
    if (detectedGame) {
      strategies.push(`🎯 In ${detectedGame}, focus on fundamentals: master basic attacks and movement first`);
      strategies.push(`📚 Learn enemy patterns in ${detectedGame}: observe before engaging`);
    } else {
      strategies.push('🎯 Focus on fundamentals: master basic attacks and movement first');
      strategies.push('📚 Learn enemy patterns: observe before engaging');
    }
  } else if (hasCurrentQuestion && patterns.difficulty.currentLevel === 'advanced') {
    if (detectedGame) {
      strategies.push(`⚡ Optimize DPS rotations in ${detectedGame}: maximize damage output with perfect timing`);
      strategies.push(`🎖️ Master advanced mechanics in ${detectedGame}: parries, counters, and combo extensions`);
    } else {
      strategies.push('⚡ Optimize DPS rotations: maximize damage output with perfect timing');
      strategies.push('🎖️ Master advanced mechanics: parries, counters, and combo extensions');
    }
  }

  return strategies;
}

/**
 * Check if a game is exploration-focused based on genres and tags
 * Returns true if the game has exploration mechanics, false for boss-rush/linear games
 */
function isExplorationGame(
  detectedGenres?: string[],
  questionCategory?: string
): boolean {
  if (!detectedGenres || detectedGenres.length === 0) {
    // If no genres, only show exploration tips if question is about exploration
    return questionCategory === 'level_walkthrough' || questionCategory === 'item_lookup';
  }

  // Games that are NOT exploration-focused (boss-rush, linear, arcade-style)
  const nonExplorationTags = [
    'boss-fight', 'boss-battle', 'boss-rush',
    'run-and-gun', 'shoot-em-up', 'shmup', 'bullet-hell',
    'arcade', 'fighting', 'racing', 'rhythm',
    'puzzle', 'tower-defense'
  ];

  // Check if any detected genres/tags indicate non-exploration gameplay
  const hasNonExplorationTag = detectedGenres.some(genre =>
    nonExplorationTags.some(tag =>
      genre.toLowerCase().includes(tag.toLowerCase())
    )
  );

  // Games that ARE exploration-focused
  const explorationTags = [
    'adventure', 'open-world', 'metroidvania', 'sandbox',
    'rpg', 'action-adventure', 'survival'
  ];

  const hasExplorationTag = detectedGenres.some(genre =>
    explorationTags.some(tag =>
      genre.toLowerCase().includes(tag.toLowerCase())
    )
  );

  // If it has non-exploration tags and no exploration tags, it's not an exploration game
  if (hasNonExplorationTag && !hasExplorationTag) {
    return false;
  }

  // If it has exploration tags, it is an exploration game
  if (hasExplorationTag) {
    return true;
  }

  // Default: only show exploration tips if question is about exploration
  return questionCategory === 'level_walkthrough' || questionCategory === 'item_lookup';
}

/**
 * Generate exploration tips based on playstyle
 * Phase 3 Step 2: Enhanced Strategy Tips - Exploration Tips
 * Now context-aware: only shows exploration tips for exploration-focused games
 */
function generateExplorationTips(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): string[] {
  const tips: string[] = [];
  const playstyleTags = preferences?.playstyleTags || [];
  const explorationDepth = patterns.behavior.explorationDepth;
  const detectedGame = context?.detectedGame; // Only use if validated by extractQuestionContext
  const detectedGenres = context?.detectedGenre || [];
  const questionCategory = context?.questionCategory;

  // Check if this is an exploration-focused game
  const isExploration = isExplorationGame(detectedGenres, questionCategory);

  // Only show exploration tips for exploration-focused games
  // OR if the question is specifically about exploration (level_walkthrough, item_lookup)
  if (!isExploration && questionCategory !== 'level_walkthrough' && questionCategory !== 'item_lookup') {
    return tips; // Return empty - this game doesn't have exploration mechanics
  }

  // Exploration tips for explorers
  // Include game name when available
  if (playstyleTags.includes('explorer') || explorationDepth > 0.7) {
    if (detectedGame) {
      tips.push(`🗺️ In ${detectedGame}, take your time: explore every corner - hidden areas often contain valuable rewards`);
      tips.push(`💡 Look for visual clues in ${detectedGame}: environmental storytelling often hints at secrets`);

      // Only show "check behind waterfalls" tip for games that actually have exploration areas
      if (isExploration) {
        tips.push(`🔍 Check behind waterfalls, under bridges, and in corners in ${detectedGame} - developers love hiding things there`);
      }

      if (patterns.difficulty.currentLevel === 'advanced') {
        tips.push(`🎯 Master sequence breaking in ${detectedGame}: find ways to access areas early for speedrun routes`);
      }
    } else {
      tips.push('🗺️ Take your time: explore every corner - hidden areas often contain valuable rewards');
      tips.push('💡 Look for visual clues: environmental storytelling often hints at secrets');

      if (isExploration) {
        tips.push('🔍 Check behind waterfalls, under bridges, and in corners - developers love hiding things there');
      }

      if (patterns.difficulty.currentLevel === 'advanced') {
        tips.push('🎯 Master sequence breaking: find ways to access areas early for speedrun routes');
      }
    }
  } else if (explorationDepth < 0.3) {
    // Tips for users who don't explore much (only for exploration games)
    if (isExploration) {
      if (detectedGame) {
        tips.push(`🗺️ Try exploring more in ${detectedGame}: hidden areas often contain powerful items or shortcuts`);
        tips.push(`💡 Follow side paths in ${detectedGame}: main routes aren't always the most rewarding`);
      } else {
        tips.push('🗺️ Try exploring more: hidden areas often contain powerful items or shortcuts');
        tips.push('💡 Follow side paths: main routes aren\'t always the most rewarding');
      }
    }
  }

  // Exploration tips based on question patterns
  const topQuestionType = patterns.behavior.questionTypes[0];
  if (topQuestionType?.category === 'level_walkthrough' || questionCategory === 'level_walkthrough') {
    if (detectedGame) {
      tips.push(`🗺️ In ${detectedGame}, use maps and guides: mark important locations as you explore`);
      tips.push(`💡 Look for collectibles in ${detectedGame}: many games reward thorough exploration`);
    } else {
      tips.push('🗺️ Use maps and guides: mark important locations as you explore');
      tips.push('💡 Look for collectibles: many games reward thorough exploration');
    }
  }

  // Exploration tips based on genre (only for exploration games)
  if (isExploration) {
    const topGenre = patterns.genreAnalysis.topGenres[0]?.genre || '';
    if (topGenre.includes('adventure') || topGenre.includes('Adventure')) {
      if (detectedGame) {
        tips.push(`🌟 Talk to NPCs in ${detectedGame}: they often provide hints about hidden locations`);
        tips.push(`🔍 Check your map regularly in ${detectedGame}: many secrets are marked but easy to miss`);
      } else {
        tips.push('🌟 Talk to NPCs: they often provide hints about hidden locations');
        tips.push('🔍 Check your map regularly: many secrets are marked but easy to miss');
      }
    }
  }

  return tips;
}

/**
 * Fetch game metadata from RAWG API to determine achievement support
 * Uses release date, platforms, and tags to determine if game has achievements
 */
async function fetchGameMetadataForAchievements(gameTitle: string): Promise<{
  hasAchievements: boolean;
  releaseDate?: string;
  platforms?: string[];
  tags?: string[];
}> {
  try {
    const axios = (await import('axios')).default;
    const searchUrl = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(gameTitle)}&page_size=1`;

    const searchResponse = await axios.get(searchUrl);
    if (!searchResponse.data?.results || searchResponse.data.results.length === 0) {
      return { hasAchievements: true }; // Default to true if we can't determine
    }

    const game = searchResponse.data.results[0];
    if (!game.id) {
      return { hasAchievements: true };
    }

    // Get detailed game info
    const detailUrl = `https://api.rawg.io/api/games/${game.id}?key=${process.env.RAWG_API_KEY}`;
    const detailResponse = await axios.get(detailUrl);
    const gameDetails = detailResponse.data;

    const releaseDate = gameDetails.released;
    const platforms = gameDetails.platforms?.map((p: any) => p.platform.name.toLowerCase()) || [];
    const allTags = gameDetails.tags?.map((t: any) => t.slug.toLowerCase()).filter(Boolean) || [];

    // Check for achievement-related tags
    const achievementTags = [
      'steam-achievements', 'achievements', 'trophies',
      'xbox-achievements', 'playstation-trophies'
    ];
    const hasAchievementTag = achievementTags.some(tag => allTags.includes(tag));

    // Platforms that support achievements (Xbox 360+, PS3+, Steam, modern platforms)
    // NOTE: Nintendo platforms (Switch, Wii U, Wii, etc.) do NOT have platform-tracked achievements
    const achievementPlatforms = [
      'xbox 360', 'xbox one', 'xbox series x', 'xbox series s',
      'playstation 3', 'playstation 4', 'playstation 5', 'ps3', 'ps4', 'ps5',
      'pc', 'steam', 'epic games store', 'gog',
      'ios', 'android' // Mobile platforms often have achievements
    ];

    // Nintendo platforms that do NOT have achievements
    const nintendoPlatforms = [
      'nintendo switch 2', 'nintendo switch', 'switch', 'nsw',
      'wii u', 'wii',
      'gamecube', 'game cube',
      'nintendo 64', 'n64',
      'super nintendo', 'snes',
      'nes', 'nintendo entertainment system',
      'game boy', 'gameboy', 'nintendo ds', 'nintendo 3ds'
    ];
    const hasAchievementPlatform = platforms.some((p: string) =>
      achievementPlatforms.some(ap => p.includes(ap))
    );

    // Check if any platform is a Nintendo platform (no achievements)
    const hasNintendoPlatform = platforms.some((p: string) =>
      nintendoPlatforms.some(np => p.includes(np))
    );

    // Platforms that don't have achievements (older consoles, pre-2005)
    const noAchievementPlatforms = [
      'playstation', 'ps1', 'ps2', 'psx', 'playstation 1', 'playstation 2',
      'sega genesis', 'sega saturn', 'sega dreamcast',
      'atari', 'neo geo', 'turbografx', 'commodore 64'
    ];
    const hasNoAchievementPlatform = platforms.some((p: string) =>
      noAchievementPlatforms.some(nap => p.includes(nap))
    );

    // Determine based on release date (achievements became common around 2005-2008)
    let hasAchievements = true; // Default to true
    if (releaseDate) {
      const releaseYear = new Date(releaseDate).getFullYear();
      // Games released before 2005 typically don't have achievements
      // (Xbox 360 launched in 2005, PS3 in 2006, Steam achievements in 2007)
      if (releaseYear < 2005) {
        hasAchievements = false;
      }
    }

    // Override based on tags (most reliable)
    if (hasAchievementTag) {
      hasAchievements = true;
    }

    // Override based on platforms
    // Nintendo platforms don't have achievements, even if game is modern
    if (hasNintendoPlatform && !hasAchievementPlatform) {
      hasAchievements = false; // Nintendo-only release = no achievements
    } else if (hasAchievementPlatform && !hasNintendoPlatform && !hasNoAchievementPlatform) {
      hasAchievements = true; // Has achievement platform and not Nintendo-only
    } else if (hasNoAchievementPlatform && !hasAchievementPlatform) {
      hasAchievements = false; // Only old platforms
    }

    return {
      hasAchievements,
      releaseDate,
      platforms: gameDetails.platforms?.map((p: any) => p.platform.name) || [],
      tags: allTags
    };
  } catch (error) {
    console.error(`[hasAchievements] Error fetching metadata for "${gameTitle}":`, error);
    // Default to true on error (most modern games have achievements)
    return { hasAchievements: true };
  }
}

/**
 * Use OpenAI to determine if a game has achievements based on game information
 * This handles platform-specific achievement support and edge cases
 */
async function determineAchievementsWithAI(
  gameTitle: string,
  releaseDate?: string,
  platforms?: string[],
  specificPlatform?: string
): Promise<boolean> {
  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const platformInfo = platforms && platforms.length > 0
      ? `Available platforms: ${platforms.join(', ')}. `
      : '';
    const specificPlatformInfo = specificPlatform
      ? `The user is asking about the ${specificPlatform} version specifically. `
      : '';
    const releaseInfo = releaseDate ? `Released: ${releaseDate}. ` : '';

    const prompt = `Determine if the video game "${gameTitle}" has a platform-tracked achievement/trophy system${specificPlatform ? ` on ${specificPlatform}` : ''}.

${releaseInfo}${platformInfo}${specificPlatformInfo}

IMPORTANT CONTEXT:
- Achievement systems are PLATFORM-SPECIFIC:
  * Xbox 360/One/Series: Have achievements
  * PlayStation 3/4/5: Have trophies
  * Steam/PC: Have achievements
  * Nintendo Switch/Wii U/Wii/GameCube/N64: Do NOT have platform-tracked achievements (Nintendo consoles don't have achievement systems)
  * Some games have in-game achievement systems but not platform-tracked ones

- Multi-platform games may have achievements on Xbox/PlayStation/PC but NOT on Nintendo platforms
- Games released before 2005 typically don't have achievements (Xbox 360 launched in 2005)
- Some modern games on Nintendo Switch do NOT have achievements even if they do on other platforms

${specificPlatform ? `Focus on whether this game has achievements SPECIFICALLY on ${specificPlatform}.` : 'Consider all platforms the game is available on.'}

Respond with ONLY "YES" or "NO" - nothing else.`;

    const completionParams: any = {
      model: 'gpt-5.6-terra',
      messages: [
        {
          role: 'system',
          content: 'You are a video game expert with deep knowledge of platform-specific features. Answer questions about achievement systems accurately, considering platform differences.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_completion_tokens: 10,
      reasoning_effort: 'none', // gpt-5.6-terra burns its whole token budget on hidden reasoning otherwise
    };
    const completion = await openai.chat.completions.create(completionParams);

    const response = completion.choices[0].message.content?.trim().toUpperCase();
    return response === 'YES';
  } catch (error) {
    console.error(`[hasAchievements] Error using OpenAI for "${gameTitle}":`, error);
    // Default to true on error (but this should be rare)
    return true;
  }
}

/**
 * Check if a game has achievements/trophies
 * Uses RAWG API and OpenAI to dynamically determine achievement support
 * Platform-aware: considers specific platform if mentioned in question
 * Returns true if the game supports achievements, false for games without achievement systems
 */
async function hasAchievements(
  _detectedGenres?: string[],
  detectedGame?: string,
  detectedPlatform?: string
): Promise<boolean> {
  if (!detectedGame) {
    // Default to true if we don't know the game
    return true;
  }

  try {
    // If specific platform is mentioned and it's a Nintendo platform, return false immediately
    if (detectedPlatform) {
      const lowerPlatform = detectedPlatform.toLowerCase();
      const nintendoPlatforms = [
        'nintendo switch 2', 'nintendo switch', 'switch', 'nsw',
        'nintendo ds', 'nintendo 3ds',
        'wii u', 'wii',
        'gamecube', 'game cube',
        'nintendo 64', 'n64',
        'super nintendo', 'snes',
        'nes', 'nintendo entertainment system'
      ];

      if (nintendoPlatforms.some(np => lowerPlatform.includes(np))) {
        // Nintendo platforms don't have platform-tracked achievements
        return false;
      }
    }

    // First, try to get metadata from RAWG API
    const metadata = await fetchGameMetadataForAchievements(detectedGame);

    // If specific platform is mentioned, check if that platform supports achievements
    if (detectedPlatform && metadata.platforms) {
      const lowerPlatform = detectedPlatform.toLowerCase();
      const platformMatches = metadata.platforms.some(p =>
        p.toLowerCase().includes(lowerPlatform)
      );

      if (platformMatches) {
        // Use OpenAI to determine if this specific platform version has achievements
        return await determineAchievementsWithAI(
          detectedGame,
          metadata.releaseDate,
          metadata.platforms,
          detectedPlatform
        );
      }
    }

    // If we have clear platform/tag information, use it
    if (metadata.platforms && metadata.platforms.length > 0) {
      // Check if all platforms are Nintendo (no achievements)
      const allNintendoPlatforms = metadata.platforms.every(p => {
        const pLower = p.toLowerCase();
        return ['nintendo switch 2', 'nintendo switch', 'switch', 'wii u', 'wii', 'gamecube',
          'nintendo 64', 'n64', 'snes', 'nes', 'nintendo ds', 'nintendo 3ds'].some(nintendo => pLower.includes(nintendo));
      });

      if (allNintendoPlatforms) {
        return false; // Nintendo-only = no achievements
      }

      // Check if all platforms are old (no achievements)
      const allOldPlatforms = metadata.platforms.every(p => {
        const pLower = p.toLowerCase();
        return ['playstation', 'ps1', 'ps2', 'sega genesis', 'atari'].some(old => pLower.includes(old));
      });

      if (allOldPlatforms) {
        return false;
      }

      // Check if any platform supports achievements (and not Nintendo-only)
      const hasAchievementPlatform = metadata.platforms.some(p => {
        const pLower = p.toLowerCase();
        return ['xbox 360', 'xbox one', 'xbox series', 'ps3', 'ps4', 'ps5',
          'steam', 'pc', 'epic', 'gog'].some(mod => pLower.includes(mod));
      });

      // If it's multi-platform with both achievement and non-achievement platforms
      // Use OpenAI to determine based on context
      if (hasAchievementPlatform) {
        const hasNintendoPlatform = metadata.platforms.some(p => {
          const pLower = p.toLowerCase();
          return ['nintendo switch', 'switch', 'wii'].some(nintendo => pLower.includes(nintendo));
        });

        if (hasNintendoPlatform && !detectedPlatform) {
          // Multi-platform game with Nintendo version - use AI to determine
          return await determineAchievementsWithAI(
            detectedGame,
            metadata.releaseDate,
            metadata.platforms,
            detectedPlatform
          );
        }

        return true; // Has achievement platform and not Nintendo-only
      }
    }

    // If release date indicates pre-2005 and no modern platforms, likely no achievements
    if (metadata.releaseDate) {
      const releaseYear = new Date(metadata.releaseDate).getFullYear();
      if (releaseYear < 2005 && (!metadata.platforms || metadata.platforms.length === 0)) {
        // Use OpenAI as fallback to be sure
        return await determineAchievementsWithAI(
          detectedGame,
          metadata.releaseDate,
          metadata.platforms,
          detectedPlatform
        );
      }
    }

    // If we have tags indicating achievements, use that (but be cautious with Nintendo)
    if (metadata.tags) {
      const achievementTags = ['steam-achievements', 'achievements', 'trophies'];
      if (metadata.tags.some(tag => achievementTags.includes(tag))) {
        // But check if it's Nintendo-only
        if (metadata.platforms && metadata.platforms.length > 0) {
          const allNintendo = metadata.platforms.every(p => {
            const pLower = p.toLowerCase();
            return ['nintendo switch', 'switch', 'wii'].some(nintendo => pLower.includes(nintendo));
          });
          if (allNintendo) {
            return false; // Tags might be wrong or refer to in-game achievements
          }
        }
        return true;
      }
    }

    // If metadata suggests no achievements, use OpenAI to confirm
    if (!metadata.hasAchievements && metadata.releaseDate) {
      const aiResult = await determineAchievementsWithAI(
        detectedGame,
        metadata.releaseDate,
        metadata.platforms,
        detectedPlatform
      );
      return aiResult;
    }

    // Default to metadata result, but use AI if we're unsure
    if (metadata.hasAchievements && metadata.platforms && metadata.platforms.length > 0) {
      // Double-check with AI if it's a multi-platform game
      const hasNintendo = metadata.platforms.some(p => {
        const pLower = p.toLowerCase();
        return ['nintendo switch', 'switch', 'wii'].some(nintendo => pLower.includes(nintendo));
      });

      if (hasNintendo && !detectedPlatform) {
        // Multi-platform with Nintendo - verify with AI
        return await determineAchievementsWithAI(
          detectedGame,
          metadata.releaseDate,
          metadata.platforms,
          detectedPlatform
        );
      }
    }

    return metadata.hasAchievements;
  } catch (error) {
    console.error(`[hasAchievements] Error determining achievements for "${detectedGame}":`, error);
    // Default to true on error (but this should be rare)
    return true;
  }
}

/**
 * Check if a game has free-roam/open-world mechanics
 * Returns true if the game allows free exploration, false for linear/boss-rush games
 */
function hasFreeRoamMechanics(detectedGenres?: string[]): boolean {
  if (!detectedGenres || detectedGenres.length === 0) {
    return false; // Default to false if we don't know
  }

  const freeRoamTags = [
    'open-world', 'sandbox', 'adventure', 'rpg',
    'action-adventure', 'metroidvania', 'survival'
  ];

  const linearTags = [
    'boss-fight', 'boss-battle', 'boss-rush',
    'run-and-gun', 'shoot-em-up', 'shmup', 'bullet-hell',
    'arcade', 'fighting', 'racing', 'rhythm',
    'puzzle', 'tower-defense', 'linear'
  ];

  // Check if it has free-roam tags
  const hasFreeRoamTag = detectedGenres.some(genre =>
    freeRoamTags.some(tag =>
      genre.toLowerCase().includes(tag.toLowerCase())
    )
  );

  // Check if it has linear tags (not free-roam)
  const hasLinearTag = detectedGenres.some(genre =>
    linearTags.some(tag =>
      genre.toLowerCase().includes(tag.toLowerCase())
    )
  );

  // If it has linear tags and no free-roam tags, it's not free-roam
  if (hasLinearTag && !hasFreeRoamTag) {
    return false;
  }

  // If it has free-roam tags, it is free-roam
  return hasFreeRoamTag;
}

/**
 * Generate achievement hunting strategies
 * Phase 3 Step 2: Enhanced Strategy Tips - Achievement Strategies
 * Now context-aware: adjusts tips based on game type (linear vs free-roam)
 */
async function generateAchievementStrategies(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): Promise<string[]> {
  const strategies: string[] = [];
  const playstyleTags = preferences?.playstyleTags || [];
  const topQuestionType = patterns.behavior.questionTypes[0];
  const detectedGame = context?.detectedGame; // Only use if validated by extractQuestionContext
  const detectedGenres = context?.detectedGenre || [];
  const detectedPlatform = context?.detectedPlatform;
  const hasFreeRoam = hasFreeRoamMechanics(detectedGenres);
  const hasAchievementSystem = await hasAchievements(detectedGenres, detectedGame, detectedPlatform);

  // Only show achievement tips if the game has an achievement system
  if (!hasAchievementSystem) {
    return strategies; // Return empty - this game doesn't have achievements
  }

  // Achievement strategies for completionists
  // Include game name when available
  if (playstyleTags.includes('completionist') || topQuestionType?.category === 'achievement') {
    if (detectedGame) {
      strategies.push(`🏆 For ${detectedGame}, plan your route: identify achievements that can be completed together`);
      strategies.push(`📋 Create a checklist for ${detectedGame}: track which achievements you've completed`);

      // Only mention multiple playthroughs if it makes sense for the game type
      if (hasFreeRoam || patterns.difficulty.currentLevel === 'advanced') {
        strategies.push(`⏱️ Some achievements in ${detectedGame} require multiple playthroughs - plan accordingly`);
      }

      if (patterns.difficulty.currentLevel === 'advanced') {
        strategies.push(`⚡ Optimize achievement runs in ${detectedGame}: combine speedrun techniques with achievement hunting`);
      }
    } else {
      strategies.push('🏆 Plan your route: identify achievements that can be completed together');
      strategies.push('📋 Create a checklist: track which achievements you\'ve completed');

      if (hasFreeRoam || patterns.difficulty.currentLevel === 'advanced') {
        strategies.push('⏱️ Some achievements require multiple playthroughs - plan accordingly');
      }

      if (patterns.difficulty.currentLevel === 'advanced') {
        strategies.push('⚡ Optimize achievement runs: combine speedrun techniques with achievement hunting');
      }
    }
  }

  // General achievement tips - context-aware based on game type
  if (topQuestionType?.category === 'achievement') {
    if (detectedGame) {
      // For free-roam games: mention story-based before free-roam
      // For linear/boss-rush games: focus on missable achievements without mentioning free-roam
      if (hasFreeRoam) {
        strategies.push(`🎯 In ${detectedGame}, focus on missable achievements first: complete story-based ones before free-roam`);
      } else {
        strategies.push(`🎯 In ${detectedGame}, focus on missable achievements first: some may be locked after certain story points`);
      }

      strategies.push(`💡 Check achievement descriptions in ${detectedGame}: many have hidden requirements or conditions`);

      // Only mention saving if the game has save mechanics (not arcade-style)
      const isArcadeStyle = detectedGenres.some(g =>
        ['arcade', 'boss-rush', 'run-and-gun', 'shoot-em-up'].some(tag =>
          g.toLowerCase().includes(tag.toLowerCase())
        )
      );

      if (!isArcadeStyle) {
        strategies.push(`🔄 Save before challenging achievements in ${detectedGame}: allows retries without full restarts`);
      }
    } else {
      if (hasFreeRoam) {
        strategies.push('🎯 Focus on missable achievements first: complete story-based ones before free-roam');
      } else {
        strategies.push('🎯 Focus on missable achievements first: some may be locked after certain story points');
      }

      strategies.push('💡 Check achievement descriptions: many have hidden requirements or conditions');

      const isArcadeStyle = detectedGenres.some(g =>
        ['arcade', 'boss-rush', 'run-and-gun', 'shoot-em-up'].some(tag =>
          g.toLowerCase().includes(tag.toLowerCase())
        )
      );

      if (!isArcadeStyle) {
        strategies.push('🔄 Save before challenging achievements: allows retries without full restarts');
      }
    }
  }

  // Achievement tips based on difficulty
  if (patterns.difficulty.challengeSeeking === 'seeking_challenge') {
    if (detectedGame) {
      strategies.push(`🔥 Try achievement combinations in ${detectedGame}: complete multiple challenging achievements in one run`);
    } else {
      strategies.push('🔥 Try achievement combinations: complete multiple challenging achievements in one run');
    }
  }

  return strategies;
}

/**
 * Generate strategy tips based on user patterns and current question context
 * Phase 3 Step 2: Enhanced Strategy Tips
 * Includes: personalized loadout suggestions, combat strategies, exploration tips, achievement hunting
 */
async function generateStrategyTips(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  context: Awaited<ReturnType<typeof extractQuestionContext>>,
  preferences?: any
): Promise<{
  tips: string[];
  category: string;
}> {
  const tips: string[] = [];
  const category = context.questionCategory || 'general_gameplay';
  const detectedGame = context?.detectedGame; // Only use if validated by extractQuestionContext

  // When no question context, prioritize genre-based personalized tips
  // When question context exists, use category-specific tips
  if (category === 'general_gameplay') {
    // No question context - use personalized genre-based tips
    const topGenre = patterns.genreAnalysis.topGenres[0]?.genre || '';
    const currentLevel = patterns.difficulty.currentLevel;
    const playstyleTags = preferences?.playstyleTags || [];

    // Genre-specific general tips (prioritize these)
    // Include game name if detected
    if (topGenre.includes('platformer') || topGenre.includes('Platformer')) {
      if (detectedGame) {
        tips.push(`🎮 Platformer tip: In ${detectedGame}, master the movement mechanics first - precise jumps and timing are key to success.`);
        tips.push(`⚡ Pro tip: Learn to read level design patterns in ${detectedGame}. Most platformers use visual cues to guide you toward secrets and optimal paths.`);
      } else {
        tips.push('🎮 Platformer tip: Master the movement mechanics first - precise jumps and timing are key to success in platformers.');
        tips.push('⚡ Pro tip: Learn to read level design patterns. Most platformers use visual cues to guide you toward secrets and optimal paths.');
      }
    } else if (topGenre.includes('action') || topGenre.includes('Action')) {
      if (detectedGame) {
        tips.push(`⚔️ Action game tip: In ${detectedGame}, practice your dodge and parry timing. These defensive skills are often more important than pure offense.`);
        tips.push(`🎯 Pro tip: Learn enemy attack patterns in ${detectedGame} and find safe windows to counterattack for maximum efficiency.`);
      } else {
        tips.push('⚔️ Action game tip: Practice your dodge and parry timing. These defensive skills are often more important than pure offense.');
        tips.push('🎯 Pro tip: Learn enemy attack patterns and find safe windows to counterattack for maximum efficiency.');
      }
    } else if (topGenre.includes('adventure') || topGenre.includes('Adventure')) {
      if (detectedGame) {
        tips.push(`🗺️ Adventure game tip: In ${detectedGame}, take your time to explore and talk to NPCs. Adventure games reward thorough exploration with story depth and hidden content.`);
        tips.push(`💡 Pro tip: Pay attention to environmental storytelling in ${detectedGame} - developers often hide clues about puzzles and secrets in the world itself.`);
      } else {
        tips.push('🗺️ Adventure game tip: Take your time to explore and talk to NPCs. Adventure games reward thorough exploration with story depth and hidden content.');
        tips.push('💡 Pro tip: Pay attention to environmental storytelling - developers often hide clues about puzzles and secrets in the world itself.');
      }
    } else if (topGenre.includes('rpg') || topGenre.includes('RPG')) {
      if (detectedGame) {
        tips.push(`⚔️ RPG tip: In ${detectedGame}, don't rush through the story. Take time to complete side quests and explore - they often provide valuable rewards and character development.`);
        tips.push(`📊 Pro tip: Experiment with different character builds early on in ${detectedGame}. Finding a playstyle that matches your preferences makes the game much more enjoyable.`);
      } else {
        tips.push('⚔️ RPG tip: Don\'t rush through the story. Take time to complete side quests and explore - they often provide valuable rewards and character development.');
        tips.push('📊 Pro tip: Experiment with different character builds early on. Finding a playstyle that matches your preferences makes the game much more enjoyable.');
      }
    }

    // Add loadout suggestions if relevant to genre
    const loadoutSuggestions = generateLoadoutSuggestions(patterns, context, preferences);
    tips.push(...loadoutSuggestions);

    // Difficulty-based general tips
    if (currentLevel === 'intermediate') {
      if (detectedGame) {
        tips.push(`📈 Since you're at an intermediate level in ${detectedGame}, try experimenting with different strategies. Don't be afraid to step outside your comfort zone.`);
      } else {
        tips.push('📈 Since you\'re at an intermediate level, try experimenting with different strategies. Don\'t be afraid to step outside your comfort zone.');
      }
    } else if (currentLevel === 'advanced') {
      if (detectedGame) {
        tips.push(`🔥 As an advanced player in ${detectedGame}, focus on optimization and efficiency. Study high-level play to discover techniques you might not have considered.`);
      } else {
        tips.push('🔥 As an advanced player, focus on optimization and efficiency. Study high-level play to discover techniques you might not have considered.');
      }
    }

    // Playstyle-based general tips
    if (playstyleTags.includes('explorer')) {
      if (detectedGame) {
        tips.push(`🗺️ Your exploratory nature means you'll find more secrets than most in ${detectedGame}. Keep checking those corners and hidden paths!`);
      } else {
        tips.push('🗺️ Your exploratory nature means you\'ll find more secrets than most. Keep checking those corners and hidden paths!');
      }
    }
    if (playstyleTags.includes('strategist')) {
      if (detectedGame) {
        tips.push(`📊 Your strategic mindset means you enjoy planning. Take time to analyze ${detectedGame}'s mechanics and plan your approach before diving in.`);
      } else {
        tips.push('📊 Your strategic mindset means you enjoy planning. Take time to analyze game mechanics and plan your approach before diving in.');
      }
    }

    // Add exploration and achievement tips (these are always relevant)
    const explorationTips = generateExplorationTips(patterns, preferences, context);
    tips.push(...explorationTips);

    const achievementStrategies = await generateAchievementStrategies(patterns, preferences, context);
    tips.push(...achievementStrategies);
  } else {
    // Question context exists - use category-specific tips
    // 1. Personalized loadout suggestions
    const loadoutSuggestions = generateLoadoutSuggestions(patterns, context, preferences);
    tips.push(...loadoutSuggestions);

    // 2. Combat strategies based on question patterns
    const combatStrategies = generateCombatStrategies(patterns, context);
    tips.push(...combatStrategies);

    // 3. Exploration tips for their playstyle
    const explorationTips = generateExplorationTips(patterns, preferences, context);
    tips.push(...explorationTips);

    // 4. Achievement hunting strategies
    const achievementStrategies = await generateAchievementStrategies(patterns, preferences, context);
    tips.push(...achievementStrategies);
  }

  // Fallback: Tips based on question category (if no specific tips generated)
  // Include game name when available
  if (tips.length === 0) {
    if (category === 'boss_fight') {
      if (detectedGame) {
        tips.push(`💪 In ${detectedGame}, study boss attack patterns and identify safe windows for counterattacks`);
        tips.push(`🛡️ Consider defensive builds or equipment in ${detectedGame} that resist the boss's damage type`);
      } else {
        tips.push('💪 Study boss attack patterns and identify safe windows for counterattacks');
        tips.push('🛡️ Consider defensive builds or equipment that resist the boss\'s damage type');
      }
    } else if (category === 'strategy') {
      if (detectedGame) {
        tips.push(`📊 Analyze your current build in ${detectedGame} and identify optimization opportunities`);
        tips.push(`⚔️ Experiment with different loadouts in ${detectedGame} to find what works best for your playstyle`);
      } else {
        tips.push('📊 Analyze your current build and identify optimization opportunities');
        tips.push('⚔️ Experiment with different loadouts to find what works best for your playstyle');
      }
    } else if (category === 'level_walkthrough') {
      if (detectedGame) {
        tips.push(`🗺️ In ${detectedGame}, take time to explore - hidden areas often contain valuable resources`);
        tips.push(`💡 Look for environmental clues and visual indicators for secrets in ${detectedGame}`);
      } else {
        tips.push('🗺️ Take time to explore - hidden areas often contain valuable resources');
        tips.push('💡 Look for environmental clues and visual indicators for secrets');
      }
    } else if (category === 'item_lookup') {
      if (detectedGame) {
        tips.push(`🔍 In ${detectedGame}, check multiple sources - item locations can vary by game version`);
        tips.push(`📦 Consider item synergies when building your inventory in ${detectedGame}`);
      } else {
        tips.push('🔍 Check multiple sources - item locations can vary by game version');
        tips.push('📦 Consider item synergies when building your inventory');
      }
    } else if (category === 'achievement') {
      if (detectedGame) {
        tips.push(`🏆 For ${detectedGame}, plan your achievement route to minimize backtracking`);
        tips.push(`⏱️ Some achievements in ${detectedGame} may require multiple playthroughs - plan accordingly`);
      } else {
        tips.push('🏆 Plan your achievement route to minimize backtracking');
        tips.push('⏱️ Some achievements may require multiple playthroughs - plan accordingly');
      }
    }
  }

  // Tips based on difficulty level
  if (context.difficultyHint === 'beginner') {
    if (detectedGame) {
      tips.push(`📚 In ${detectedGame}, start with basic strategies and gradually increase complexity`);
      tips.push(`🎯 Focus on fundamentals in ${detectedGame} before attempting advanced techniques`);
    } else {
      tips.push('📚 Start with basic strategies and gradually increase complexity');
      tips.push('🎯 Focus on fundamentals before attempting advanced techniques');
    }
  } else if (context.difficultyHint === 'advanced') {
    if (detectedGame) {
      tips.push(`⚡ Look for speedrun techniques and optimization strategies for ${detectedGame}`);
      tips.push(`🎖️ Consider challenge runs or self-imposed restrictions in ${detectedGame} for extra difficulty`);
    } else {
      tips.push('⚡ Look for speedrun techniques and optimization strategies');
      tips.push('🎖️ Consider challenge runs or self-imposed restrictions for extra difficulty');
    }
  }

  // Tips based on user's challenge-seeking behavior
  if (patterns.difficulty.challengeSeeking === 'seeking_challenge') {
    if (detectedGame) {
      tips.push(`🔥 In ${detectedGame}, try harder difficulty modes or challenge runs for increased difficulty`);
    } else {
      tips.push('🔥 Try harder difficulty modes or challenge runs for increased difficulty');
    }
  } else if (patterns.difficulty.challengeSeeking === 'easing_up') {
    if (detectedGame) {
      tips.push(`😌 In ${detectedGame}, consider lowering difficulty or using accessibility options if available`);
    } else {
      tips.push('😌 Consider lowering difficulty or using accessibility options if available');
    }
  }

  // Tips based on learning speed
  if (patterns.behavior.learningSpeed === 'fast') {
    if (detectedGame) {
      tips.push(`🚀 You learn quickly! Try experimenting with advanced strategies in ${detectedGame}`);
    } else {
      tips.push('🚀 You learn quickly! Try experimenting with advanced strategies');
    }
  } else if (patterns.behavior.learningSpeed === 'slow') {
    if (detectedGame) {
      tips.push(`📖 In ${detectedGame}, take your time - practice and repetition will improve your skills`);
    } else {
      tips.push('📖 Take your time - practice and repetition will improve your skills');
    }
  }

  // Remove duplicates and limit to 8 tips (increased from 5 for more comprehensive suggestions)
  const uniqueTips = Array.from(new Set(tips));

  return {
    tips: uniqueTips.slice(0, 8),
    category,
  };
}

/**
 * Generate suggested progression for games based on user patterns
 * Phase 3 Step 2: Enhanced Learning Paths - Game Progression
 * Now context-aware: uses detected game and question category to generate relevant suggestions
 */
function generateGameProgression(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>,
  currentQuestion?: string
): string[] {
  const progression: string[] = [];
  const currentLevel = patterns.difficulty?.currentLevel || 'intermediate';
  const topGenre = patterns.genreAnalysis?.topGenres?.[0]?.genre || '';
  const playstyleTags = preferences?.playstyleTags || [];
  const detectedGame = context?.detectedGame;
  const questionCategory = context?.questionCategory;
  const detectedGenres = context?.detectedGenre || [];

  // Use detected genres from context if available, otherwise use historical patterns
  const genreToUse = detectedGenres.length > 0
    ? detectedGenres[0]
    : topGenre;

  // Context-aware progression based on current question
  if (detectedGame && questionCategory) {
    // For dungeon/temple questions (level_walkthrough)
    if (questionCategory === 'level_walkthrough') {
      if (currentQuestion && (currentQuestion.toLowerCase().includes('temple') ||
        currentQuestion.toLowerCase().includes('dungeon') ||
        currentQuestion.toLowerCase().includes('level'))) {
        progression.push(`🗺️ In ${detectedGame}, practice dungeon navigation: learn to read maps and remember layouts`);
        progression.push(`🧩 Master puzzle-solving patterns in ${detectedGame}: many dungeons reuse similar mechanics`);
        progression.push(`🔍 In ${detectedGame}, develop your observation skills: secrets and switches are often hidden in plain sight`);
      } else {
        progression.push(`🗺️ In ${detectedGame}, take your time exploring: thorough exploration often reveals shortcuts and secrets`);
        progression.push(`💡 In ${detectedGame}, pay attention to environmental clues: developers leave hints in the world`);
      }
    }
    // For boss fight questions
    else if (questionCategory === 'boss_fight') {
      progression.push(`💪 In ${detectedGame}, practice pattern recognition: each boss has unique attack patterns to learn`);
      progression.push(`⏱️ In ${detectedGame}, work on your timing: mastering dodge and parry windows is key`);
    }
    // For strategy questions
    else if (questionCategory === 'strategy') {
      progression.push(`⚔️ In ${detectedGame}, experiment with different approaches: what works for others might not work for you`);
      progression.push(`📊 In ${detectedGame}, analyze your playstyle: understanding your strengths helps you optimize`);
    }
    // For general gameplay questions about a specific game
    else if (questionCategory === 'general_gameplay' && detectedGame) {
      // Check if it's an adventure/RPG game
      if (genreToUse.includes('adventure') || genreToUse.includes('rpg') || genreToUse.includes('action-adventure')) {
        progression.push(`🗺️ In ${detectedGame}, focus on exploration: take time to discover hidden areas and collectibles`);
        progression.push(`⚔️ In ${detectedGame}, practice combat mechanics: mastering the basics makes everything easier`);
        progression.push(`🧩 In ${detectedGame}, learn puzzle patterns: many puzzles follow similar logic throughout the game`);
      } else {
        progression.push(`🎮 In ${detectedGame}, master the core mechanics: understanding the fundamentals is essential`);
        progression.push(`⚡ In ${detectedGame}, practice consistently: repetition helps build muscle memory`);
      }
    }
  }

  // If we have context but no contextual suggestions yet, add game-specific ones
  if (detectedGame && progression.length === 0) {
    if (genreToUse.includes('adventure') || genreToUse.includes('rpg') || genreToUse.includes('action-adventure')) {
      progression.push(`🗺️ In ${detectedGame}, take your time exploring: thorough exploration reveals secrets and shortcuts`);
      progression.push(`⚔️ In ${detectedGame}, practice combat and movement: mastering the basics makes everything easier`);
    } else if (genreToUse.includes('platformer')) {
      progression.push(`🎮 In ${detectedGame}, master movement mechanics: precise jumps and timing are essential`);
      progression.push(`⚡ In ${detectedGame}, practice difficult sections: repetition builds muscle memory`);
    } else if (genreToUse.includes('shooter') || genreToUse.includes('action')) {
      progression.push(`🎯 In ${detectedGame}, focus on aim and positioning: these are often more important than raw reflexes`);
      progression.push(`⚔️ In ${detectedGame}, learn weapon mechanics: understanding each weapon's strengths helps`);
    }
  }

  // Fallback to historical pattern-based progression if no context
  if (progression.length === 0) {
    if (currentLevel === 'beginner') {
      progression.push('📚 Start with tutorial-friendly games: focus on games with comprehensive tutorials');
      progression.push('🎮 Progress from story mode to normal difficulty before attempting hard modes');
      progression.push('🔄 Complete one game fully before moving to the next to build confidence');
    } else if (currentLevel === 'intermediate') {
      progression.push('⚔️ Try games with multiple difficulty settings: gradually increase challenge');
      progression.push('🏆 Move from single-player to multiplayer modes to test your skills');
      progression.push('📈 Progress through game series in order: build on mechanics you\'ve learned');

      if (playstyleTags.includes('completionist')) {
        progression.push('🏅 Complete games 100% before moving on: builds mastery and understanding');
      }
    } else if (currentLevel === 'advanced') {
      progression.push('🔥 Tackle games known for difficulty: Souls-like, roguelikes, or hardcore modes');
      progression.push('⚡ Try speedrunning: apply your skills to time-based challenges');
      progression.push('🎖️ Master entire game series: become an expert in your favorite franchises');
    } else {
      // Default fallback
      progression.push('⚔️ Try games with multiple difficulty settings: gradually increase challenge');
      progression.push('🏆 Move from single-player to multiplayer modes to test your skills');
      progression.push('📈 Progress through game series in order: build on mechanics you\'ve learned');
    }

    // Genre-specific progression (only if no context)
    if (topGenre.includes('rpg') || topGenre.includes('RPG')) {
      progression.push('📖 Progress from linear RPGs to open-world: build exploration skills gradually');
      progression.push('⚔️ Move from turn-based to action RPGs: develop real-time combat skills');
    } else if (topGenre.includes('shooter') || topGenre.includes('action')) {
      progression.push('🎯 Start with single-player campaigns, then move to multiplayer');
      progression.push('🔫 Progress from casual shooters to competitive FPS games');
    } else if (topGenre.includes('strategy') || topGenre.includes('Strategy')) {
      progression.push('📊 Move from turn-based to real-time strategy: develop faster decision-making');
      progression.push('🏰 Progress from single-player campaigns to multiplayer matches');
    }
  }

  return progression;
}

/**
 * Generate skill building recommendations based on user patterns
 * Phase 3 Step 2: Enhanced Learning Paths - Skill Building
 */
function generateSkillBuilding(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): string[] {
  const skills: string[] = [];
  const currentLevel = patterns.difficulty?.currentLevel || 'intermediate';
  const topQuestionType = patterns.behavior?.questionTypes?.[0];
  const learningSpeed = patterns.behavior?.learningSpeed || 'moderate';
  const playstyleTags = preferences?.playstyleTags || [];
  const questionCategory = context?.questionCategory;

  const detectedGame = context?.detectedGame;

  // Context-aware skill building based on current question
  if (questionCategory === 'boss_fight') {
    if (detectedGame) {
      skills.push(`In ${detectedGame}, focus on learning attack patterns - most bosses telegraph their moves before striking`);
      skills.push(`Practice your dodge timing in ${detectedGame} - knowing when to move is often more important than where`);
      if (currentLevel === 'intermediate' || currentLevel === 'advanced') {
        skills.push(`Study the boss's phases in ${detectedGame} - understanding transitions helps you prepare for what's coming`);
      }
    } else {
      skills.push('Focus on learning attack patterns - most bosses telegraph their moves before striking');
      skills.push('Practice your dodge timing - knowing when to move is often more important than where');
      if (currentLevel === 'intermediate' || currentLevel === 'advanced') {
        skills.push('Study the boss\'s phases - understanding transitions helps you prepare for what\'s coming');
      }
    }
  } else if (questionCategory === 'strategy') {
    if (detectedGame) {
      skills.push(`In ${detectedGame}, experiment with different builds - sometimes the meta isn't what works best for you`);
      skills.push(`Learn to adapt your strategy on the fly in ${detectedGame} - plans rarely survive contact with the game`);
    } else {
      skills.push('Experiment with different builds - sometimes the meta isn\'t what works best for you');
      skills.push('Learn to adapt your strategy on the fly - plans rarely survive contact with the game');
    }
  } else if (questionCategory === 'level_walkthrough' || questionCategory === 'item_lookup') {
    if (detectedGame) {
      skills.push(`In ${detectedGame}, develop your observation skills - secrets are often hidden in plain sight`);
      skills.push(`Learn to read environmental clues in ${detectedGame} - developers love leaving hints in the world`);
    } else {
      skills.push('Develop your observation skills - secrets are often hidden in plain sight');
      skills.push('Learn to read environmental clues - developers love leaving hints in the world');
    }
  }

  // Skill building based on difficulty level (if no context-specific skills)
  if (skills.length === 0) {
    if (currentLevel === 'beginner') {
      skills.push('Focus on the fundamentals - movement, basic combat, and managing your resources');
      skills.push('Take time to understand how the game works - rushing ahead often leads to frustration');
      skills.push('Practice your timing - recognizing patterns and reacting quickly comes with experience');
    } else if (currentLevel === 'intermediate') {
      skills.push('Work on advanced techniques - combos, optimal rotations, and efficient strategies');
      skills.push('Develop your ability to read situations - planning ahead makes everything easier');
      skills.push('Learn to adapt - what works in one situation might not work in another');
    } else if (currentLevel === 'advanced') {
      skills.push('Refine your precision - frame-perfect inputs and consistent execution');
      skills.push('Optimize your routes - finding faster paths and better strategies');
      skills.push('Master challenge runs - pushing yourself with restrictions builds deeper understanding');
    }
  }

  // Skill building based on learning speed
  if (learningSpeed === 'fast') {
    skills.push('Since you pick things up quickly, don\'t be afraid to tackle advanced techniques');
    skills.push('Watch how expert players approach things - you\'ll learn faster by seeing what\'s possible');
  } else if (learningSpeed === 'slow') {
    skills.push('Take it one skill at a time - mastering each before moving on builds a solid foundation');
    skills.push('Consistent practice pays off - repetition helps things click when you\'re ready');
  }

  // Skill building based on playstyle
  if (playstyleTags.includes('strategist')) {
    skills.push('Dive deep into game mechanics - understanding how things work helps you optimize');
    skills.push('Study build synergies and meta trends - but remember, what\'s popular isn\'t always what\'s best for you');
  }
  if (playstyleTags.includes('explorer')) {
    skills.push('Hone your exploration instincts - secrets are everywhere if you know where to look');
    skills.push('Pay attention to environmental details - developers often leave clues in the world itself');
  }
  if (playstyleTags.includes('completionist')) {
    skills.push('Plan your completion routes - efficiency saves time without sacrificing thoroughness');
    skills.push('Keep track of your progress - organization helps you tackle multiple objectives without getting overwhelmed');
  }

  return skills;
}

/**
 * Generate next challenges to tackle based on user patterns
 * Phase 3 Step 2: Enhanced Learning Paths - Next Challenges
 */
function generateNextChallenges(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): string[] {
  const challenges: string[] = [];
  const currentLevel = patterns.difficulty?.currentLevel || 'intermediate';
  const challengeSeeking = patterns.difficulty?.challengeSeeking || 'maintaining';
  const topQuestionType = patterns.behavior?.questionTypes?.[0];
  const playstyleTags = preferences?.playstyleTags || [];
  const questionCategory = context?.questionCategory;

  // Context-aware challenges based on current question
  if (questionCategory === 'boss_fight') {
    if (currentLevel === 'intermediate' || currentLevel === 'advanced') {
      challenges.push('Try beating this boss without taking any damage - it\'s a great way to perfect your timing');
    }
    challenges.push('Once you\'ve mastered this one, tackle other challenging bosses with the same approach');
  } else if (questionCategory === 'strategy') {
    challenges.push('Test this strategy in different situations - see how well it holds up');
    challenges.push('Try creating your own variation - sometimes the best strategies are personalized');
  } else if (questionCategory === 'achievement') {
    challenges.push('Plan out which achievements you can complete together - efficiency is key');
    challenges.push('Don\'t stress about getting everything at once - some achievements are easier on a second playthrough');
  }

  // Challenges based on current difficulty level (if no context-specific challenges)
  if (challenges.length === 0) {
    if (currentLevel === 'beginner') {
      challenges.push('Try completing a game on normal difficulty without lowering it');
      challenges.push('Explore a genre you haven\'t tried yet - variety helps you grow');
      challenges.push('Pick one mechanic you\'ve been struggling with and really focus on it');
    } else if (currentLevel === 'intermediate') {
      challenges.push('Take on a game at hard difficulty - you might surprise yourself');
      challenges.push('Try a speedrun challenge - see how fast you can complete a game you know well');
      challenges.push('Go for 100% completion in one of your favorite games');
    } else if (currentLevel === 'advanced') {
      challenges.push('Attempt a no-death run - it\'s the ultimate test of skill');
      challenges.push('Aim for a leaderboard position - compete with the best');
      challenges.push('Master an entire game series - become the expert');
      challenges.push('Try challenge runs with restrictions - they force creative problem-solving');
    }
  }

  // Challenges based on challenge-seeking behavior
  if (challengeSeeking === 'seeking_challenge') {
    challenges.push('Try games known for their difficulty - Souls-likes, roguelikes, or hardcore modes');
    challenges.push('Set your own restrictions - no healing, no upgrades, or other self-imposed challenges');
    challenges.push('Master games with fixed difficulty - learning to adapt is part of the fun');
  } else if (challengeSeeking === 'easing_up') {
    challenges.push('Explore story-focused games - sometimes a great narrative is challenge enough');
    challenges.push('Look for games with good accessibility options - find the difficulty that feels right for you');
  }

  // Challenges based on playstyle
  if (playstyleTags.includes('completionist')) {
    challenges.push('Go for 100% completion - all achievements, collectibles, and side content');
    challenges.push('Plan out an efficient route - it makes completion much more manageable');
  }
  if (playstyleTags.includes('strategist')) {
    challenges.push('Master a meta build - learn what makes it strong, then see if you can improve it');
    challenges.push('Test your theorycrafting in practice - can your strategies hold up in real situations?');
  }

  return challenges;
}

/**
 * Generate practice areas for improvement based on user patterns
 * Phase 3 Step 2: Enhanced Learning Paths - Practice Areas
 */
function generatePracticeAreas(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>
): string[] {
  const practiceAreas: string[] = [];
  const currentLevel = patterns.difficulty?.currentLevel || 'intermediate';
  const topQuestionType = patterns.behavior?.questionTypes?.[0] || (context?.questionCategory ? { category: context.questionCategory } : undefined);
  const learningSpeed = patterns.behavior?.learningSpeed || 'moderate';
  const topGenre = context?.detectedGenre?.[0] || patterns.genreAnalysis?.topGenres?.[0]?.genre || '';
  const questionCategory = context?.questionCategory;

  const detectedGame = context?.detectedGame;

  // Context-aware practice areas based on current question
  if (questionCategory === 'boss_fight') {
    if (detectedGame) {
      practiceAreas.push(`In ${detectedGame}, practice recognizing attack tells - most bosses give you a warning before they strike`);
      practiceAreas.push(`Work on your dodge timing in ${detectedGame} - the window is usually more forgiving than it feels`);
      if (currentLevel === 'intermediate' || currentLevel === 'advanced') {
        practiceAreas.push(`Study the boss's phases in ${detectedGame} - knowing what comes next helps you prepare`);
      }
    } else {
      practiceAreas.push('Practice recognizing attack tells - most bosses give you a warning before they strike');
      practiceAreas.push('Work on your dodge timing - the window is usually more forgiving than it feels');
      if (currentLevel === 'intermediate' || currentLevel === 'advanced') {
        practiceAreas.push('Study the boss\'s phases - knowing what comes next helps you prepare');
      }
    }
  } else if (questionCategory === 'strategy') {
    if (detectedGame) {
      practiceAreas.push(`In ${detectedGame}, test different approaches in similar situations - see what works consistently`);
      practiceAreas.push(`Practice adapting your strategy in ${detectedGame} when things don't go as planned`);
    } else {
      practiceAreas.push('Test different approaches in similar situations - see what works consistently');
      practiceAreas.push('Practice adapting your strategy when things don\'t go as planned');
    }
  } else if (questionCategory === 'level_walkthrough') {
    if (detectedGame) {
      practiceAreas.push(`In ${detectedGame}, practice your observation skills - secrets are often right in front of you`);
      practiceAreas.push(`Work on remembering layouts in ${detectedGame} - knowing where you've been helps with navigation`);
    } else {
      practiceAreas.push('Practice your observation skills - secrets are often right in front of you');
      practiceAreas.push('Work on remembering layouts - knowing where you\'ve been helps with navigation');
    }
  }

  // Practice areas based on difficulty level (if no context-specific areas)
  if (practiceAreas.length === 0) {
    if (currentLevel === 'beginner') {
      practiceAreas.push('Focus on the basics - movement, controls, and understanding how the game works');
      practiceAreas.push('Practice in safe areas first - build confidence before taking on harder challenges');
      practiceAreas.push('Take time to experiment - understanding game systems comes from trying things');
    } else if (currentLevel === 'intermediate') {
      practiceAreas.push('Work on advanced techniques - combos, parries, and efficient strategies');
      practiceAreas.push('Experiment with different builds - see what feels right for your playstyle');
      practiceAreas.push('Practice your timing - quick reactions come from recognizing patterns');
    } else if (currentLevel === 'advanced') {
      practiceAreas.push('Refine your precision - frame-perfect inputs take practice but feel amazing');
      practiceAreas.push('Optimize your routes - finding faster paths is satisfying and efficient');
      practiceAreas.push('Test yourself with restrictions - challenge runs teach you new approaches');
    }
  }

  // Additional practice areas based on question patterns (if not already covered)
  if (topQuestionType?.category === 'strategy' && !questionCategory) {
    practiceAreas.push('Dive into theorycrafting - analyzing builds and strategies is a skill in itself');
    practiceAreas.push('Try different playstyles - variety helps you understand what works and why');
  }
  if (topQuestionType?.category === 'level_walkthrough' && !questionCategory) {
    practiceAreas.push('Hone your exploration skills - finding secrets becomes easier with practice');
    practiceAreas.push('Train your eye for details - environmental clues are everywhere once you know what to look for');
  }

  // Practice areas based on learning speed
  if (learningSpeed === 'slow') {
    practiceAreas.push('Set aside regular practice time - consistency matters more than intensity');
    practiceAreas.push('Focus on one skill at a time - mastery comes from deep practice, not breadth');
  }

  // Genre-specific practice areas
  if (topGenre.includes('rpg') || topGenre.includes('RPG')) {
    practiceAreas.push('Experiment with different character builds - see how stat allocations change your playstyle');
    practiceAreas.push('Work on resource management - efficient inventory and economy management makes RPGs much smoother');
  } else if (topGenre.includes('shooter') || topGenre.includes('action')) {
    practiceAreas.push('Focus on movement and positioning - these are often more important than raw aim');
    practiceAreas.push('Practice your aim in training modes - consistent practice pays off');
  } else if (topGenre.includes('strategy') || topGenre.includes('Strategy')) {
    practiceAreas.push('Work on decision-making speed - quick but thoughtful choices are key');
    practiceAreas.push('Practice managing multiple units - micro and macro strategies work together');
  }

  return practiceAreas;
}

/**
 * Generate learning path recommendations based on user patterns and current question context
 * Phase 3 Step 2: Enhanced Learning Paths
 * Includes: suggested progression, skill building, next challenges, practice areas
 * Now contextualized to the current question for more relevant suggestions
 */
function generateLearningPath(
  patterns: Awaited<ReturnType<typeof analyzeGameplayPatterns>>,
  preferences?: any,
  context?: Awaited<ReturnType<typeof extractQuestionContext>>,
  currentQuestion?: string
): {
  suggestions: string[];
  nextSteps: string[];
} {
  const suggestions: string[] = [];
  const nextSteps: string[] = [];

  // Extract context information
  const detectedGame = context?.detectedGame;
  const questionCategory = context?.questionCategory;
  const detectedGenre = context?.detectedGenre?.[0] || '';
  const lowerQuestion = currentQuestion?.toLowerCase() || '';

  // 1. Context-aware progression suggestions based on current question (PRIORITY)
  if (detectedGame && questionCategory) {
    // Generate contextual suggestions based on what the user is asking about
    if (questionCategory === 'boss_fight') {
      suggestions.push(`Since you're working on boss fights in ${detectedGame}, try practicing attack patterns in easier areas first`);
      suggestions.push(`For ${detectedGame}, watch how other players handle this boss - you might pick up useful strategies`);
      if (lowerQuestion.includes('beat') || lowerQuestion.includes('defeat') || lowerQuestion.includes('how')) {
        suggestions.push(`Focus on learning the boss's attack tells - once you recognize them, ${detectedGame} becomes much more manageable`);
      }
      suggestions.push(`Don't get discouraged by failures - each attempt in ${detectedGame} teaches you something about the boss's patterns`);
    } else if (questionCategory === 'strategy') {
      suggestions.push(`For ${detectedGame}, experiment with different approaches - what works for others might not fit your playstyle`);
      suggestions.push(`Try building your strategy around your preferred playstyle in ${detectedGame}`);
      suggestions.push(`Test your strategy in different situations - see how well it adapts in ${detectedGame}`);
    } else if (questionCategory === 'level_walkthrough' || questionCategory === 'item_lookup') {
      // Check if question mentions temple, dungeon, or specific area
      if (lowerQuestion.includes('temple') || lowerQuestion.includes('dungeon') ||
        lowerQuestion.includes('clear') || lowerQuestion.includes('complete')) {
        suggestions.push(`In ${detectedGame}, take your time navigating this area - rushing can cause you to miss important switches or keys`);
        suggestions.push(`For ${detectedGame}, practice reading maps and remembering layouts - dungeons often require backtracking`);
        suggestions.push(`In ${detectedGame}, look for visual patterns - many puzzles use similar mechanics you can recognize`);
        suggestions.push(`Don't get frustrated if you're stuck in ${detectedGame} - sometimes stepping away and coming back helps you see solutions`);
      } else {
        suggestions.push(`Take your time exploring ${detectedGame} - rushing through might cause you to miss important items or shortcuts`);
        suggestions.push(`In ${detectedGame}, backtracking often reveals secrets you missed the first time`);
        suggestions.push(`Pay attention to environmental details in ${detectedGame} - developers often hide clues in the world`);
      }
    } else if (questionCategory === 'general_gameplay' && detectedGame) {
      // For general gameplay questions, check if it mentions temple/dungeon/area
      if (lowerQuestion.includes('temple') || lowerQuestion.includes('dungeon') ||
        lowerQuestion.includes('clear') || lowerQuestion.includes('complete') ||
        lowerQuestion.includes('area') || lowerQuestion.includes('level')) {
        suggestions.push(`In ${detectedGame}, take your time navigating this area - rushing can cause you to miss important switches or keys`);
        suggestions.push(`For ${detectedGame}, practice reading maps and remembering layouts - dungeons often require backtracking`);
        suggestions.push(`In ${detectedGame}, look for visual patterns - many puzzles use similar mechanics you can recognize`);
        suggestions.push(`Don't get frustrated if you're stuck in ${detectedGame} - sometimes stepping away and coming back helps you see solutions`);
      }
    } else if (questionCategory === 'achievement') {
      suggestions.push(`For achievement hunting in ${detectedGame}, plan your route to maximize efficiency`);
      suggestions.push(`Some achievements in ${detectedGame} are easier to get on a second playthrough - don't stress about getting everything the first time`);
      suggestions.push(`Check if any achievements in ${detectedGame} can be completed together - efficiency saves time`);
    } else if (questionCategory === 'character') {
      suggestions.push(`Experiment with different character builds in ${detectedGame} - find what works for your playstyle`);
      suggestions.push(`Learn the strengths and weaknesses of your character in ${detectedGame}`);
    }
  }

  // 2. Genre-specific contextual suggestions (if no game-specific suggestions)
  if (suggestions.length === 0 && detectedGenre && !detectedGame) {
    const genreLower = detectedGenre.toLowerCase();
    if (genreLower.includes('rpg')) {
      suggestions.push(`Since you're interested in RPGs, try focusing on understanding character builds and stat systems`);
      suggestions.push(`RPGs reward patience - take time to explore side quests and optional content`);
    } else if (genreLower.includes('shooter') || genreLower.includes('action')) {
      suggestions.push(`For action games, practice makes perfect - spend time in training modes if available`);
      suggestions.push(`Focus on movement and positioning - these are often more important than raw aim`);
    } else if (genreLower.includes('strategy')) {
      suggestions.push(`Strategy games reward planning - take time to think through your moves before executing`);
      suggestions.push(`Learn from losses - each defeat teaches you something about the game's mechanics`);
    } else if (genreLower.includes('platformer')) {
      suggestions.push(`Platformers reward precision - practice your movement and timing`);
      suggestions.push(`Take time to learn the level layouts - knowing where to go helps with speed`);
    }
  }

  // 3. Suggested progression for games (context-aware)
  // Always try to get contextual progression, but use it to supplement or replace generic suggestions
  const gameProgression = generateGameProgression(patterns, preferences, context, currentQuestion);

  if (suggestions.length === 0) {
    // No contextual suggestions yet - use progression
    suggestions.push(...gameProgression);
  } else if (suggestions.length < 4) {
    // We have some contextual suggestions, but need more - add contextual progression
    // Filter out generic ones that don't mention the game
    const contextualProgression = gameProgression.filter(p =>
      detectedGame ? p.includes(detectedGame) : true
    );
    suggestions.push(...contextualProgression.slice(0, 4 - suggestions.length));
  }

  // 4. Skill building recommendations (contextualized) - only add if relevant to context
  // If we have good contextual suggestions, be very selective about adding skill building
  const skillBuilding = generateSkillBuilding(patterns, preferences, context);

  if (detectedGame && questionCategory && suggestions.length >= 3) {
    // We have good contextual suggestions - only add skill building if it's highly relevant
    const relevantSkills = skillBuilding.filter(skill => {
      const skillLower = skill.toLowerCase();
      // For boss fights, prefer skills about patterns, dodging, timing
      if (questionCategory === 'boss_fight') {
        return skillLower.includes('pattern') || skillLower.includes('dodge') ||
          skillLower.includes('timing') || skillLower.includes('boss') ||
          skillLower.includes('tell') || skillLower.includes('phase');
      }
      // For strategy, prefer skills about builds, optimization, adaptation
      if (questionCategory === 'strategy') {
        return skillLower.includes('build') || skillLower.includes('strategy') ||
          skillLower.includes('optimize') || skillLower.includes('adapt');
      }
      // For exploration, prefer skills about observation, secrets
      if (questionCategory === 'level_walkthrough' || questionCategory === 'item_lookup') {
        return skillLower.includes('explore') || skillLower.includes('observation') ||
          skillLower.includes('secret') || skillLower.includes('clue');
      }
      return false;
    });

    // Only add 1-2 highly relevant skills
    if (relevantSkills.length > 0) {
      suggestions.push(...relevantSkills.slice(0, 2));
    }
  } else if (suggestions.length < 3) {
    // We need more suggestions, add skill building
    suggestions.push(...skillBuilding);
  }

  // 5. Context-aware next challenges (PRIORITY)
  if (detectedGame && questionCategory) {
    if (questionCategory === 'boss_fight') {
      nextSteps.push(`Once you've mastered this boss in ${detectedGame}, try challenging yourself with harder difficulty settings`);
      nextSteps.push(`Consider trying other challenging bosses in ${detectedGame} - you've built the skills, now apply them`);
      nextSteps.push(`Try beating this boss without taking damage - it's a great way to perfect your timing in ${detectedGame}`);
    } else if (questionCategory === 'strategy') {
      nextSteps.push(`Try applying this strategy to other similar situations in ${detectedGame}`);
      nextSteps.push(`Experiment with variations of this approach in ${detectedGame} - you might find something that works even better`);
      nextSteps.push(`Test this strategy against different challenges in ${detectedGame} - see how versatile it is`);
    } else if (questionCategory === 'level_walkthrough') {
      // Check if question mentions temple, dungeon, or specific area
      if (lowerQuestion.includes('temple') || lowerQuestion.includes('dungeon') ||
        lowerQuestion.includes('clear') || lowerQuestion.includes('complete')) {
        nextSteps.push(`Once you've cleared this area in ${detectedGame}, try applying the same navigation and puzzle-solving skills to other dungeons`);
        nextSteps.push(`Use what you learned here to tackle more challenging areas in ${detectedGame} - the skills transfer`);
        nextSteps.push(`Try finding all the secrets and collectibles in this area of ${detectedGame} - there might be more than you think`);
      } else {
        nextSteps.push(`Now that you've navigated this area, try exploring similar levels in ${detectedGame} with confidence`);
        nextSteps.push(`Use what you learned here to tackle more challenging areas in ${detectedGame}`);
        nextSteps.push(`Try finding all the secrets in this area of ${detectedGame} - there might be more than you think`);
      }
    } else if (questionCategory === 'general_gameplay' && detectedGame) {
      // For general gameplay questions about temples/dungeons
      if (lowerQuestion.includes('temple') || lowerQuestion.includes('dungeon') ||
        lowerQuestion.includes('clear') || lowerQuestion.includes('complete') ||
        lowerQuestion.includes('area') || lowerQuestion.includes('level')) {
        nextSteps.push(`Once you've cleared this area in ${detectedGame}, try applying the same navigation and puzzle-solving skills to other dungeons`);
        nextSteps.push(`Use what you learned here to tackle more challenging areas in ${detectedGame} - the skills transfer`);
        nextSteps.push(`Try finding all the secrets and collectibles in this area of ${detectedGame} - there might be more than you think`);
      }
    } else if (questionCategory === 'achievement') {
      nextSteps.push(`Plan out which achievements you can complete together in ${detectedGame} - efficiency is key`);
      nextSteps.push(`Don't stress about getting everything at once in ${detectedGame} - some achievements are easier on a second playthrough`);
    } else if (questionCategory === 'character') {
      nextSteps.push(`Try this character build in different scenarios in ${detectedGame} - see how versatile it is`);
      nextSteps.push(`Experiment with other character options in ${detectedGame} - variety keeps things interesting`);
    }
  }

  // 6. Next challenges to tackle (only if no contextual next steps)
  if (nextSteps.length === 0) {
    const nextChallenges = generateNextChallenges(patterns, preferences, context);
    nextSteps.push(...nextChallenges);
  }

  // 7. Practice areas for improvement (contextualized) - add these in addition
  const practiceAreas = generatePracticeAreas(patterns, preferences, context);
  // Only add practice areas if we don't already have enough contextual next steps
  if (nextSteps.length < 4) {
    nextSteps.push(...practiceAreas);
  } else {
    // Add just 1-2 most relevant practice areas
    nextSteps.push(...practiceAreas.slice(0, 2));
  }

  // Fallback: Natural-sounding suggestions if we still don't have enough
  // Make these sound conversational and relevant
  const currentLevel = patterns.difficulty?.currentLevel || 'intermediate';

  if (suggestions.length < 3) {
    const needed = 3 - suggestions.length;
    if (currentLevel === 'beginner') {
      const fallbacks = [
        'Take your time learning the basics - there\'s no rush to master everything at once',
        'Don\'t be afraid to lower the difficulty if you\'re struggling - you can always increase it later',
        'Focus on having fun first, then worry about getting better',
      ];
      suggestions.push(...fallbacks.slice(0, needed));
    } else if (currentLevel === 'intermediate') {
      const fallbacks = [
        'Try mixing up your approach - sometimes a fresh perspective helps',
        'Don\'t be afraid to experiment - that\'s how you discover what works best for you',
        'Challenge yourself, but remember it\'s okay to take breaks when things get frustrating',
      ];
      suggestions.push(...fallbacks.slice(0, needed));
    } else if (currentLevel === 'advanced') {
      const fallbacks = [
        'Push yourself, but don\'t forget to enjoy the journey',
        'Share what you\'ve learned - teaching others helps solidify your own understanding',
        'Try something completely different - sometimes stepping outside your comfort zone reveals new insights',
      ];
      suggestions.push(...fallbacks.slice(0, needed));
    } else {
      const fallbacks = [
        'Keep experimenting - that\'s how you improve',
        'Don\'t be afraid to try new things - you might discover a new favorite',
        'Remember, everyone learns at their own pace - focus on your own progress',
      ];
      suggestions.push(...fallbacks.slice(0, needed));
    }
  }

  // Fallback: Natural-sounding next steps if we still don't have enough
  if (nextSteps.length < 3) {
    const needed = 3 - nextSteps.length;
    if (currentLevel === 'beginner') {
      const fallbacks = [
        'Once you feel comfortable, try stepping up the difficulty a bit',
        'Explore different types of games - variety helps you grow as a player',
        'Take on one challenge at a time - you\'ll get there',
      ];
      nextSteps.push(...fallbacks.slice(0, needed));
    } else if (currentLevel === 'intermediate') {
      const fallbacks = [
        'Try tackling something that\'s been intimidating you',
        'Consider diving deeper into games you\'ve enjoyed - there\'s often more to discover',
        'Mix in some easier games between challenging ones - balance is key',
      ];
      nextSteps.push(...fallbacks.slice(0, needed));
    } else if (currentLevel === 'advanced') {
      const fallbacks = [
        'Try something completely outside your usual style - it keeps things fresh',
        'Consider helping others learn - teaching is a great way to deepen your own understanding',
        'Don\'t forget to have fun - even at high levels, games are meant to be enjoyed',
      ];
      nextSteps.push(...fallbacks.slice(0, needed));
    } else {
      const fallbacks = [
        'Keep pushing yourself, but remember to enjoy the process',
        'Try something new - variety keeps gaming exciting',
        'Focus on what makes gaming fun for you',
      ];
      nextSteps.push(...fallbacks.slice(0, needed));
    }
  }

  // Remove duplicates and limit results
  // IMPORTANT: Prioritize contextual suggestions - they should come first
  const uniqueSuggestions = Array.from(new Set(suggestions));
  const uniqueNextSteps = Array.from(new Set(nextSteps));

  // Sort suggestions to prioritize contextual ones (those mentioning the game)
  if (detectedGame) {
    uniqueSuggestions.sort((a, b) => {
      const aHasGame = a.includes(detectedGame);
      const bHasGame = b.includes(detectedGame);
      if (aHasGame && !bHasGame) return -1;
      if (!aHasGame && bHasGame) return 1;
      return 0;
    });
  }

  // Debug logging to help troubleshoot
  if (detectedGame && questionCategory) {
    console.log('[LearningPath] Contextual suggestions generated:', {
      detectedGame,
      questionCategory,
      totalSuggestions: uniqueSuggestions.length,
      totalNextSteps: uniqueNextSteps.length,
      contextualSuggestions: uniqueSuggestions.filter(s => s.includes(detectedGame)).length,
      sampleSuggestions: uniqueSuggestions.slice(0, 3),
    });
  }

  return {
    suggestions: uniqueSuggestions.slice(0, 6), // Increased from 5 to 6 for more comprehensive suggestions
    nextSteps: uniqueNextSteps.slice(0, 4), // Increased from 3 to 4 for more comprehensive next steps
  };
}

// ============================================================================
// Phase 3 Step 3: Progressive Disclosure - Recommendation Visibility Control
// ============================================================================

/**
 * Calculate hours since last recommendation was shown
 * Returns 0 if no previous recommendation exists
 */
function hoursSinceLastRecommendation(user: any): number {
  if (!user?.progress?.personalized?.recommendationHistory?.lastRecommendations) {
    return Infinity; // No previous recommendation = can show
  }

  const lastRecTime = new Date(user.progress.personalized.recommendationHistory.lastRecommendations);
  const now = new Date();
  const hoursDiff = (now.getTime() - lastRecTime.getTime()) / (1000 * 60 * 60);

  return hoursDiff;
}

/**
 * Determine if recommendations should be shown to the user
 * Phase 3 Step 3: Progressive Disclosure
 * 
 * Only shows recommendations if:
 * 1. User has asked 5+ questions (conversationCount >= 5)
 * 2. User has been using the app regularly (sessionFrequency !== "sporadic")
 * 3. User hasn't dismissed recommendations recently (dismissedRecently !== true)
 * 4. Time since last recommendation > 2 hours
 * 
 * @param user - User document from database
 * @returns true if recommendations should be shown, false otherwise
 */
export function shouldShowRecommendations(user: any): boolean {
  if (!user) {
    return false;
  }

  // Condition 1: User has asked at least 5 questions
  const hasEnoughQuestions = (user.conversationCount || 0) >= 5;

  // Condition 2: User has been using the app regularly (not sporadic)
  // If sessionFrequency is "sporadic" but user has 10+ questions, they're still considered regular
  // (they may have asked questions over a longer period, but still engaged)
  const sessionFrequency = user.progress?.personalized?.gameplayPatterns?.sessionFrequency;
  const hasEnoughForPattern = (user.conversationCount || 0) >= 10;
  const isRegularUser = sessionFrequency
    ? (sessionFrequency !== 'sporadic' || hasEnoughForPattern) // If sporadic but 10+ questions, still regular
    : hasEnoughForPattern; // If no pattern yet, require 10+ questions as proxy for regular use

  // Condition 3: User hasn't dismissed recommendations recently
  const dismissedRecently = user.progress?.personalized?.recommendationHistory?.dismissedRecently || false;
  const notDismissed = !dismissedRecently;

  // Condition 4: Time since last recommendation > 2 hours
  const hoursSinceLast = hoursSinceLastRecommendation(user);
  const enoughTimePassed = hoursSinceLast > 2;

  // All conditions must be met
  const conditions = [
    hasEnoughQuestions,
    isRegularUser,
    notDismissed,
    enoughTimePassed,
  ];

  return conditions.every((c) => c);
}

/**
 * Update recommendation history after showing recommendations
 * Records the timestamp and resets dismissedRecently flag
 */
export async function updateRecommendationHistory(username: string): Promise<void> {
  try {
    await User.findOneAndUpdate(
      { username },
      {
        $set: {
          'progress.personalized.recommendationHistory.lastRecommendations': new Date(),
          'progress.personalized.recommendationHistory.dismissedRecently': false,
        },
      },
      { upsert: false } // Don't create if doesn't exist
    );
  } catch (error) {
    console.error('[Recommendations] Error updating recommendation history:', error);
    // Silent failure - don't break the flow
  }
}

/**
 * Mark recommendations as dismissed by user
 * Sets dismissedRecently flag to true
 */
export async function dismissRecommendations(username: string): Promise<void> {
  try {
    await User.findOneAndUpdate(
      { username },
      {
        $set: {
          'progress.personalized.recommendationHistory.dismissedRecently': true,
        },
      },
      { upsert: false }
    );
  } catch (error) {
    console.error('[Recommendations] Error dismissing recommendations:', error);
    // Silent failure
  }
}

// ============================================================================
// Phase 3 Step 1: Main Recommendation Engine - Orchestrator Function
// ============================================================================

/**
 * Main function to generate personalized recommendations
 * Phase 3 Step 1: Creates comprehensive recommendations based on user patterns
 * Phase 3 Step 3: Includes progressive disclosure check
 * 
 * @param username - User's username
 * @param currentQuestion - Current question being asked (optional, for context)
 * @param forceShow - If true, bypasses progressive disclosure check (for testing/admin use)
 * @returns Comprehensive recommendation object with tips, strategies, and learning paths
 */
export const generatePersonalizedRecommendations = async (
  username: string,
  currentQuestion?: string,
  forceShow: boolean = false
): Promise<{
  strategyTips: {
    tips: string[];
    category: string;
  };
  learningPath: {
    suggestions: string[];
    nextSteps: string[];
  };
  personalizedTips: {
    tips: string[];
    basedOn: string;
  };
}> => {
  // console.log('[generatePersonalizedRecommendations] Called with:', {
  //   username,
  //   hasQuestion: !!currentQuestion,
  //   question: currentQuestion ? currentQuestion.substring(0, 100) : 'none',
  //   forceShow,
  // });

  try {
    // 1. Get user data first (needed for progressive disclosure check)
    const user = await User.findOne({ username }).lean() as any;

    // 2. Extract context from current question FIRST (before progressive disclosure check)
    // This ensures we always have context available, even if we return early
    // console.log('[Recommendations] About to extract context. currentQuestion:', currentQuestion ? currentQuestion.substring(0, 100) : 'none');
    let context: Awaited<ReturnType<typeof extractQuestionContext>> = {};

    if (currentQuestion) {
      try {
        // console.log('[Recommendations] Calling extractQuestionContext...');
        context = await extractQuestionContext(currentQuestion);
        // console.log('[Recommendations] extractQuestionContext returned:', {
        //   detectedGame: context?.detectedGame,
        //   questionCategory: context?.questionCategory,
        //   detectedGenre: context?.detectedGenre,
        //   difficultyHint: context?.difficultyHint,
        //   contextKeys: Object.keys(context || {}),
        // });
      } catch (error) {
        console.error('[Recommendations] Error calling extractQuestionContext:', error);
        if (error instanceof Error) {
          console.error('[Recommendations] Error stack:', error.stack);
        }
        context = {};
      }
    } else {
      // console.log('[Recommendations] No currentQuestion provided, using empty context');
    }

    // 3. Phase 3 Step 3: Check if recommendations should be shown
    // Skip check if forceShow is true (for testing/admin use)
    // Also bypass check if we have a current question with context (user is actively asking)
    const hasContextualQuestion = !!(currentQuestion && (context?.detectedGame || context?.questionCategory));
    const shouldBypassCheck = forceShow || hasContextualQuestion;

    if (!shouldBypassCheck && !shouldShowRecommendations(user)) {
      // Return empty recommendations with a reason
      return {
        strategyTips: {
          tips: [],
          category: 'general_gameplay',
        },
        learningPath: {
          suggestions: [],
          nextSteps: [],
        },
        personalizedTips: {
          tips: [],
          basedOn: 'Not enough activity yet',
        },
      };
    }

    // 4. Get user patterns (fresh analysis)
    const patterns = await analyzeGameplayPatterns(username, true); // forceRefresh=true for fresh analysis

    // 5. Get user preferences from stored data
    const preferences = user?.progress?.personalized?.preferenceProfile;

    // 6. Context is already extracted above, now use it for recommendations
    // Debug: Log final context for troubleshooting (commented out for production)
    // if (currentQuestion) {
    //   console.log('[Recommendations] Final context object:', {
    //     detectedGame: context?.detectedGame,
    //     questionCategory: context?.questionCategory,
    //     detectedGenre: context?.detectedGenre,
    //     difficultyHint: context?.difficultyHint,
    //     question: currentQuestion.substring(0, 100),
    //     contextKeys: Object.keys(context || {}),
    //   });
    //   
    //   // Additional debug: Check if context extraction actually worked
    //   if (!context?.detectedGame && currentQuestion.toLowerCase().includes('cuphead')) {
    //     console.warn('[Recommendations] WARNING: Cuphead mentioned in question but not detected in context!');
    //   }
    //   if (!context?.questionCategory && (currentQuestion.toLowerCase().includes('boss') || currentQuestion.toLowerCase().includes('defeat'))) {
    //     console.warn('[Recommendations] WARNING: Boss fight keywords found but category not detected!');
    //   }
    // }

    // 7. Generate all recommendation types (excluding game recommendations)
    const strategyTips = await generateStrategyTips(patterns, context, preferences);
    const learningPath = generateLearningPath(patterns, preferences, context, currentQuestion);
    // Pass already-calculated patterns to avoid duplicate expensive analysis
    const personalizedTips = await generatePersonalizedTips(username, currentQuestion, patterns);

    // Update recommendation history (only if we're actually showing recommendations)
    // This runs asynchronously so it doesn't slow down the response
    setImmediate(async () => {
      await updateRecommendationHistory(username);
    });

    return {
      strategyTips,
      learningPath,
      personalizedTips,
    };
  } catch (error) {
    console.error('[Recommendations] Error generating personalized recommendations:', error);

    // Return safe defaults on error
    return {
      strategyTips: {
        tips: [],
        category: 'general_gameplay',
      },
      learningPath: {
        suggestions: [],
        nextSteps: [],
      },
      personalizedTips: {
        tips: [],
        basedOn: 'Error generating tips',
      },
    };
  }
};

