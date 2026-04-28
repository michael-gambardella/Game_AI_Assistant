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
