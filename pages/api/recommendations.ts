/**
 * API Endpoint: Get Personalized Recommendations
 * Phase 3 Step 3: Fetch recommendations for a user
 * 
 * Usage:
 *   GET /api/recommendations?username=
 *   GET /api/recommendations?username=username&question=How do I beat the final boss?
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import { generatePersonalizedRecommendations } from '../../utils/generateRecommendations';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, question, forceShow } = req.query;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ 
      error: 'Username parameter required',
      usage: 'GET /api/recommendations?username=TestUser1&question=How do I beat the final boss?&forceShow=true'
    });
  }

  try {

    // Check progressive disclosure conditions
    const { shouldShowRecommendations } = await import('../../utils/generateRecommendations');
    const User = (await import('../../models/User')).default;
    const user = await User.findOne({ username }).lean() as any;
    const shouldShow = shouldShowRecommendations(user);

    // Parse forceShow parameter (for testing - bypasses progressive disclosure)
    const shouldForceShow = forceShow === 'true';

    // Generate recommendations
    const currentQuestion = question && typeof question === 'string' ? question : undefined;
    // console.log('[Recommendations API] Received question parameter:', {
    //   raw: question,
    //   decoded: currentQuestion,
    //   type: typeof question,
    //   length: currentQuestion?.length,
    // });
    
    const recommendations = await generatePersonalizedRecommendations(
      username,
      currentQuestion,
      shouldForceShow // Allow bypassing for testing
    );

    // Get progressive disclosure info for debugging
    const progressiveDisclosureInfo = {
      shouldShow,
      forceShowUsed: shouldForceShow,
      conditions: {
        hasEnoughQuestions: (user?.conversationCount || 0) >= 5,
        isRegularUser: user?.progress?.personalized?.gameplayPatterns?.sessionFrequency !== 'sporadic' || (user?.conversationCount || 0) >= 10,
        notDismissed: !(user?.progress?.personalized?.recommendationHistory?.dismissedRecently || false),
        enoughTimePassed: !user?.progress?.personalized?.recommendationHistory?.lastRecommendations || 
          ((Date.now() - new Date(user.progress.personalized.recommendationHistory.lastRecommendations).getTime()) / (1000 * 60 * 60)) > 2,
      },
      userData: {
        conversationCount: user?.conversationCount || 0,
        sessionFrequency: user?.progress?.personalized?.gameplayPatterns?.sessionFrequency || 'not set',
        dismissedRecently: user?.progress?.personalized?.recommendationHistory?.dismissedRecently || false,
        lastRecommendations: user?.progress?.personalized?.recommendationHistory?.lastRecommendations || null,
      },
    };

    return res.status(200).json({
      success: true,
      recommendations,
      progressiveDisclosure: progressiveDisclosureInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in recommendations endpoint:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      recommendations: null,
    });
  }
}

export default withDatabase(handler);
