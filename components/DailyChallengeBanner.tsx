"use client";

import React, { useState, useEffect } from "react";
import {
  DailyChallenge,
  ChallengeStreak,
  ChallengeReward,
  ChallengeProgress,
} from "../types";
import {
  getTodaysChallenges,
  getTodayDateString,
  saveChallengesProgress,
} from "../utils/challengeSelector";
import { DAILY_CHALLENGES } from "../utils/dailyChallenges";
import {
  hasCompletedChallenge,
  getChallengeProgress as getProgress,
} from "../utils/challengeDetector";
import { getChallengeStreakInfo } from "../utils/challengeStreak";
import { getNextMilestoneInfo } from "../utils/checkChallengeRewards";
import { formatRewardMessage } from "../utils/challengeRewards";
import { DailyChallengeBannerProps, ChallengeWithProgress } from "../types";
import { authFetch } from "../utils/authFetch";

const DailyChallengeBanner: React.FC<DailyChallengeBannerProps> = ({
  username,
  conversations,
}) => {
  // Phase 2: Multiple challenges
  const [challenges, setChallenges] = useState<ChallengeWithProgress[]>([]);
  const [isDismissed, setIsDismissed] = useState(false);
  const [streak, setStreak] = useState<ChallengeStreak | null>(null);
  const [rewards, setRewards] = useState<ChallengeReward[]>([]);
  const [newRewards, setNewRewards] = useState<ChallengeReward[]>([]);
  const [showRewardNotification, setShowRewardNotification] = useState(false);

  useEffect(() => {
    if (!username) {
      setChallenges([]);
      return;
    }

    // Async function to check progress and completion for all challenges
    const checkProgress = async () => {
      try {
        // CRITICAL: First fetch progress from backend to see which challenges are already saved
        // This ensures we show the same challenges that were saved, not regenerate new ones
        const response = await authFetch(
          `/api/challenge-progress`
        );

        let backendProgresses: ChallengeProgress[] = [];
        let todaysChallenges: DailyChallenge[] = [];

        if (response.ok) {
          const data = await response.json();

          // Phase 2: Get progresses array (new format) or fallback to single progress (legacy)
          if (data.progresses && Array.isArray(data.progresses)) {
            backendProgresses = data.progresses;
          } else if (
            data.progress &&
            data.progress.date === getTodayDateString()
          ) {
            // Legacy: single progress object
            backendProgresses = [data.progress];
          }

          if (data.streak) {
            setStreak(data.streak);
          }
          if (data.rewards) {
            setRewards(data.rewards);
          }
          if (data.newRewards && data.newRewards.length > 0) {
            setNewRewards(data.newRewards);
            setShowRewardNotification(true);
            setTimeout(() => setShowRewardNotification(false), 5000);
          }

          // CRITICAL FIX: If we have progress entries for today, validate they match today's challenges
          // This ensures challenges reset at midnight UTC (7 PM EST / 8 PM EDT)
          // If saved challenge IDs don't match today's challenges, regenerate them
          // Also check if challenges were completed in early morning (00:00-03:00 UTC) - likely from yesterday
          if (backendProgresses.length > 0) {
            // Get today's challenges to validate against saved progress
            const todaysGeneratedChallenges = getTodaysChallenges(username);
            const todaysChallengeIds = new Set(
              todaysGeneratedChallenges.map((c) => c.id)
            );

            // Extract challenge IDs from saved progress entries
            const savedChallengeIds = backendProgresses.map(
              (p) => p.challengeId
            );

            // Check if saved challenge IDs match today's challenges
            // If any saved ID is not in today's challenges, they're from yesterday and we should regenerate
            const allSavedIdsMatchToday = savedChallengeIds.every((id) =>
              todaysChallengeIds.has(id)
            );

            // EDGE CASE: Check if challenges were completed in the early morning hours (00:00-03:00 UTC)
            // This likely means they were completed after midnight UTC but are from yesterday's challenge set
            // Challenges reset at midnight UTC (7 PM EST / 8 PM EDT), so anything completed in the first 3 hours
            // of the UTC day is likely from yesterday's challenges
            const todayDateString = getTodayDateString();
            const todayStartUTC = new Date(
              todayDateString + "T00:00:00Z"
            ).getTime();
            const earlyMorningThreshold = todayStartUTC + 3 * 60 * 60 * 1000; // 3 hours after midnight UTC

            // Check if any challenge was completed in early morning (00:00-03:00 UTC)
            const anyCompletedInEarlyMorning = backendProgresses.some((p) => {
              if (!p.completedAt) return false;
              const completedTime = new Date(p.completedAt).getTime();
              return (
                completedTime >= todayStartUTC &&
                completedTime < earlyMorningThreshold
              );
            });

            // Use saved challenges only if:
            // 1. All saved IDs match today's generated IDs
            // 2. AND no challenges were completed in early morning (likely from yesterday)
            const shouldUseSavedChallenges =
              allSavedIdsMatchToday &&
              savedChallengeIds.length > 0 &&
              !anyCompletedInEarlyMorning;

            if (shouldUseSavedChallenges) {
              // Saved challenges match today's challenges and weren't completed in early morning - use them
              const savedChallenges = savedChallengeIds
                .map((id) => DAILY_CHALLENGES.find((c) => c.id === id))
                .filter((c): c is DailyChallenge => c !== undefined);

              // Ensure we have 3 challenges
              if (savedChallenges.length < 3) {
                const savedIdsSet = new Set(savedChallengeIds);

                // Add generated challenges that aren't already saved
                for (const genChallenge of todaysGeneratedChallenges) {
                  if (
                    !savedIdsSet.has(genChallenge.id) &&
                    savedChallenges.length < 3
                  ) {
                    savedChallenges.push(genChallenge);
                    savedIdsSet.add(genChallenge.id);
                  }
                }
              }
              todaysChallenges = savedChallenges.slice(0, 3);
            } else {
              // Saved challenges don't match today's challenges OR were completed in early morning
              // This happens when challenges were completed after midnight UTC
              // Regenerate today's challenges
              const reason = anyCompletedInEarlyMorning
                ? "Challenges completed in early morning (00:00-03:00 UTC) - likely from yesterday"
                : "Saved challenge IDs do not match today's challenges";

              console.log("[DailyChallengeBanner] Regenerating challenges", {
                savedIds: savedChallengeIds,
                todaysIds: Array.from(todaysChallengeIds),
                allMatch: allSavedIdsMatchToday,
                anyCompletedInEarlyMorning,
                reason,
              });
              todaysChallenges = todaysGeneratedChallenges;
            }
          } else {
            // No progress entries for today, generate new challenges
            todaysChallenges = getTodaysChallenges(username);
          }
        } else {
          // API call failed, generate new challenges as fallback
          todaysChallenges = getTodaysChallenges(username);
        }

        // Build challenge progress state for each challenge
        const challengesWithProgress: ChallengeWithProgress[] =
          todaysChallenges.map((challenge) => {
            // Find matching progress entry from backend
            const progressEntry = backendProgresses.find(
              (p) =>
                p.challengeId === challenge.id &&
                p.date === getTodayDateString()
            );

            // Check if completed based on conversations (if not already marked in backend)
            const isCompletedInBackend = progressEntry?.completed || false;
            const isCompletedInConversations = hasCompletedChallenge(
              conversations,
              challenge
            );

            // Challenge is completed if either backend says so OR conversations match
            const isCompleted =
              isCompletedInBackend || isCompletedInConversations;

            // Get progress for count-based challenges
            let progressData: { current: number; target: number } | null = null;
            if (challenge.criteria.type === "count") {
              const progress = getProgress(conversations, challenge);
              progressData = {
                current: progress.current,
                target: progress.target,
              };
            }

            return {
              challenge,
              completed: isCompleted,
              progress: progressData,
              progressEntry,
            };
          });

        setChallenges(challengesWithProgress);

        // Phase 2: Save progress for all challenges that are completed but not yet saved
        const progressesToSave: ChallengeProgress[] = [];
        for (const challengeWithProgress of challengesWithProgress) {
          // If completed in conversations but not in backend, save it
          if (
            challengeWithProgress.completed &&
            !challengeWithProgress.progressEntry?.completed
          ) {
            const progressToSave: ChallengeProgress = {
              challengeId: challengeWithProgress.challenge.id,
              date: getTodayDateString(),
              completed: true,
              completedAt: new Date(),
              progress: challengeWithProgress.progress?.current,
              target: challengeWithProgress.progress?.target,
            };
            progressesToSave.push(progressToSave);
          }
        }

        // Save all new completions at once
        if (progressesToSave.length > 0) {
          await saveChallengesProgress(username, progressesToSave);

          // Fetch updated data after saving (streak, rewards)
          const updatedResponse = await authFetch(
            `/api/challenge-progress`
          );
          if (updatedResponse.ok) {
            const updatedData = await updatedResponse.json();
            if (updatedData.streak) {
              setStreak(updatedData.streak);
            }
            if (updatedData.rewards) {
              setRewards(updatedData.rewards);
            }
            if (updatedData.newRewards && updatedData.newRewards.length > 0) {
              setNewRewards(updatedData.newRewards);
              setShowRewardNotification(true);
              setTimeout(() => setShowRewardNotification(false), 5000);
            }

            // Update challenges with new progress entries
            const updatedProgresses = updatedData.progresses || [];
            setChallenges(
              challengesWithProgress.map((cwp) => {
                const updatedEntry = updatedProgresses.find(
                  (p: ChallengeProgress) => p.challengeId === cwp.challenge.id
                );
                return {
                  ...cwp,
                  completed: updatedEntry?.completed || cwp.completed,
                  progressEntry: updatedEntry || cwp.progressEntry,
                };
              })
            );
          }
        }
      } catch (error) {
        console.error("Error checking challenge progress:", error);
        // Fallback: generate challenges and just check completion based on conversations
        const fallbackChallenges = getTodaysChallenges(username);
        const challengesWithProgress: ChallengeWithProgress[] =
          fallbackChallenges.map((challenge) => {
            const isCompleted = hasCompletedChallenge(conversations, challenge);
            let progressData: { current: number; target: number } | null = null;
            if (challenge.criteria.type === "count") {
              const progress = getProgress(conversations, challenge);
              progressData = {
                current: progress.current,
                target: progress.target,
              };
            }
            return {
              challenge,
              completed: isCompleted,
              progress: progressData,
            };
          });
        setChallenges(challengesWithProgress);
      }
    };

    checkProgress();

    // Check if dismissed (still using localStorage for dismissal)
    const dismissedKey = `challenge_dismissed_${username}_${getTodayDateString()}`;
    const dismissed = localStorage.getItem(dismissedKey) === "true";
    setIsDismissed(dismissed);
  }, [username, conversations]);

  const handleDismiss = () => {
    if (!username) return;
    const dismissedKey = `challenge_dismissed_${username}_${getTodayDateString()}`;
    localStorage.setItem(dismissedKey, "true");
    setIsDismissed(true);
  };

  // Don't render if no username, no challenges, or dismissed
  if (!username || challenges.length === 0 || isDismissed) {
    return null;
  }

  // Get next milestone info for display (shown once for all challenges)
  const milestoneInfo =
    streak && streak.currentStreak > 0
      ? getNextMilestoneInfo(streak, rewards)
      : null;

  // Count completed challenges
  const completedCount = challenges.filter((c) => c.completed).length;
  const totalChallenges = challenges.length;

  return (
    <>
      {/* Reward Notification */}
      {showRewardNotification && newRewards.length > 0 && (
        <div className="mt-4 px-4 py-3 rounded-lg border-2 bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border-yellow-500 max-w-xl w-full animate-pulse">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎉</span>
            <div>
              <h3 className="font-bold text-yellow-400 text-sm">
                Reward Earned!
              </h3>
              {newRewards.map((reward, idx) => (
                <p key={idx} className="text-xs text-yellow-200 mt-0.5">
                  {formatRewardMessage(reward)}
                </p>
              ))}
            </div>
            <button
              onClick={() => setShowRewardNotification(false)}
              className="ml-auto text-yellow-400 hover:text-yellow-200"
              aria-label="Dismiss notification"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Phase 2: Multiple Challenges Banner */}
      <div className="mt-4 px-4 py-3 rounded-lg border-2 bg-blue-50 border-blue-500 text-blue-900 dark:bg-blue-900/30 dark:text-white transition-all max-w-xl w-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎯</span>
            <h3 className="font-bold text-sm">
              Daily Challenges ({completedCount}/{totalChallenges} completed)
            </h3>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-white ml-2 flex-shrink-0 transition-colors"
            aria-label="Dismiss challenges"
            type="button"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Streak and milestone info (shown once) */}
        {streak && streak.currentStreak > 0 && (
          <div className="mb-3 text-xs font-semibold text-yellow-600 dark:text-yellow-400">
            {getChallengeStreakInfo(streak).message}
          </div>
        )}
        {milestoneInfo &&
          milestoneInfo.progress &&
          milestoneInfo.nextMilestone && (
            <div className="mb-3 text-xs text-gray-600 dark:text-gray-400">
              Next reward: {milestoneInfo.nextMilestone.reward.icon}{" "}
              {milestoneInfo.nextMilestone.reward.name} (
              {milestoneInfo.progress.current}/{milestoneInfo.progress.target}{" "}
              days)
            </div>
          )}

        {/* List of challenges */}
        <div className="space-y-2">
          {challenges.map((challengeWithProgress) => {
            const { challenge, completed, progress } = challengeWithProgress;
            return (
              <div
                key={challenge.id}
                className={`px-3 py-2 rounded border transition-all ${
                  completed
                    ? "bg-green-100 border-green-400 dark:bg-green-900/20 dark:border-green-500"
                    : "bg-gray-100 border-gray-300 dark:bg-gray-800/30 dark:border-gray-600"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0 mt-0.5">
                    {challenge.icon || "🎯"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-xs">
                        {completed ? "✅ " : ""}
                        {challenge.title}
                      </h4>
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">
                      {challenge.description}
                    </p>
                    {progress && (
                      <div className="mt-1.5">
                        <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                          <span className="whitespace-nowrap text-xs">
                            Progress: {progress.current}/{progress.target}
                          </span>
                          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 min-w-0">
                            <div
                              className={`h-1.5 rounded-full transition-all ${
                                completed ? "bg-green-500" : "bg-blue-500"
                              }`}
                              style={{
                                width: `${Math.min(
                                  (progress.current / progress.target) * 100,
                                  100
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default DailyChallengeBanner;
