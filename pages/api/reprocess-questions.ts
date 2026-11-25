/**
 * API Endpoint to re-process questions and update their metadata
 * 
 * This endpoint allows you to re-run metadata extraction on existing questions
 * to fix incorrect game titles or add missing metadata.
 * 
 * Usage:
 * - GET /api/reprocess-questions?username=TestUser1 - Process one user's questions
 * - GET /api/reprocess-questions?limit=50 - Process 50 questions (all users)
 * - GET /api/reprocess-questions?onlyIncorrectGameTitles=true - Only fix incorrect game titles
 * - GET /api/reprocess-questions?onlyMissingMetadata=true - Only add missing metadata
 * 
 * Options:
 * - username: Process only this user's questions
 * - limit: Maximum number of questions to process (default: 100)
 * - skip: Number of questions to skip (for pagination)
 * - onlyIncorrectGameTitles: Only update questions with detectedGame field (to fix incorrect titles)
 * - onlyMissingMetadata: Only process questions missing metadata fields
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminOrCron } from '../../middleware/auth';
import { reprocessQuestions } from '../../utils/reprocessQuestions';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Operations endpoint: admin session or scheduled job (Authorization: Bearer <CRON_SECRET>).
  // Previously unauthenticated - anyone could run it.
  if (!(await requireAdminOrCron(req, res))) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    username, 
    limit, 
    skip, 
    onlyIncorrectGameTitles,
    onlyMissingMetadata 
  } = req.query;

  try {
    const options: any = {};

    if (limit) {
      const limitNum = parseInt(limit as string, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        options.limit = limitNum;
      }
    }

    if (skip) {
      const skipNum = parseInt(skip as string, 10);
      if (!isNaN(skipNum) && skipNum >= 0) {
        options.skip = skipNum;
      }
    }

    if (onlyIncorrectGameTitles === 'true') {
      options.onlyIncorrectGameTitles = true;
    }

    if (onlyMissingMetadata === 'true') {
      options.onlyMissingMetadata = true;
    }

    // Run the re-processing
    const results = await reprocessQuestions(
      username as string | undefined,
      options
    );

    return res.status(200).json({
      success: true,
      message: 'Question re-processing completed',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in reprocess-questions:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

