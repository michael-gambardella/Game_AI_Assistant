import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { HealthStatusResponse } from '../../../types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthStatusResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      shouldShowBreak: false,
      timeSinceLastBreak: 0,
      breakCount: 0,
      showReminder: false,
      error: 'Method not allowed'
    });
  }

  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        shouldShowBreak: false,
        timeSinceLastBreak: 0,
        breakCount: 0,
        showReminder: false,
        error: 'Username is required'
      });
    }

    // Connect to database

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        shouldShowBreak: false,
        timeSinceLastBreak: 0,
        breakCount: 0,
        showReminder: false,
        error: 'User not found'
      });
    }

    // Initialize session start time if not set or if it's been more than 24 hours
    const now = new Date();

    // Initialize health monitoring if it doesn't exist
    if (!user.healthMonitoring) {
      user.healthMonitoring = {
        breakReminderEnabled: true,
        breakIntervalMinutes: 45,
        totalSessionTime: 0,
        breakCount: 0,
        healthTipsEnabled: true,
        lastSessionStart: now,
        isOnBreak: false
      };
    }
    const lastSessionStart = user.healthMonitoring.lastSessionStart;
    const shouldResetSession = !lastSessionStart ||
      (now.getTime() - lastSessionStart.getTime()) > 24 * 60 * 60 * 1000; // 24 hours

    if (shouldResetSession) {
      user.healthMonitoring.lastSessionStart = now;
      // Reset break tracking for new day
      user.healthMonitoring.lastBreakTime = undefined;
      user.healthMonitoring.breakCount = 0;
      user.healthMonitoring.lastBreakReminder = undefined;
      user.healthMonitoring.isOnBreak = false;
      user.healthMonitoring.breakStartTime = undefined;
      // Reset health tips for new day (24 hour reset)
      user.healthMonitoring.lastHealthTipTime = undefined;
      await user.save();
    } else if (!lastSessionStart) {
      // Initialize session start time if missing (shouldn't happen with the above fix, but just in case)
      user.healthMonitoring.lastSessionStart = now;
      await user.save();
    }

    // Check if user needs a break reminder
    const breakStatus = user.shouldShowBreakReminder();

    // Get health tips if user has tips enabled (independent of break reminders)
    // Uses session-based time tracking - timer pauses when page closes/signs out
    // Timer resets after 24 hours (when session resets)
    let healthTips: string[] = [];
    let shouldShowHealthTips = false;
    if (user.healthMonitoring?.healthTipsEnabled && lastSessionStart) {
      const lastHealthTipTime = user.healthMonitoring?.lastHealthTipTime;

      // Calculate time since last health tip based on ACTIVE session time only
      // This ensures the timer pauses when user closes page or signs out
      // IMPORTANT: If user logged out and back in, we need to detect this and reset the timer
      let timeSinceLastHealthTip = Infinity;

      const sessionAgeMinutes = Math.floor((now.getTime() - lastSessionStart.getTime()) / (1000 * 60));

      if (lastHealthTipTime) {
        const lastHealthTipDate = new Date(lastHealthTipTime);
        // If health tip was shown after session started, calculate from health tip time
        if (lastHealthTipDate >= lastSessionStart) {
          // Health tip was shown during current active session - calculate time since then
          timeSinceLastHealthTip = Math.floor((now.getTime() - lastHealthTipDate.getTime()) / (1000 * 60));
        } else {
          // Health tip was shown before current session started
          // This means the session was reset (user logged out and back in)
          // Only count time if session is relatively recent (user was actually active)
          // If session is very old (more than 10 minutes), assume user just logged back in
          if (sessionAgeMinutes > 10) {
            // User likely just logged back in - reset timer, don't show tip immediately
            timeSinceLastHealthTip = 0;
          } else {
            // Session is recent - count from session start (user was active)
            timeSinceLastHealthTip = Math.floor((now.getTime() - lastSessionStart.getTime()) / (1000 * 60));
          }
        }
      } else {
        // No health tip shown yet in this session
        // If session is very old (more than 10 minutes), assume user just logged back in
        // Otherwise, count from session start (user has been active)
        if (sessionAgeMinutes > 10) {
          // User likely just logged back in - reset timer, don't show tip immediately
          timeSinceLastHealthTip = 0;
        } else {
          // Session is recent - count from session start
          timeSinceLastHealthTip = sessionAgeMinutes;
        }
      }

      // Show health tips every 60 minutes (1 hour) of active session time
      // Timer pauses when disabled or when page closes, resumes when re-enabled or page reopens
      if (timeSinceLastHealthTip >= 60) {
        // Check if method exists (handles hot-reload caching issues in development)
        if (typeof user.getHealthTips === 'function') {
          healthTips = user.getHealthTips();
          shouldShowHealthTips = true;
        } else {
          console.error('getHealthTips method not available on User model');
          // Fallback: return empty array if method not available
          healthTips = [];
        }
      }
    }


    // Determine if we should show a break reminder
    const showReminder = breakStatus.shouldShow &&
      (!user.healthMonitoring?.lastBreakReminder ||
        (new Date().getTime() - user.healthMonitoring.lastBreakReminder.getTime()) > 5 * 60 * 1000);

    return res.status(200).json({
      shouldShowBreak: breakStatus.shouldShow,
      timeSinceLastBreak: breakStatus.timeSinceLastBreak,
      nextBreakIn: breakStatus.nextBreakIn,
      breakCount: user.healthMonitoring?.breakCount || 0,
      showReminder,
      healthTips: showReminder ? healthTips : undefined, // Still include in break reminder if shown together
      shouldShowHealthTips, // Independent health tips flag
      independentHealthTips: shouldShowHealthTips ? healthTips : undefined, // Independent health tips
      isOnBreak: user.healthMonitoring?.isOnBreak || false,
      breakStartTime: user.healthMonitoring?.breakStartTime,
      lastBreakTime: user.healthMonitoring?.lastBreakTime,
      breakIntervalMinutes: user.healthMonitoring?.breakIntervalMinutes || 45,
      lastSessionStart: user.healthMonitoring?.lastSessionStart || undefined,
    });

  } catch (error) {
    console.error('Error checking health status:', error);
    return res.status(500).json({
      shouldShowBreak: false,
      timeSinceLastBreak: 0,
      breakCount: 0,
      showReminder: false,
      error: 'Internal server error'
    });
  }
}

export default withDatabase(handler);
