import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { UseAchievementPollingProps, AchievementData } from "../types";
import { authFetch } from "../utils/authFetch";

const useAchievementPolling = ({
  username,
  isEnabled,
  pollingInterval = 120000, // 2 minutes
}: UseAchievementPollingProps) => {
  const [isPolling, setIsPolling] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("lastAchievementChecked");
      if (stored) {
        const date = new Date(stored);
        console.log(
          "Loaded lastChecked from localStorage:",
          date.toISOString()
        );
        return date;
      }
    }
    return null;
  });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<Date | null>(lastChecked);

  // Force ref to always be in sync with state
  useEffect(() => {
    lastCheckedRef.current = lastChecked;
  }, [lastChecked]);

  // Persist lastChecked to localStorage and update ref
  useEffect(() => {
    if (typeof window !== "undefined" && lastChecked) {
      localStorage.setItem("lastAchievementChecked", lastChecked.toISOString());
      lastCheckedRef.current = lastChecked;
    }
  }, [lastChecked]);

  // Function to check for new achievements
  const checkForNewAchievements = async () => {
    if (!username || !isEnabled) return;

    try {
      // Get the most current lastChecked value from localStorage
      const currentLastChecked =
        typeof window !== "undefined"
          ? localStorage.getItem("lastAchievementChecked")
          : null;

      // The user is identified by the auth cookie
      const requestBody = {
        lastChecked: currentLastChecked,
      };

      console.log("Sending achievement check request:", requestBody);
      console.log(
        "lastCheckedRef.current:",
        lastCheckedRef.current?.toISOString()
      );
      console.log("localStorage lastChecked:", currentLastChecked);

      const response = await authFetch("/api/checkNewAchievements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // console.warn(
        //   "Failed to check for new achievements:",
        //   response.statusText
        // ); // Commented out for production
        return;
      }

      const data = await response.json();

      // Debug logging
      console.log("Achievement polling result:", {
        hasNewAchievements: data.hasNewAchievements,
        achievementsCount: data.achievements?.length || 0,
        lastChecked: lastChecked?.toISOString(),
        currentTime: new Date().toISOString(),
      });

      if (data.hasNewAchievements && data.achievements) {
        const achievementData: AchievementData = {
          username: data.username,
          achievements: data.achievements,
          isPro: data.isPro || false,
          message:
            data.message ||
            `Congratulations! You've earned ${
              data.achievements.length
            } new achievement${data.achievements.length > 1 ? "s" : ""}!`,
          totalAchievements: data.totalAchievements || 0,
        };

        // Show notification
        showAchievementNotification(achievementData);

        // Update last checked timestamp to NOW
        // This ensures we don't show the same achievement again
        const newLastChecked = new Date(); // Use current time, not achievement date
        console.log("Updating lastChecked to:", newLastChecked.toISOString());
        console.log(
          "Before update - lastCheckedRef.current:",
          lastCheckedRef.current?.toISOString()
        );

        // Update both state and ref immediately
        setLastChecked(newLastChecked);
        lastCheckedRef.current = newLastChecked;

        console.log(
          "After update - lastCheckedRef.current:",
          lastCheckedRef.current?.toISOString()
        );

        // Also update localStorage immediately
        if (typeof window !== "undefined") {
          localStorage.setItem(
            "lastAchievementChecked",
            newLastChecked.toISOString()
          );
        }
      }
      // Don't update lastChecked if no new achievements - this prevents resetting the timestamp
    } catch (error) {
      console.error("Error checking for new achievements:", error);
    }
  };

  // Function to show achievement notification (reused from useSocket)
  const showAchievementNotification = (data: AchievementData) => {
    if (data.isPro) {
      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? "animate-enter" : "animate-leave"
            } w-auto bg-gradient-to-r from-purple-600 to-indigo-600 shadow-xl rounded-md pointer-events-auto flex items-center px-3 py-2 border border-purple-400`}
            style={{
              position: "fixed",
              top: "60px",
              right: "20px",
              zIndex: 9999,
            }}
          >
            <div className="flex items-center">
              <span className="text-lg mr-2">🏆</span>
              <div>
                <p className="text-xs font-bold text-white">
                  Achievement Unlocked!
                </p>
                <p className="text-xs text-white">
                  {data.achievements.map((achievement, index) => (
                    <span key={index} className="mr-1">
                      {achievement.name}
                    </span>
                  ))}
                </p>
              </div>
            </div>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="ml-2 text-white hover:text-gray-200 text-sm font-bold"
            >
              ×
            </button>
          </div>
        ),
        {
          duration: 5000,
          position: "top-center",
        }
      );
    } else {
      // Regular achievement notification
      const achievementNames = data.achievements
        .map((achievement, index) => `${index + 1}. ${achievement.name}`)
        .join("\n");
      toast.success(`Achievement Unlocked!\n${achievementNames}`, {
        duration: 4000,
        position: "top-center",
      });
    }
  };

  // Start polling when username is available and enabled
  useEffect(() => {
    if (!username || !isEnabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setIsPolling(false);
      }
      return;
    }

    // If this is the first time checking (no lastChecked timestamp),
    // set the initial timestamp to now to prevent showing existing achievements
    if (!lastChecked) {
      setLastChecked(new Date());
    }

    // Start polling
    setIsPolling(true);
    intervalRef.current = setInterval(checkForNewAchievements, pollingInterval);

    // Check immediately on first load
    checkForNewAchievements();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setIsPolling(false);
      }
    };
  }, [username, isEnabled, pollingInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    isPolling,
    lastChecked,
    checkForNewAchievements: checkForNewAchievements,
  };
};

export default useAchievementPolling;
