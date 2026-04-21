import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import Question from '../../models/Question';
import { getChatCompletion } from '../../utils/aiHelper';
import { GameResumeResponse } from '../../types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GameResumeResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username } = req.query;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // Connect to database

    // Find the most recent question with a detected game
    const recentGameQuestion = await Question.findOne({
      username,
      detectedGame: { $exists: true, $ne: null, $nin: ['', null] }
    })
      .sort({ timestamp: -1 })
      .select('detectedGame question response questionCategory timestamp')
      .lean() as any;

    if (!recentGameQuestion || !recentGameQuestion.detectedGame) {
      return res.status(200).json({
        // Return empty response if no game found (not an error)
      });
    }

    const gameTitle = recentGameQuestion.detectedGame as string;

    // Get all questions about this game to understand context
    const gameQuestions = await Question.find({
      username,
      detectedGame: gameTitle
    })
      .sort({ timestamp: -1 })
      .limit(10) // Get last 10 questions about this game
      .select('question response questionCategory timestamp')
      .lean();

    // Analyze what the user has asked about
    const questionTypes = gameQuestions.map(q => q.questionCategory).filter(Boolean);
    const recentQuestions = gameQuestions.slice(0, 3).map(q => q.question);

    // Determine suggestion type based on what they've asked
    // If they asked about challenges/bosses, suggest next challenge
    // If they asked about builds/strategies, suggest best build
    // If they asked about achievements/collectibles, suggest hidden achievements
    let suggestionType: 'challenge' | 'build' | 'achievement' = 'challenge';
    
    if (questionTypes.some(type => 
      type?.includes('achievement') || 
      type?.includes('collectible') || 
      type?.includes('completion')
    )) {
      suggestionType = 'achievement';
    } else if (questionTypes.some(type => 
      type?.includes('build') || 
      type?.includes('strategy') || 
      type?.includes('loadout')
    )) {
      suggestionType = 'build';
    }

    // Generate suggestion using AI
    const contextSummary = recentQuestions.length > 0
      ? `Recent questions: ${recentQuestions.join('; ')}`
      : 'No recent questions found';

    const systemPrompt = `You are Video Game Wingman, an enthusiastic gaming assistant. Generate a helpful, engaging suggestion to help a player continue their journey in a game they've been playing.`;

    const userPrompt = `A player has been asking questions about "${gameTitle}". 

${contextSummary}

Generate a ${suggestionType === 'challenge' ? 'next challenge or boss fight' : suggestionType === 'build' ? 'optimal build or strategy' : 'hidden achievement or collectible'} suggestion for this game.

CRITICAL: The questionPrompt MUST include the game title "${gameTitle}" so the AI can identify which game you're asking about.

Format your response as JSON with these exact fields:
{
  "type": "${suggestionType}",
  "title": "Short, engaging title (max 60 chars)",
  "description": "Brief description of the suggestion (2-3 sentences)",
  "questionPrompt": "A question the player can ask to learn more about this. MUST include '${gameTitle}' in the question (e.g., 'How do I beat [boss name] in ${gameTitle}?' or 'What is the best build for ${gameTitle}?')"
}

Only return valid JSON, nothing else.`;

    const aiResponse = await getChatCompletion(userPrompt, systemPrompt);

    if (!aiResponse) {
      return res.status(500).json({ error: 'Failed to generate suggestion' });
    }

    // Parse AI response (it should be JSON)
    let suggestion;
    try {
      // Try to extract JSON from response (in case AI adds extra text)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        suggestion = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      // Fallback: create a simple suggestion
      suggestion = {
        type: suggestionType,
        title: suggestionType === 'challenge' 
          ? `Continue Your Adventure in ${gameTitle}`
          : suggestionType === 'build'
          ? `Optimize Your Build in ${gameTitle}`
          : `Discover Hidden Secrets in ${gameTitle}`,
        description: suggestionType === 'challenge'
          ? `Ready for the next challenge? Let's find the next boss fight or difficult area you should tackle.`
          : suggestionType === 'build'
          ? `Want to optimize your character? Let's find the best build for your playstyle.`
          : `Looking for hidden achievements? Let's discover some secrets you might have missed.`,
        questionPrompt: suggestionType === 'challenge'
          ? `What is the next challenging boss fight or area in ${gameTitle}?`
          : suggestionType === 'build'
          ? `What is the best build for ${gameTitle}?`
          : `What are some hidden achievements or secrets in ${gameTitle}?`
      };
    }

    // Validate suggestion structure
    if (!suggestion.title || !suggestion.description || !suggestion.questionPrompt) {
      // Use fallback if AI response is incomplete
      suggestion = {
        type: suggestionType,
        title: `Continue Your Journey in ${gameTitle}`,
        description: `Ready to continue? Let's find your next challenge, optimal build, or hidden achievement.`,
        questionPrompt: `What should I do next in ${gameTitle}?`
      };
    }

    // CRITICAL: Ensure game title is included in questionPrompt
    // Check if game title is mentioned in the question (case-insensitive)
    const questionLower = suggestion.questionPrompt.toLowerCase();
    const gameTitleLower = gameTitle.toLowerCase();
    
    // Check if game title appears in a natural context (not just as a substring)
    // Look for patterns like "in [Game]", "for [Game]", "from [Game]", "[Game]'s", etc.
    const naturalPatterns = [
      new RegExp(`\\b(?:in|for|from|on|of|about|regarding)\\s+${gameTitleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
      new RegExp(`\\b${gameTitleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:boss|enemy|character|level|area|item|weapon|build|strategy|achievement|secret)`, 'i'),
      new RegExp(`\\b${gameTitleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'s\\b`, 'i'),
    ];
    
    const hasNaturalGameTitle = naturalPatterns.some(pattern => pattern.test(questionLower)) ||
                                 questionLower.includes(` ${gameTitleLower} `) ||
                                 questionLower.endsWith(` ${gameTitleLower}`) ||
                                 questionLower.startsWith(`${gameTitleLower} `);
    
    if (!hasNaturalGameTitle) {
      // Game title is missing or not in a natural position - add it to the question
      // Try to add it naturally based on question structure
      if (suggestion.questionPrompt.includes('?')) {
        // If question ends with ?, add "in [game]" before the ?
        suggestion.questionPrompt = suggestion.questionPrompt.replace(
          '?',
          ` in ${gameTitle}?`
        );
      } else {
        // Otherwise, append " in [game]"
        suggestion.questionPrompt = `${suggestion.questionPrompt} in ${gameTitle}`;
      }
      
      // Log for debugging
      console.log(`[Game Resume] Added game title to question: "${suggestion.questionPrompt}"`);
    }

    return res.status(200).json({
      game: gameTitle,
      suggestion: {
        type: suggestionType,
        title: suggestion.title,
        description: suggestion.description,
        questionPrompt: suggestion.questionPrompt
      }
    });

  } catch (error) {
    console.error('Error in game-resume API:', error);
    return res.status(500).json({
      error: 'Failed to fetch game resume'
    });
  }
}

export default withDatabase(handler);
