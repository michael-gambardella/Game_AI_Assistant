import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminOrCron } from '../../../middleware/auth';
import fs from 'fs';
import path from 'path';

/**
 * POST /api/automated-users/clear-image-cache
 * 
 * Clear the image search cache (useful for testing or removing problematic cached images)
 * 
 * Body: {
 *   gameTitle?: string,  // Optional: clear cache for specific game only
 *   clearAll?: boolean   // If true, clear entire cache
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Operations endpoint: admin session or scheduled job (Authorization: Bearer <CRON_SECRET>).
  // Previously unauthenticated - anyone could run it.
  if (!(await requireAdminOrCron(req, res))) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameTitle, clearAll = false } = req.body;

  try {
    const cachePath = path.join(process.cwd(), 'data', 'automated-users', 'image-search-cache.json');
    
    if (!fs.existsSync(cachePath)) {
      return res.status(200).json({
        success: true,
        message: 'Cache file does not exist',
        cleared: false
      });
    }

    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

    if (clearAll) {
      // Clear entire cache
      cache.cache = {};
      cache.metadata.totalCached = 0;
      cache.metadata.cacheHits = 0;
      cache.metadata.cacheMisses = 0;
      
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
      
      return res.status(200).json({
        success: true,
        message: 'Entire cache cleared',
        cleared: true
      });
    } else if (gameTitle) {
      // Clear cache for specific game
      const normalizedGame = gameTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      if (cache.cache[normalizedGame]) {
        const entriesBefore = Object.keys(cache.cache[normalizedGame]).length;
        delete cache.cache[normalizedGame];
        cache.metadata.totalCached = Object.values(cache.cache).reduce(
          (sum: number, gameCache: any) => sum + Object.keys(gameCache).length,
          0
        );
        
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
        
        return res.status(200).json({
          success: true,
          message: `Cache cleared for ${gameTitle}`,
          cleared: true,
          entriesRemoved: entriesBefore
        });
      } else {
        return res.status(200).json({
          success: true,
          message: `No cache entries found for ${gameTitle}`,
          cleared: false
        });
      }
    } else {
      // Clear YouTube thumbnails and problematic entries
      let clearedCount = 0;
      const gamesToCheck = Object.keys(cache.cache);
      
      for (const game of gamesToCheck) {
        const keywords = Object.keys(cache.cache[game]);
        for (const keyword of keywords) {
          const cachedPath = cache.cache[game][keyword];
          const pathLower = cachedPath.toLowerCase();
          
          // Check for YouTube indicators
          if (pathLower.includes('ytimg') || pathLower.includes('youtube') || pathLower.includes('youtu.be')) {
            delete cache.cache[game][keyword];
            clearedCount++;
          } else {
            // Check filename for let's play patterns
            const filename = path.basename(cachedPath).toLowerCase();
            const problematicPatterns = [
              /part\s*\d+/i,
              /episode\s*\d+/i,
              /ep\s*\d+/i
            ];
            
            for (const pattern of problematicPatterns) {
              if (pattern.test(filename)) {
                delete cache.cache[game][keyword];
                clearedCount++;
                break;
              }
            }
          }
        }
        
        // Remove empty game entries
        if (Object.keys(cache.cache[game]).length === 0) {
          delete cache.cache[game];
        }
      }
      
      cache.metadata.totalCached = Object.values(cache.cache).reduce(
        (sum: number, gameCache: any) => sum + Object.keys(gameCache).length,
        0
      );
      
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
      
      return res.status(200).json({
        success: true,
        message: `Cleared ${clearedCount} problematic cache entries`,
        cleared: clearedCount > 0,
        entriesRemoved: clearedCount
      });
    }
  } catch (error: any) {
    console.error('[CLEAR CACHE] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      message: error.message
    });
  }
}
