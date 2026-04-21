import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import { ChallengeProgress, ChallengeProgresses, ChallengeStreak, ChallengeReward, ChallengeHistoryEntry } from '../../types';
import { logger } from '../../utils/logger';
import { updateChallengeStreak, getTodayDateString } from '../../utils/challengeStreak';
import { checkAndAwardRewards } from '../../utils/checkChallengeRewards';
import { DAILY_CHALLENGES } from '../../utils/dailyChallenges';
import { getTodaysChallenges } from '../../utils/challengeSelector';

/**
 * GET /api/challenge-progress?username=xxx
 * Returns the challenge progress for today's challenges (Phase 2: Multiple Challenges)
 * Also supports legacy single challenge format for backward compatibility
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ 
    progress?: ChallengeProgress | null; // Legacy: single challenge (backward compatibility)
    progresses?: ChallengeProgress[]; // Phase 2: multiple challenges
    streak: ChallengeStreak | null;
    rewards?: ChallengeReward[];
    newRewards?: ChallengeReward[];
  } | { error: string; details?: string }>
) {
  if (req.method === 'GET') {
    try {
      const { username } = req.query;

      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
      }


      const user = await User.findOne({ username }).select('challengeProgress challengeProgresses challengeStreak challengeRewards');

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get today's date string (UTC)
      const todayString = getTodayDateString();

      // Phase 2: Check challengeProgresses array first (multiple challenges)
      if (user.challengeProgresses && Array.isArray(user.challengeProgresses) && user.challengeProgresses.length > 0) {
        // Filter progress entries for today
        const todayProgresses = user.challengeProgresses
          .filter((p: any) => p && p.date === todayString)
          .map((p: any) => ({
            challengeId: p.challengeId || '',
            date: p.date,
            completed: p.completed || false,
            completedAt: p.completedAt ? new Date(p.completedAt) : undefined,
            progress: p.progress,
            target: p.target,
          }));

        return res.status(200).json({ 
          progresses: todayProgresses,
          streak: user.challengeStreak || null,
          rewards: user.challengeRewards || []
        });
      }

      // Legacy: Check single challengeProgress (backward compatibility)
      if (
        user.challengeProgress &&
        user.challengeProgress.date === todayString
      ) {
        // Convert completedAt to Date if it's a string
        const progress: ChallengeProgress = {
          challengeId: user.challengeProgress.challengeId || '',
          date: user.challengeProgress.date,
          completed: user.challengeProgress.completed || false,
          completedAt: user.challengeProgress.completedAt
            ? new Date(user.challengeProgress.completedAt)
            : undefined,
          progress: user.challengeProgress.progress,
          target: user.challengeProgress.target,
        };
        return res.status(200).json({ 
          progress, // Legacy format
          progresses: [progress], // Also include in new format for compatibility
          streak: user.challengeStreak || null,
          rewards: user.challengeRewards || []
        });
      }

      // No progress for today
      return res.status(200).json({ 
        progress: null, // Legacy format
        progresses: [], // Phase 2 format
        streak: user.challengeStreak || null,
        rewards: user.challengeRewards || []
      });
    } catch (error) {
      logger.error('Error fetching challenge progress:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return res.status(500).json({
        error: 'Failed to fetch challenge progress',
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const { username, progress, progresses } = req.body;

      // Debug logging in development
      if (process.env.NODE_ENV === 'development') {
        console.log('[Challenge Progress API] POST request received:', {
          username,
          hasProgress: !!progress,
          hasProgresses: !!progresses,
          progressType: typeof progress,
          progressIsArray: Array.isArray(progress),
          progressesIsArray: Array.isArray(progresses),
        });
      }

      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
      }

      // Phase 2: Support both single progress and array of progresses
      let progressEntries: ChallengeProgress[] = [];
      
      if (progresses && Array.isArray(progresses)) {
        // New format: array of progresses
        progressEntries = progresses;
      } else if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
        // Legacy format: single progress object
        progressEntries = [progress];
      } else {
        return res.status(400).json({ 
          error: 'Progress data is required',
          details: 'Expected either a progress object or progresses array with challengeId, date, and completed fields'
        });
      }

      // Validate all progress entries
      for (let i = 0; i < progressEntries.length; i++) {
        const p = progressEntries[i];
        if (!p || typeof p !== 'object') {
          return res.status(400).json({ 
            error: 'Invalid progress entry',
            details: `Progress entry at index ${i} must be an object`
          });
        }
        if (!p.challengeId || typeof p.challengeId !== 'string') {
          return res.status(400).json({ 
            error: 'Invalid progress data',
            details: `challengeId is required and must be a string for entry at index ${i}`
          });
        }
        if (typeof p.completed !== 'boolean') {
          return res.status(400).json({ 
            error: 'Invalid progress data',
            details: `completed field is required and must be a boolean for entry at index ${i}`
          });
        }
      }


      // Get today's date string to ensure we're saving for today (UTC)
      const todayString = getTodayDateString();

      // Get existing user to check current progress, streak, and rewards
      const existingUser = await User.findOne({ username }).select('challengeProgress challengeProgresses challengeStreak challengeRewards challengeHistory');

      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Phase 2: Process multiple progress entries
      // Ensure all dates are set to today
      const progressEntriesToSave = progressEntries.map(p => ({
        ...p,
        date: todayString,
      }));

      // Get existing progress entries for today (from challengeProgresses array)
      const existingProgresses = (existingUser.challengeProgresses || []) as any[];
      const todayProgresses = existingProgresses.filter((p: any) => p && p.date === todayString);
      
      // Track which challenges are already completed to prevent duplicates
      const completedChallengeIds = new Set(
        todayProgresses
          .filter((p: any) => p.completed)
          .map((p: any) => p.challengeId)
      );

      // Also check challengeHistory to prevent duplicate history entries
      // A challenge might have a history entry even if progress entry doesn't exist
      const existingHistory = (existingUser.challengeHistory || []) as any[];
      const todayHistoryEntries = existingHistory.filter((h: any) => h && h.date === todayString);
      const challengesWithHistoryToday = new Set(
        todayHistoryEntries.map((h: any) => h.challengeId)
      );

      // Process each progress entry
      // Track which challenge IDs are being updated in this batch
      const updatedChallengeIds = new Set<string>();
      const newProgressEntries: any[] = [];
      const completedEntries: ChallengeProgress[] = [];
      const historyEntries: ChallengeHistoryEntry[] = [];

      for (const progressEntry of progressEntriesToSave) {
        // Skip if this challenge is already completed today (prevent duplicates)
        if (progressEntry.completed && completedChallengeIds.has(progressEntry.challengeId)) {
          logger.info('Skipping duplicate challenge completion', {
            username,
            challengeId: progressEntry.challengeId,
          });
          continue;
        }

        // Track that we're updating this challenge
        updatedChallengeIds.add(progressEntry.challengeId);

        // Prepare challenge progress object for database
        const challengeProgressData: any = {
          challengeId: progressEntry.challengeId,
          date: progressEntry.date,
          completed: progressEntry.completed,
        };

        // Only include optional fields if they exist
        if (progressEntry.completedAt) {
          challengeProgressData.completedAt = new Date(progressEntry.completedAt);
        }
        if (progressEntry.progress !== undefined) {
          challengeProgressData.progress = progressEntry.progress;
        }
        if (progressEntry.target !== undefined) {
          challengeProgressData.target = progressEntry.target;
        }

        newProgressEntries.push(challengeProgressData);

        // Track completed challenges for streak and history
        if (progressEntry.completed) {
          completedEntries.push(progressEntry);
          completedChallengeIds.add(progressEntry.challengeId);

          // Only create history entry if one doesn't already exist for this challenge today
          // This prevents duplicate history entries when challenges are re-saved
          if (!challengesWithHistoryToday.has(progressEntry.challengeId)) {
            const challenge = DAILY_CHALLENGES.find(c => c.id === progressEntry.challengeId);
            if (challenge) {
              historyEntries.push({
                challengeId: progressEntry.challengeId,
                date: progressEntry.date,
                completedAt: progressEntry.completedAt || new Date(),
                challengeTitle: challenge.title,
                challengeDescription: challenge.description,
                difficulty: (challenge as any).difficulty, // Will be undefined until Phase 3
                streakAtCompletion: 0, // Will be updated after streak calculation
              });
              // Track that we're creating a history entry for this challenge
              challengesWithHistoryToday.add(progressEntry.challengeId);
            }
          } else {
            logger.info('Skipping duplicate history entry creation', {
              username,
              challengeId: progressEntry.challengeId,
              date: todayString,
            });
          }
        }
      }

      // Phase 2: Update streak ONLY if ALL 3 challenges for today are completed
      // Streak is maintained if user completes all 3 challenges per day
      let updatedStreak: ChallengeStreak | undefined;
      let newRewards: ChallengeReward[] = [];
      
      // Get today's 3 challenges to check if all are completed
      const todaysChallenges = getTodaysChallenges(username);
      const todaysChallengeIds = new Set(todaysChallenges.map(c => c.id));
      
      // Count how many of today's challenges are completed
      // We need to check the final merged state: existing today's entries + new entries
      // existingTodayProgresses is defined later, so we'll calculate it here
      const existingTodayNotUpdated = todayProgresses.filter((p: any) => 
        p && !updatedChallengeIds.has(p.challengeId)
      );
      const finalTodayProgresses = [
        ...existingTodayNotUpdated,
        ...newProgressEntries.filter(p => p.date === todayString)
      ];
      
      // Count how many of today's challenges are completed
      const completedTodayChallengeIds = new Set(
        finalTodayProgresses
          .filter((p: any) => p && p.completed && todaysChallengeIds.has(p.challengeId))
          .map((p: any) => p.challengeId)
      );
      
      // Only update streak if ALL 3 challenges for today are completed
      const allChallengesCompleted = completedTodayChallengeIds.size >= 3;
      
      if (allChallengesCompleted && completedEntries.length > 0) {
        // Check if streak was already updated today (prevent duplicate updates)
        const lastCompletedDate = existingUser?.challengeStreak?.lastCompletedDate;
        const streakAlreadyUpdatedToday = lastCompletedDate === todayString;
        
        if (!streakAlreadyUpdatedToday) {
          const currentStreak = existingUser?.challengeStreak || null;
          updatedStreak = updateChallengeStreak(
            currentStreak,
            todayString
          );

          // Check for new milestone rewards
          if (updatedStreak) {
            const existingRewards = existingUser?.challengeRewards || [];
            newRewards = checkAndAwardRewards(updatedStreak, existingRewards);
          }
        } else {
          // Streak already updated today, use existing streak
          updatedStreak = existingUser?.challengeStreak || null;
        }

        // Update streakAtCompletion in history entries
        historyEntries.forEach(entry => {
          entry.streakAtCompletion = updatedStreak?.currentStreak || 0;
        });
      } else if (completedEntries.length > 0) {
        // Some challenges completed but not all 3 - don't update streak
        // But still update streakAtCompletion in history entries with current streak
        const currentStreak = existingUser?.challengeStreak || null;
        historyEntries.forEach(entry => {
          entry.streakAtCompletion = currentStreak?.currentStreak || 0;
        });
        
        logger.info('Challenges completed but not all 3 - streak not updated', {
          username,
          completedCount: completedTodayChallengeIds.size,
          requiredCount: 3,
          completedChallengeIds: Array.from(completedTodayChallengeIds),
        });
      }

      // Build update operations
      const updateOperations: any = {};

      // Phase 2: Update challengeProgresses array
      // Strategy: Keep existing entries for today that aren't being updated, replace/update ones that are
      const otherDayProgresses = existingProgresses.filter((p: any) => p && p.date !== todayString);
      // Keep existing today's entries that aren't being updated in this batch
      const existingTodayProgresses = todayProgresses.filter((p: any) => 
        p && !updatedChallengeIds.has(p.challengeId)
      );
      // Combine: other days + existing today (not updated) + new/updated entries
      const allProgresses = [...otherDayProgresses, ...existingTodayProgresses, ...newProgressEntries];
      
      logger.info('Merging challenge progress entries', {
        username,
        otherDaysCount: otherDayProgresses.length,
        existingTodayCount: existingTodayProgresses.length,
        newEntriesCount: newProgressEntries.length,
        totalProgresses: allProgresses.length,
        updatedChallengeIds: Array.from(updatedChallengeIds),
      });

      updateOperations.$set = {
        challengeProgresses: allProgresses,
      };

      // Legacy: Also update challengeProgress for backward compatibility (use first entry)
      if (newProgressEntries.length > 0) {
        updateOperations.$set.challengeProgress = newProgressEntries[0];
      }

      // Include streak update if at least one challenge was completed
      if (updatedStreak) {
        updateOperations.$set.challengeStreak = updatedStreak;
      }

      // Add new rewards if any were earned
      if (newRewards.length > 0) {
        const existingRewards = existingUser?.challengeRewards || [];
        updateOperations.$set.challengeRewards = [...existingRewards, ...newRewards];
      }

      // Add history entries if any challenges were completed
      if (historyEntries.length > 0) {
        updateOperations.$push = {
          challengeHistory: { $each: historyEntries },
        };
        logger.info('Adding challenge history entries to update operations', {
          username,
          historyEntriesCount: historyEntries.length,
        });
      }

      // Update user's challenge progress and streak
      const user = await User.findOneAndUpdate(
        { username },
        updateOperations,
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.info('Challenge progress saved', {
        username,
        progressEntriesCount: newProgressEntries.length,
        completedCount: completedEntries.length,
        streakUpdated: !!updatedStreak,
        currentStreak: updatedStreak?.currentStreak || 0,
        rewardsEarned: newRewards.length,
      });

      // Return array format (Phase 2) and legacy single format for backward compatibility
      return res.status(200).json({
        progresses: newProgressEntries.map(p => ({
          challengeId: p.challengeId,
          date: p.date,
          completed: p.completed,
          completedAt: p.completedAt ? new Date(p.completedAt) : undefined,
          progress: p.progress,
          target: p.target,
        })),
        progress: newProgressEntries.length > 0 ? { // Legacy format
          challengeId: newProgressEntries[0].challengeId,
          date: newProgressEntries[0].date,
          completed: newProgressEntries[0].completed,
          completedAt: newProgressEntries[0].completedAt ? new Date(newProgressEntries[0].completedAt) : undefined,
          progress: newProgressEntries[0].progress,
          target: newProgressEntries[0].target,
        } : null,
        streak: user.challengeStreak || null,
        newRewards: newRewards.length > 0 ? newRewards : undefined,
      });
    } catch (error) {
      logger.error('Error saving challenge progress:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return res.status(500).json({
        error: 'Failed to save challenge progress',
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withDatabase(handler);
