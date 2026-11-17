import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { HealthMonitoringProps, HealthStatus } from "../types";
import { authFetch } from "../utils/authFetch";

// ADD THESE LINES HERE (after imports):
// Storage key helper

const useHealthMonitoring = ({
  username,
  isEnabled,
  checkInterval = 60000, // 1 minute
}: HealthMonitoringProps) => {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    shouldShowBreak: false,
    timeSinceLastBreak: 0,
    breakCount: 0,
    isMonitoring: false,
  });
  const [healthTips, setHealthTips] = useState<string[]>([]);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null); // For real-time countdown
  const lastReminderTimeRef = useRef<Date | null>(null);
  const sessionStartTimeRef = useRef<Date | null>(null);
  const lastActiveTimeRef = useRef<Date | null>(null);
  const isPageVisibleRef = useRef<boolean>(true);
  const accumulatedSessionTimeRef = useRef<number>(0); // Track accumulated session time
  const lastBreakTimeRef = useRef<Date | null>(null); // Track when last break was taken
  const sessionPausedTimeRef = useRef<Date | null>(null); // Track when session was paused
  const breakIntervalMinutesRef = useRef<number>(45); // Store break interval for local calculations
  // Persisted remaining time across full page close/open
  const remainingSecondsOverrideRef = useRef<number | null>(null);
  const lastTickAtRef = useRef<number | null>(null);
  // Track current enabled state in a ref so cleanup can check current value
  const isEnabledRef = useRef<boolean>(isEnabled);
  // Track if we're currently initializing to prevent double calls
  const isInitializingRef = useRef<boolean>(false);
  // Track if startSession has been called to prevent double calls
  const startSessionCalledRef = useRef<boolean>(false);
  // Track if restore has completed to prevent other code from running before restore
  const restoreCompletedRef = useRef<boolean>(false);
  // Track if component is initialized to prevent saving default state before restore
  const isInitializedRef = useRef<boolean>(false);

  // Function to start a new session (only called for truly new sessions)
  const startSession = async () => {
    if (!username) return;

    // Prevent double calls - if already called or initializing, skip
    if (startSessionCalledRef.current || isInitializingRef.current) {
      return;
    }

    // Mark as called to prevent double execution
    startSessionCalledRef.current = true;

    const now = new Date();

    try {
      // Check if there's an existing session to resume
      const response = await authFetch("/api/health/checkStatus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();

        // If user is on a break, don't start a new session
        if (data.isOnBreak) {
          sessionStartTimeRef.current = null;
          lastActiveTimeRef.current = null;
          accumulatedSessionTimeRef.current = 0;
          return; // Don't call API - user is on break
        }

        // Check if we should resume from last break time
        if (data.lastBreakTime) {
          const lastBreakTime = new Date(data.lastBreakTime);
          const timeSinceLastBreak = now.getTime() - lastBreakTime.getTime();

          // If it's been less than 24 hours since last break, resume session
          if (timeSinceLastBreak < 24 * 60 * 60 * 1000) {
            lastBreakTimeRef.current = lastBreakTime;
            sessionStartTimeRef.current = lastBreakTime;
            lastActiveTimeRef.current = now;
            accumulatedSessionTimeRef.current = timeSinceLastBreak;

            console.log(
              "Resuming session from last break time:",
              lastBreakTime.toISOString(),
              "- skipping startSession API call"
            );
            console.log(
              "Time since last break:",
              Math.floor(timeSinceLastBreak / (1000 * 60)),
              "minutes"
            );
            return; // Don't call API - we're resuming, not starting fresh
          }
        }

        // If there's an existing session start time on the server (within 24 hours), we're resuming
        if (data.lastSessionStart) {
          const lastSessionStart = new Date(data.lastSessionStart);
          const timeSinceSessionStart =
            now.getTime() - lastSessionStart.getTime();

          // If session is still active (less than 24 hours old), we're resuming
          if (timeSinceSessionStart < 24 * 60 * 60 * 1000) {
            console.log(
              "Resuming existing session from:",
              lastSessionStart.toISOString(),
              "- skipping startSession API call"
            );
            // Initialize local refs based on server data
            if (!sessionStartTimeRef.current) {
              sessionStartTimeRef.current = lastSessionStart;
            }
            if (!lastActiveTimeRef.current) {
              lastActiveTimeRef.current = now;
            }
            if (data.lastBreakTime && !lastBreakTimeRef.current) {
              lastBreakTimeRef.current = new Date(data.lastBreakTime);
            }
            return; // Don't call API - we're resuming, not starting fresh
          }
        }
      }
    } catch (error) {
      console.error("Error checking existing session:", error);
      // On error, proceed to start new session
    }

    // Only start a truly fresh session (no existing session data found)
    console.log("Starting fresh session - calling startSession API");
    sessionStartTimeRef.current = now;
    lastActiveTimeRef.current = now;
    accumulatedSessionTimeRef.current = 0;
    lastBreakTimeRef.current = null;
    sessionPausedTimeRef.current = null;

    try {
      // Only notify server for a truly new session
      await authFetch("/api/health/startSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionStartTime: now.toISOString() }),
      });
    } catch (error) {
      console.error("Error starting session:", error);
    }
  };

  // Function to pause session (when page becomes hidden)
  const pauseSession = () => {
    if (!sessionStartTimeRef.current || !lastActiveTimeRef.current) return;

    const now = new Date();
    const sessionDuration = now.getTime() - lastActiveTimeRef.current.getTime();
    accumulatedSessionTimeRef.current += sessionDuration;
    sessionPausedTimeRef.current = now;
    lastActiveTimeRef.current = null;
  };

  // Function to resume session (when page becomes visible)
  const resumeSession = () => {
    if (!sessionStartTimeRef.current) return;

    // Only resume if we were actually paused (not just tab switching)
    if (sessionPausedTimeRef.current) {
      const pauseDuration =
        new Date().getTime() - sessionPausedTimeRef.current.getTime();

      // If paused for more than 5 minutes, consider it a real pause
      if (pauseDuration > 5 * 60 * 1000) {
        console.log(
          "Session was paused for",
          Math.floor(pauseDuration / (1000 * 60)),
          "minutes"
        );
      }
    }

    lastActiveTimeRef.current = new Date();
    sessionPausedTimeRef.current = null;
  };

  // Function to get current session time (only counting visible time)
  const getCurrentSessionTime = (): number => {
    if (!sessionStartTimeRef.current) return 0;

    const baseTime = accumulatedSessionTimeRef.current;
    if (lastActiveTimeRef.current && isPageVisibleRef.current) {
      const now = new Date();
      return baseTime + (now.getTime() - lastActiveTimeRef.current.getTime());
    }
    return baseTime;
  };

  // Function to end the current session
  const endSession = async () => {
    if (!username || !sessionStartTimeRef.current) return;

    // Calculate final session duration using accumulated time
    const finalSessionTime = getCurrentSessionTime();
    const sessionDurationMinutes = Math.floor(finalSessionTime / (1000 * 60));

    try {
      // Notify server that session ended
      await authFetch("/api/health/endSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionEndTime: new Date().toISOString(),
          sessionDuration: sessionDurationMinutes,
        }),
      });
    } catch (error) {
      console.error("Error ending session:", error);
    } finally {
      // Reset session tracking
      sessionStartTimeRef.current = null;
      lastActiveTimeRef.current = null;
      accumulatedSessionTimeRef.current = 0;
    }
  };

  // Function to update last active time
  // const updateLastActiveTime = () => {
  //   lastActiveTimeRef.current = new Date();
  // };

  // Function to update timer locally (real-time countdown)
  const updateTimerLocally = () => {
    // Use ref to get current isEnabled value to avoid closure issues
    if (!username || !isEnabledRef.current) {
      // Ensure isMonitoring is false when disabled
      setHealthStatus((prev) => {
        if (prev.isMonitoring) {
          return { ...prev, isMonitoring: false };
        }
        return prev;
      });
      return;
    }

    // If we have an override (from a prior close), count down only while page is open
    if (remainingSecondsOverrideRef.current !== null) {
      const nowMs = Date.now();
      if (isPageVisibleRef.current) {
        if (lastTickAtRef.current === null) lastTickAtRef.current = nowMs;
        const deltaSec = Math.max(
          0,
          Math.floor((nowMs - lastTickAtRef.current) / 1000)
        );
        if (deltaSec > 0) {
          remainingSecondsOverrideRef.current = Math.max(
            0,
            remainingSecondsOverrideRef.current - deltaSec
          );
          lastTickAtRef.current = nowMs;
        }
      } else {
        // Not visible, don't change remaining seconds
        lastTickAtRef.current = nowMs;
      }

      const nextBreakIn = Math.floor(remainingSecondsOverrideRef.current / 60);
      const shouldShowBreak = remainingSecondsOverrideRef.current <= 0;

      setHealthStatus((prev) => ({
        ...prev,
        shouldShowBreak,
        timeSinceLastBreak: shouldShowBreak
          ? breakIntervalMinutesRef.current
          : breakIntervalMinutesRef.current - nextBreakIn,
        nextBreakIn,
      }));

      return;
    }

    // No override: Calculate time since last break locally
    let timeSinceLastBreak = 0;
    if (lastBreakTimeRef.current) {
      const timeSinceBreak =
        new Date().getTime() - lastBreakTimeRef.current.getTime();
      timeSinceLastBreak = Math.floor(timeSinceBreak / (1000 * 60));
    } else if (sessionStartTimeRef.current) {
      const currentSessionTime = getCurrentSessionTime();
      timeSinceLastBreak = Math.floor(currentSessionTime / (1000 * 60));
    }

    const shouldShowBreak =
      timeSinceLastBreak >= breakIntervalMinutesRef.current;
    const nextBreakIn = shouldShowBreak
      ? 0
      : Math.max(0, breakIntervalMinutesRef.current - timeSinceLastBreak);

    // Store the calculated remaining time in override ref so it can be saved on unmount
    // Convert nextBreakIn (minutes) to seconds for consistency
    remainingSecondsOverrideRef.current = nextBreakIn * 60;

    // Debug logging
    // console.log("Timer update:", {
    //   timeSinceLastBreak,
    //   breakInterval: breakIntervalMinutesRef.current,
    //   nextBreakIn,
    //   shouldShowBreak,
    //   lastBreakTime: lastBreakTimeRef.current?.toISOString(),
    //   sessionStart: sessionStartTimeRef.current?.toISOString(),
    //   remainingSeconds: remainingSecondsOverrideRef.current,
    // });

    setHealthStatus((prev) => ({
      ...prev,
      shouldShowBreak: shouldShowBreak,
      timeSinceLastBreak: timeSinceLastBreak,
      nextBreakIn: nextBreakIn,
      isMonitoring: isEnabled, // Ensure isMonitoring matches isEnabled state
    }));
  };

  // Function to check health status
  // Note: This now also checks for health tips even when break reminders are disabled
  const checkHealthStatus = async () => {
    if (!username) return;

    try {
      const response = await authFetch("/api/health/checkStatus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        console.warn("Failed to check health status:", response.statusText);
        return;
      }

      const data = await response.json();

      // Only process break reminder logic if break reminders are enabled
      if (isEnabled) {
        // Store break interval for local calculations
        breakIntervalMinutesRef.current = data.breakIntervalMinutes || 45;

        // Only take the server's last break time if we don't already have one
        if (data.lastBreakTime && !lastBreakTimeRef.current) {
          lastBreakTimeRef.current = new Date(data.lastBreakTime);
        }

        // If we have a restored override, keep using it
        if (remainingSecondsOverrideRef.current !== null) {
          const nextBreakIn = Math.floor(
            remainingSecondsOverrideRef.current / 60
          );
          const shouldShowBreak = remainingSecondsOverrideRef.current <= 0;

          setHealthStatus((prev) => ({
            ...prev,
            shouldShowBreak,
            nextBreakIn,
            timeSinceLastBreak: shouldShowBreak
              ? breakIntervalMinutesRef.current
              : breakIntervalMinutesRef.current - nextBreakIn,
            breakCount: data.breakCount,
            isMonitoring: isEnabled,
            isOnBreak: data.isOnBreak,
            breakStartTime: data.breakStartTime,
          }));

          if (shouldShowBreak && data.showReminder) {
            showBreakReminder(data.healthTips);
          }

          return; // Important: exit early
        }

        // Calculate session-based time instead of using server time
        const currentSessionTime = getCurrentSessionTime();
        const sessionTimeMinutes = Math.floor(currentSessionTime / (1000 * 60));

        // Calculate time since last break (either from session or server data)
        let timeSinceLastBreak = 0;
        if (data.isOnBreak) {
          timeSinceLastBreak = 0;
        } else if (lastBreakTimeRef.current) {
          // Use local break time if available
          const timeSinceBreak =
            new Date().getTime() - lastBreakTimeRef.current.getTime();
          timeSinceLastBreak = Math.floor(timeSinceBreak / (1000 * 60));
        } else if (data.lastBreakTime) {
          // Fall back to server data
          const timeSinceBreak =
            new Date().getTime() - new Date(data.lastBreakTime).getTime();
          timeSinceLastBreak = Math.floor(timeSinceBreak / (1000 * 60));
        } else {
          // Use session time if no break time available
          timeSinceLastBreak = sessionTimeMinutes;
        }

        const shouldShowBreak =
          !data.isOnBreak &&
          timeSinceLastBreak >= breakIntervalMinutesRef.current;

        // If we have an override remaining time, don't overwrite countdown here
        // But we should still update nextBreakIn from the override to keep it in sync
        if (remainingSecondsOverrideRef.current !== null) {
          // Calculate nextBreakIn from the override to ensure it's current
          const nextBreakIn = Math.floor(
            remainingSecondsOverrideRef.current / 60
          );
          const shouldShowBreak = remainingSecondsOverrideRef.current <= 0;

          // Keep breakCount / flags in sync, and update nextBreakIn from override
          setHealthStatus((prev) => ({
            ...prev,
            shouldShowBreak,
            nextBreakIn,
            timeSinceLastBreak: shouldShowBreak
              ? breakIntervalMinutesRef.current
              : breakIntervalMinutesRef.current - nextBreakIn,
            breakCount: data.breakCount,
            isMonitoring: isEnabled, // Use current isEnabled state
            isOnBreak: data.isOnBreak,
            breakStartTime: data.breakStartTime,
          }));
        } else {
          setHealthStatus({
            shouldShowBreak: shouldShowBreak,
            timeSinceLastBreak: timeSinceLastBreak,
            nextBreakIn: shouldShowBreak
              ? 0
              : Math.max(
                  0,
                  breakIntervalMinutesRef.current - timeSinceLastBreak
                ),
            breakCount: data.breakCount,
            isMonitoring: isEnabled, // Use current isEnabled state
            isOnBreak: data.isOnBreak,
            breakStartTime: data.breakStartTime,
          });
        }

        // Show break reminder if needed (only if break reminders are enabled)
        if (shouldShowBreak && data.showReminder) {
          showBreakReminder(data.healthTips);
        }
      }

      // Show independent health tips if enabled (works even when break reminders are disabled)
      if (
        data.shouldShowHealthTips &&
        data.independentHealthTips &&
        data.independentHealthTips.length > 0
      ) {
        showHealthTips(data.independentHealthTips);
      }

      // If break reminders are disabled, ensure isMonitoring is false
      if (!isEnabled) {
        setHealthStatus((prev) => {
          if (prev.isMonitoring) {
            return { ...prev, isMonitoring: false };
          }
          return prev;
        });
      }
    } catch (error) {
      console.error("Error checking health status:", error);
    }
  };

  // Function to show break reminder
  const showBreakReminder = (healthTips: string[] = []) => {
    const now = new Date();

    // Prevent spam - only show if it's been at least 5 minutes since last reminder
    if (lastReminderTimeRef.current) {
      const timeSinceLastReminder =
        now.getTime() - lastReminderTimeRef.current.getTime();
      if (timeSinceLastReminder < 5 * 60 * 1000) {
        // 5 minutes
        return;
      }
    }

    lastReminderTimeRef.current = now;

    // Show break reminder toast
    toast.custom(
      (t) => (
        <div
          className={`${
            t.visible ? "animate-enter" : "animate-leave"
          } w-auto max-w-md bg-gradient-to-r from-green-600 to-blue-600 shadow-xl rounded-lg pointer-events-auto flex flex-col p-4 border border-green-400`}
          style={{
            position: "fixed",
            top: "60px",
            right: "20px",
            zIndex: 9999,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <span className="text-2xl mr-2">⏰</span>
              <div>
                <p className="text-sm font-bold text-white">
                  Time for a Break!
                </p>
                <p className="text-xs text-white opacity-90">
                  You&apos;ve been gaming for a while. Take a quick break!
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                recordBreak();
              }}
              className="ml-2 text-white hover:text-gray-200 text-lg font-bold"
            >
              ×
            </button>
          </div>

          {healthTips.length > 0 && (
            <div className="mt-2 text-xs text-white opacity-90">
              <p className="font-semibold mb-1">💡 Health Tips:</p>
              {healthTips.map((tip, index) => (
                <p key={index} className="mb-1">
                  {tip}
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                toast.dismiss(t.id);
                recordBreak();
              }}
              className="flex-1 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold py-2 px-3 rounded transition-colors"
            >
              I Took a Break
            </button>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                snoozeReminder();
              }}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold py-2 px-3 rounded transition-colors"
            >
              Remind Later
            </button>
          </div>
        </div>
      ),
      {
        duration: 10000, // 10 seconds
        position: "top-center",
      }
    );
  };

  // Function to start a break
  const recordBreak = async () => {
    try {
      const response = await authFetch("/api/health/recordBreak", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        // Update break time but don't reset session timer
        lastBreakTimeRef.current = new Date();
        // Clear any persisted remaining time since a new break started
        remainingSecondsOverrideRef.current = null;

        // Clear from server
        try {
          if (username) {
            await authFetch("/api/health/saveTimerState", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                remainingSeconds: 0,
                breakIntervalMinutes: breakIntervalMinutesRef.current,
              }),
            });
          }
        } catch (e) {
          console.error("Error clearing timer state on server:", e);
        }

        // Clear from localStorage
        try {
          if (username)
            localStorage.removeItem(`vgw_health_remaining_${username}`);
        } catch (e) {}

        // Update local state to show break started
        setHealthStatus((prev) => ({
          ...prev,
          shouldShowBreak: false,
          isOnBreak: true,
          breakStartTime: new Date(),
        }));

        // Show confirmation
        toast.success(
          "Break started! Take your time and come back when you're ready! 🎮",
          {
            duration: 3000,
            position: "top-center",
          }
        );
      }
    } catch (error) {
      console.error("Error starting break:", error);
    }
  };

  // Function to end a break
  const endBreak = async () => {
    try {
      const response = await authFetch("/api/health/endBreak", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();

        // Update break time but don't reset session timer
        lastBreakTimeRef.current = new Date();
        // Clear persisted remaining time; countdown restarts after break
        remainingSecondsOverrideRef.current = null;

        // Clear from server
        try {
          if (username) {
            await authFetch("/api/health/saveTimerState", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                remainingSeconds: 0,
                breakIntervalMinutes: breakIntervalMinutesRef.current,
              }),
            });
          }
        } catch (e) {
          console.error("Error clearing timer state on server:", e);
        }

        // Clear from localStorage
        try {
          if (username)
            localStorage.removeItem(`vgw_health_remaining_${username}`);
        } catch (e) {}

        // Update local state
        setHealthStatus((prev) => ({
          ...prev,
          isOnBreak: false,
          breakStartTime: undefined,
          breakCount: data.breakCount,
          timeSinceLastBreak: 0,
        }));

        // Show confirmation
        toast.success("Welcome back! Break completed successfully! 🎮", {
          duration: 3000,
          position: "top-center",
        });
      }
    } catch (error) {
      console.error("Error ending break:", error);
    }
  };

  // Function to snooze reminder
  const snoozeReminder = async () => {
    try {
      const response = await authFetch("/api/health/snoozeReminder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        toast.success("Reminder snoozed for 15 minutes", {
          duration: 2000,
          position: "top-center",
        });
      }
    } catch (error) {
      console.error("Error snoozing reminder:", error);
    }
  };

  // Function to show health tips independently
  const showHealthTips = async (tips: string[]) => {
    if (!username || tips.length === 0) return;

    // Mark health tips as shown
    try {
      await authFetch("/api/health/markHealthTipShown", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
    } catch (error) {
      console.error("Error marking health tip as shown:", error);
    }

    // Set health tips state to display in widget
    setHealthTips(tips);

    // Auto-dismiss after 12 seconds
    setTimeout(() => {
      setHealthTips([]);
    }, 12000);
  };

  // Function to dismiss health tips
  const dismissHealthTips = () => {
    setHealthTips([]);
  };

  // Update ref when isEnabled changes
  useEffect(() => {
    isEnabledRef.current = isEnabled;

    // If break reminders are disabled, clear state and localStorage
    if (!isEnabled && username) {
      // Clear localStorage
      try {
        const key = `vgw_health_remaining_${username}`;
        localStorage.removeItem(key);
      } catch (e) {
        // Ignore localStorage errors
      }

      // Clear override refs
      remainingSecondsOverrideRef.current = null;
      lastTickAtRef.current = null;

      // Clear timer interval if running
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      // Set isMonitoring to false
      setHealthStatus((prev) => ({
        ...prev,
        isMonitoring: false,
        shouldShowBreak: false,
      }));
    }
  }, [isEnabled, username]);

  // Start monitoring when username is available
  // Note: We still check for health tips even when break reminders are disabled
  useEffect(() => {
    if (!username) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      // Clear timer state when disabled
      remainingSecondsOverrideRef.current = null;
      lastTickAtRef.current = null;
      // Clear localStorage when disabled
      if (username) {
        try {
          const key = `vgw_health_remaining_${username}`;
          localStorage.removeItem(key);
        } catch (e) {
          // Ignore localStorage errors
        }
      }
      // Immediately set isMonitoring to false and clear timer display
      setHealthStatus({
        shouldShowBreak: false,
        timeSinceLastBreak: 0,
        nextBreakIn: undefined,
        breakCount: 0,
        isMonitoring: false,
        isOnBreak: false,
        breakStartTime: undefined,
      });
      return;
    }

    // Restore remaining time override from server (cross-browser persistence)
    // Fallback to localStorage if server doesn't have it
    // ONLY restore if break reminders are enabled
    if (isEnabled) {
      // First, try to restore from server (for cross-browser sync)
      const restoreFromServer = async () => {
        try {
          const response = await authFetch("/api/health/getTimerState", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.timerState) {
              const timerData = data.timerState;
              const now = Date.now();
              const timeSinceSave = now - timerData.savedAt;
              const twentyFourHours = 24 * 60 * 60 * 1000;

              // Check if 24 hours have passed since save
              if (timeSinceSave < twentyFourHours) {
                // Check if break interval changed
                const currentBreakInterval = breakIntervalMinutesRef.current;
                let remainingSec = timerData.remainingSeconds;

                if (
                  timerData.breakIntervalMinutes &&
                  timerData.breakIntervalMinutes !== currentBreakInterval
                ) {
                  // Adjust proportionally
                  const ratio =
                    currentBreakInterval / timerData.breakIntervalMinutes;
                  remainingSec = Math.max(0, Math.round(remainingSec * ratio));
                }

                if (remainingSec > 0) {
                  remainingSecondsOverrideRef.current = remainingSec;
                  lastTickAtRef.current = now;
                  console.log(
                    "Restored timer from server:",
                    remainingSec,
                    "seconds (",
                    Math.floor(remainingSec / 60),
                    "minutes)"
                  );

                  // Update state immediately
                  const nextBreakIn = Math.floor(remainingSec / 60);
                  const shouldShowBreak = remainingSec <= 0;
                  setHealthStatus({
                    shouldShowBreak,
                    nextBreakIn: Math.max(0, nextBreakIn),
                    timeSinceLastBreak: shouldShowBreak
                      ? breakIntervalMinutesRef.current
                      : Math.max(
                          0,
                          breakIntervalMinutesRef.current - nextBreakIn
                        ),
                    breakCount: healthStatus.breakCount,
                    isMonitoring: isEnabled,
                  });

                  // Mark as initialized
                  isInitializedRef.current = true;
                  restoreCompletedRef.current = true;
                  return true; // Successfully restored from server
                }
              }
            }
          }
        } catch (error) {
          console.error("Error restoring timer from server:", error);
        }
        return false; // Server restore failed
      };

      // Try server first, then fallback to localStorage
      restoreFromServer().then((serverRestored) => {
        if (!serverRestored) {
          // Fallback to localStorage
          try {
            const key = `vgw_health_remaining_${username}`;
            const stored = localStorage.getItem(key);
            if (stored) {
              let timerData: {
                remainingSeconds: number;
                savedAt: number;
                breakIntervalMinutes?: number;
              } | null = null;

              try {
                timerData = JSON.parse(stored);
              } catch (e) {
                // Old format - backward compatibility
                const remainingSec = Math.max(0, parseInt(stored, 10));
                if (!Number.isNaN(remainingSec) && remainingSec > 0) {
                  timerData = {
                    remainingSeconds: remainingSec,
                    savedAt: Date.now(),
                    breakIntervalMinutes: breakIntervalMinutesRef.current,
                  };
                }
              }

              if (timerData && timerData.remainingSeconds > 0) {
                const now = Date.now();
                const timeSinceSave = now - timerData.savedAt;
                const twentyFourHours = 24 * 60 * 60 * 1000;

                if (timeSinceSave < twentyFourHours) {
                  remainingSecondsOverrideRef.current =
                    timerData.remainingSeconds;
                  lastTickAtRef.current = now;
                  console.log(
                    "Restored timer from localStorage:",
                    timerData.remainingSeconds,
                    "seconds"
                  );

                  // Update state
                  const nextBreakIn = Math.floor(
                    timerData.remainingSeconds / 60
                  );
                  const shouldShowBreak = timerData.remainingSeconds <= 0;
                  setHealthStatus({
                    shouldShowBreak,
                    nextBreakIn: Math.max(0, nextBreakIn),
                    timeSinceLastBreak: shouldShowBreak
                      ? breakIntervalMinutesRef.current
                      : Math.max(
                          0,
                          breakIntervalMinutesRef.current - nextBreakIn
                        ),
                    breakCount: healthStatus.breakCount,
                    isMonitoring: isEnabled,
                  });
                }
              }
            }
          } catch (e) {
            console.error("Error restoring from localStorage:", e);
          }
        }
        // Mark as initialized after restore attempt (server or localStorage)
        isInitializedRef.current = true;
        restoreCompletedRef.current = true;

        // Call checkHealthStatus after restore completes to sync with server
        // Delay slightly to ensure state updates have been applied
        setTimeout(() => {
          checkHealthStatus();
        }, 200);
      });
    } else {
      // Clear any stored remaining time if break reminders are disabled
      try {
        const key = `vgw_health_remaining_${username}`;
        localStorage.removeItem(key);
      } catch (e) {}
      // Clear the override ref
      remainingSecondsOverrideRef.current = null;
      lastTickAtRef.current = null;
    }

    // Start a new session (only informs server; our override governs countdown if present)
    // Only call startSession if we haven't called it yet (to prevent double calls)
    if (!startSessionCalledRef.current && !isInitializingRef.current) {
      isInitializingRef.current = true;
      startSession().finally(() => {
        // Reset flags after a short delay to allow for async operations
        setTimeout(() => {
          isInitializingRef.current = false;
          // Don't reset startSessionCalledRef here - it should stay true for this mount
        }, 500);
      });
    }

    // Start monitoring - only set isMonitoring to true if break reminders are enabled
    // Health tips can still work via checkHealthStatus, but the widget won't show
    setHealthStatus((prev) => ({ ...prev, isMonitoring: isEnabled }));

    // Start API polling interval (every minute) - always runs to check for health tips
    intervalRef.current = setInterval(() => {
      checkHealthStatus();
    }, checkInterval);

    // Start local timer for real-time countdown (every second) - only if break reminders enabled
    if (isEnabled) {
      // Clear any existing interval first to avoid duplicates
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      timerIntervalRef.current = setInterval(() => {
        updateTimerLocally();
      }, 1000);
      // Update immediately on start
      updateTimerLocally();
    } else {
      // Clear timer interval if disabled
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    // Note: updateTimerLocally() is already called immediately after starting the interval above
    // so we don't need to call it again here

    // Check immediately on first load (but only after restore has completed)
    // The restore logic will call checkHealthStatus after it completes
    // If restore hasn't completed yet (isEnabled is false or restore is async),
    // we still need to call it for health tips, but delay it to avoid showing default 45
    if (!isEnabled) {
      // Break reminders disabled, safe to call immediately (only for health tips)
      checkHealthStatus();
    } else {
      // Break reminders enabled - wait for restore to complete
      // The restore promise will call checkHealthStatus after it completes
      // But as a fallback, call it after a delay if restore hasn't completed
      setTimeout(() => {
        // Only call if restore still hasn't completed (fallback for edge cases)
        if (!restoreCompletedRef.current) {
          checkHealthStatus();
        }
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      // Reset startSession flag on unmount so it can be called again on next mount
      startSessionCalledRef.current = false;
      isInitializingRef.current = false;
      // Persist remaining time override on navigation unmount as well
      // Only save if monitoring is still enabled AND component is initialized
      // This prevents saving default state before restore completes
      if (isEnabledRef.current && username && isInitializedRef.current) {
        try {
          const key = `vgw_health_remaining_${username}`;
          let remainingSec = remainingSecondsOverrideRef.current;

          // If we don't have an override, calculate remaining time from current state
          if (remainingSec === null) {
            // Calculate based on current timer state using refs
            if (lastBreakTimeRef.current) {
              const timeSinceBreak =
                Date.now() - lastBreakTimeRef.current.getTime();
              const timeSinceBreakMinutes = Math.floor(
                timeSinceBreak / (1000 * 60)
              );
              const remainingMinutes = Math.max(
                0,
                breakIntervalMinutesRef.current - timeSinceBreakMinutes
              );
              remainingSec = remainingMinutes * 60;
            } else if (
              sessionStartTimeRef.current &&
              lastActiveTimeRef.current
            ) {
              // Calculate current session time
              const baseTime = accumulatedSessionTimeRef.current;
              let currentSessionTime = baseTime;
              if (lastActiveTimeRef.current && isPageVisibleRef.current) {
                const now = new Date();
                currentSessionTime =
                  baseTime +
                  (now.getTime() - lastActiveTimeRef.current.getTime());
              }
              const sessionTimeMinutes = Math.floor(
                currentSessionTime / (1000 * 60)
              );
              const remainingMinutes = Math.max(
                0,
                breakIntervalMinutesRef.current - sessionTimeMinutes
              );
              remainingSec = remainingMinutes * 60;
            }
          }

          // Only save if we have a valid remaining time > 0
          if (remainingSec !== null && remainingSec > 0) {
            // Save to server (for cross-browser persistence)
            const saveToServer = async () => {
              try {
                await authFetch("/api/health/saveTimerState", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    remainingSeconds: remainingSec,
                    breakIntervalMinutes: breakIntervalMinutesRef.current,
                  }),
                });
                console.log("Saved timer state to server (cleanup)");
              } catch (error) {
                console.error("Error saving timer state to server:", error);
              }
            };
            saveToServer();

            // Also save to localStorage as backup/cache
            const timerData = {
              remainingSeconds: remainingSec,
              savedAt: Date.now(),
              breakIntervalMinutes: breakIntervalMinutesRef.current,
            };
            localStorage.setItem(key, JSON.stringify(timerData));
            console.log(
              "Saving remaining time:",
              remainingSec,
              "seconds (",
              Math.floor(remainingSec / 60),
              "minutes) - saved to server and localStorage"
            );
          } else {
            // Clear both server and localStorage if no remaining time
            const clearFromServer = async () => {
              try {
                await authFetch("/api/health/saveTimerState", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    remainingSeconds: 0,
                    breakIntervalMinutes: breakIntervalMinutesRef.current,
                  }),
                });
              } catch (error) {
                console.error("Error clearing timer state on server:", error);
              }
            };
            clearFromServer();
            localStorage.removeItem(key);
            console.log("Clearing timer state - no remaining time to save");
          }
        } catch (e) {
          console.error("Error saving remaining time to localStorage:", e);
        }
      } else if (!isEnabledRef.current && username) {
        // Clear localStorage when disabled
        try {
          const key = `vgw_health_remaining_${username}`;
          localStorage.removeItem(key);
        } catch (e) {
          // Ignore localStorage errors
        }
      }
      setHealthStatus((prev) => ({ ...prev, isMonitoring: false }));
      // Do not end the session on unmount due to in-app navigation (or on page unload,
      // which only pauses it so it can resume within 24h). It ends on explicit sign-out:
      // the page calls endSession() from handleSignOut.
    };
  }, [username, isEnabled, checkInterval]);

  // Track page visibility changes (when user switches tabs or minimizes)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden - don't pause immediately, just track the time
        // Timer continues running even when user is in another tab
        isPageVisibleRef.current = false;
      } else {
        // Page is visible - resume if it was paused
        isPageVisibleRef.current = true;
        if (!lastActiveTimeRef.current) {
          resumeSession();
        }
      }
    };

    const handleBeforeUnload = () => {
      // Page is being unloaded - pause session but don't end it
      pauseSession();
      // Persist the current remaining time so we resume from exactly where it was
      // Only save if component is initialized (prevents saving during initial mount)
      try {
        if (username && isEnabledRef.current && isInitializedRef.current) {
          // Prefer override value if present; otherwise compute from current state
          let remainingSec = remainingSecondsOverrideRef.current;
          if (remainingSec === null) {
            const next =
              healthStatus.nextBreakIn ??
              Math.max(0, breakIntervalMinutesRef.current);
            remainingSec = Math.max(0, Math.round(next * 60));
          }
          // Only save if we have a valid remaining time > 0
          if (remainingSec > 0) {
            // Save to server (for cross-browser persistence)
            const saveToServer = async () => {
              try {
                await authFetch("/api/health/saveTimerState", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    remainingSeconds: remainingSec,
                    breakIntervalMinutes: breakIntervalMinutesRef.current,
                  }),
                });
                console.log("Saved timer state to server (beforeunload)");
              } catch (error) {
                console.error("Error saving timer state to server:", error);
              }
            };
            saveToServer();

            // Also save to localStorage as backup/cache
            const timerData = {
              remainingSeconds: remainingSec,
              savedAt: Date.now(),
              breakIntervalMinutes: breakIntervalMinutesRef.current,
            };
            localStorage.setItem(
              `vgw_health_remaining_${username}`,
              JSON.stringify(timerData)
            );
          }
        }
      } catch (e) {}
    };

    const handleFocus = () => {
      // Page gained focus - ensure we're tracking time
      isPageVisibleRef.current = true;
      if (!lastActiveTimeRef.current) {
        resumeSession();
      }
    };

    const handleBlur = () => {
      // Page lost focus - don't pause, just mark as not visible
      isPageVisibleRef.current = false;
    };

    // Add event listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      // Cleanup event listeners
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [username]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  return {
    healthStatus,
    healthTips,
    dismissHealthTips,
    recordBreak,
    endBreak,
    snoozeReminder,
    checkHealthStatus,
    endSession,
  };
};

export default useHealthMonitoring;
