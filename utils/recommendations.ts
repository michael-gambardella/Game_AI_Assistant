import { externalApiClient } from './axiosConfig';
import { getOpenAIClient, openaiRequestOptionsForModel } from './openaiClient';
import { selectModelForQuestion, modelUsageStats } from './modelSelection';
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