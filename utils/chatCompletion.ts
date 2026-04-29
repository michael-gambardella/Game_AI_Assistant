import { getOpenAIClient, openaiRequestOptionsForModel, aiCache } from './openaiClient';
import { fetchFromIGDB, fetchFromRAWG, fetchVersionInfo, fetchSeriesFromIGDB, fetchSeriesFromRAWG, fetchGameLevelsFromIGDB, fetchGameDetailsFromRAWG } from './gameMetadata';
import { selectModelForQuestion, modelUsageStats } from './modelSelection';
import { extractGameTitleFromQuestion } from './gameTitleExtractor';


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
