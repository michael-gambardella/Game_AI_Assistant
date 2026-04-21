/**
 * API Endpoint: Dismiss Recommendations
 * Phase 3 Step 3: Mark recommendations as dismissed by user
 * 
 * Usage:
 *   POST /api/dismiss-recommendations
 *   Body: { username: "TestUser1" }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import { dismissRecommendations } from '../../utils/generateRecommendations';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username } = req.body;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ 
      error: 'Username is required',
      usage: 'POST /api/dismiss-recommendations with body: { username: "TestUser1" }'
    });
  }

  try {

    // Mark recommendations as dismissed
    await dismissRecommendations(username);

    return res.status(200).json({
      success: true,
      message: 'Recommendations dismissed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error dismissing recommendations:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withDatabase(handler);
