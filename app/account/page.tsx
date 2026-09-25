"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { HealthMonitoring, AccountData } from "@/types";
import axios from "../../utils/axiosConfig";
import ProfileShareModal from "@/components/ProfileShareModal";
import Avatar from "@/components/Avatar";
import AvatarSelector from "@/components/AvatarSelector";
import GameTracker from "@/components/GameTracker";
import TwitchBotChannelManager from "@/components/TwitchBotChannelManager";
import TwitchAccountLinker from "@/components/TwitchAccountLinker";
import TwitchModerationSettings from "@/components/TwitchModerationSettings";
import TwitchBotAnalytics from "@/components/TwitchBotAnalytics";
import ChallengeHistory from "@/components/ChallengeHistory";
import { GameTracking } from "@/types";

export default function AccountPage() {
  const router = useRouter();
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Password management state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  // Health settings state
  const [healthSettings, setHealthSettings] = useState<HealthMonitoring>({
    breakReminderEnabled: true,
    breakIntervalMinutes: 45,
    totalSessionTime: 0,
    breakCount: 0,
    healthTipsEnabled: true,
  });
  const [healthSettingsLoading, setHealthSettingsLoading] = useState(false);
  const [healthSettingsError, setHealthSettingsError] = useState("");
  const [healthSettingsSuccess, setHealthSettingsSuccess] = useState("");

  // Email preferences state
  const [weeklyDigestEnabled, setWeeklyDigestEnabled] = useState(true);
  const [emailPreferencesLoading, setEmailPreferencesLoading] = useState(false);
  const [emailPreferencesError, setEmailPreferencesError] = useState("");
  const [emailPreferencesSuccess, setEmailPreferencesSuccess] = useState("");

  // Username reset state
  const [usernameResetLoading, setUsernameResetLoading] = useState(false);
  const [usernameResetError, setUsernameResetError] = useState("");
  const [usernameResetSuccess, setUsernameResetSuccess] = useState("");
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");

  // Profile share modal state
  const [showProfileShareModal, setShowProfileShareModal] = useState(false);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showAvatarSelector, setShowAvatarSelector] = useState(false);

  // Game tracking state
  const [gameTracking, setGameTracking] = useState<GameTracking | null>(null);

  // Session management state
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(
    null
  );

  // Fetch active sessions
  const fetchSessions = useCallback(async (retryCount = 0) => {
    try {
      setSessionsLoading(true);
      setSessionsError("");

      // Prevent infinite retry loops
      if (retryCount > 1) {
        throw new Error("Session expired. Please sign in again.");
      }

      let response = await fetch("/api/auth/sessions", {
        method: "GET",
        credentials: "include",
      });

      // If we get a 401, try to refresh the token and retry (only once)
      if (response.status === 401 && retryCount === 0) {
        try {
          // Attempt to refresh the token
          const refreshResponse = await fetch("/api/auth/refresh", {
            method: "POST",
            credentials: "include",
          });

          if (refreshResponse.ok) {
            // Token refreshed successfully, retry the sessions request (only once)
            return fetchSessions(1);
          } else {
            // Refresh failed - get error details
            const refreshData = await refreshResponse.json().catch(() => ({}));
            const refreshErrorMsg =
              refreshData.message ||
              refreshData.error ||
              "Token refresh failed";

            if (
              refreshErrorMsg.includes("revoked") ||
              refreshErrorMsg.includes("Session has been revoked")
            ) {
              throw new Error(
                "Unable to refresh session. Please try signing out and back in."
              );
            } else if (
              refreshErrorMsg.includes("expired") ||
              refreshErrorMsg.includes("not found")
            ) {
              throw new Error(
                "Session expired. Please try signing out and back in."
              );
            } else {
              // Other refresh error - show generic message
              throw new Error(
                "Unable to load sessions. Please try refreshing the page."
              );
            }
          }
        } catch (refreshError) {
          // Refresh failed - don't retry again
          const errorMessage =
            refreshError instanceof Error
              ? refreshError.message
              : "Session expired. Please sign in again.";
          throw new Error(errorMessage);
        }
      }

      if (!response.ok) {
        // Get error details for better debugging
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.message || errorData.error || "Failed to fetch sessions";
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to load active sessions";
      setSessionsError(errorMessage);

      // Don't auto-redirect - just show the error message
      // User can manually sign out if needed
      // Auto-redirect was causing loops when combined with auto-login logic
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Ensure we're on the client side
    if (typeof window === 'undefined') {
      return;
    }

    console.log("[Account Page] Starting to fetch account data...");

    const fetchAccountData = async () => {
      try {
        setLoading(true);
        console.log("[Account Page] Loading state set to true");
        
        // First, try to get username from session (more reliable)
        let username: string | null = null;
        try {
          console.log("[Account Page] Attempting to verify session...");
          const verifyResponse = await fetch("/api/auth/verify", {
            method: "GET",
            credentials: "include",
          });
          
          console.log("[Account Page] Verify response status:", verifyResponse.status);
          
          // Try to parse response even if status is not OK (might still have username)
          const verifyData = await verifyResponse.json().catch(() => null);
          
          if (verifyResponse.ok && verifyData?.authenticated && verifyData.user?.username) {
            username = verifyData.user.username;
            console.log("[Account Page] Username from session:", username);
            // Update localStorage to keep it in sync
            if (username) {
              localStorage.setItem("username", username);
            }
          } else if (verifyResponse.status === 401 || verifyResponse.status === 403) {
            // Session exists but might not have Pro access - try localStorage
            console.log("Session verification returned:", verifyResponse.status, verifyData?.message || "Unknown");
          }
        } catch (error) {
          console.error("Error verifying session:", error);
        }
        
        // Fall back to localStorage if session verification failed
        if (!username) {
          username = localStorage.getItem("username");
          if (username) {
            console.log("Using username from localStorage:", username);
          }
        }

        // Fetch user data. The API identifies the user from the auth cookie only; the shared
        // axios instance refreshes an expired access token and retries on 401.
        let userData: any;
        try {
          ({ data: userData } = await axios.post("/api/accountData"));
        } catch (err: any) {
          if (err?.response?.status === 401) {
            // No valid session (and refresh failed) - send them to sign in
            window.location.assign("/signin");
            return;
          }
          throw new Error("Failed to fetch user data");
        }

        // The session is the source of truth - override any stale localStorage username
        if (userData?.user?.username && userData.user.username !== username) {
          username = userData.user.username;
          localStorage.setItem("username", userData.user.username);
        }

        // Fetch subscription status (use username from response if available)
        const usernameForProCheck = username || userData?.user?.username;
        if (!usernameForProCheck) {
          throw new Error("Unable to determine username");
        }

        const subscriptionResponse = await fetch("/api/checkProAccess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: usernameForProCheck }),
        });

        if (!subscriptionResponse.ok) {
          throw new Error("Failed to fetch subscription data");
        }

        const subscriptionData = await subscriptionResponse.json();

        // Debug logging (development only)
        if (process.env.NODE_ENV === "development") {
          console.log(
            "Account page - subscription data received:",
            subscriptionData
          );
        }

        setAccountData({
          username: userData.user.username,
          email: userData.user.email,
          hasProAccess: subscriptionData.hasProAccess,
          subscriptionStatus: subscriptionData.subscriptionStatus,
          conversationCount: userData.user.conversationCount || 0,
          achievements: userData.user.achievements || [],
          challengeRewards: userData.user.challengeRewards || [],
          progress: userData.user.progress || { totalQuestions: 0 },
          hasPassword: !!userData.user.hasPassword,
          healthMonitoring: userData.user.healthMonitoring,
          twitchUsername: userData.user.twitchUsername || null,
          twitchId: userData.user.twitchId || null,
        });

        // Initialize email preferences
        if (userData.user.weeklyDigest !== undefined) {
          setWeeklyDigestEnabled(userData.user.weeklyDigest.enabled !== false); // Default to true if not set
        }

        // Initialize health settings if available
        if (userData.user.healthMonitoring) {
          setHealthSettings(userData.user.healthMonitoring);
        }

        // Fetch avatar
        try {
          const avatarResponse = await fetch("/api/avatar/recent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: userData.user.username }),
          });
          if (avatarResponse.ok) {
            const avatarData = await avatarResponse.json();
            setAvatarUrl(avatarData.currentAvatar);
          }
        } catch (error) {
          console.error("Error fetching avatar:", error);
        }

        // Fetch game tracking
        try {
          // Authenticated via cookie; shared axios instance refreshes an expired token
          const { data: gameTrackingData } = await axios.post("/api/game-tracking-get");
          setGameTracking(gameTrackingData.gameTracking || null);
        } catch (error) {
          console.error("Error fetching game tracking:", error);
        }

        // Fetch active sessions
        fetchSessions();
      } catch (err) {
        console.error("Error fetching account data:", err);
        setError("Failed to load account data");
      } finally {
        setLoading(false);
      }
    };

    fetchAccountData();
  }, [fetchSessions]);

  // Revoke a specific session
  const revokeSession = async (sessionId: string) => {
    try {
      setRevokingSessionId(sessionId);
      const response = await fetch(`/api/auth/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to revoke session");
      }

      // Refresh sessions list
      await fetchSessions();
    } catch (error) {
      console.error("Error revoking session:", error);
      setSessionsError("Failed to revoke session");
    } finally {
      setRevokingSessionId(null);
    }
  };

  // Revoke all other sessions
  const revokeAllOtherSessions = async () => {
    if (
      !confirm(
        "Are you sure you want to revoke all other sessions? You will be logged out on all other devices."
      )
    ) {
      return;
    }

    try {
      setSessionsLoading(true);
      const response = await fetch("/api/auth/sessions", {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to revoke sessions");
      }

      // Refresh sessions list
      await fetchSessions();
    } catch (error) {
      console.error("Error revoking all sessions:", error);
      setSessionsError("Failed to revoke sessions");
    } finally {
      setSessionsLoading(false);
    }
  };

  // Format date for display (relative time for sessions)
  const formatRelativeDate = (dateString: string | Date) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return "Just now";
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  // Format IP address for display
  const formatIpAddress = (ip: string) => {
    if (!ip || ip === "unknown") {
      return "Unknown";
    }

    // Check if it's localhost (development)
    const cleanIp = ip.replace(/^\[|\]$/g, "");
    if (
      cleanIp === "::1" ||
      cleanIp === "127.0.0.1" ||
      cleanIp === "localhost"
    ) {
      return `${ip} (Localhost - Access via network IP to see real IP)`;
    }

    // Check if it's a private IP
    if (
      cleanIp.startsWith("192.168.") ||
      cleanIp.startsWith("10.") ||
      (cleanIp.startsWith("172.") &&
        parseInt(cleanIp.split(".")[1] || "0") >= 16 &&
        parseInt(cleanIp.split(".")[1] || "0") <= 31)
    ) {
      return `${ip} (Private Network)`;
    }

    return ip;
  };

  // Get device display name
  const getDeviceDisplayName = (session: any) => {
    const { deviceInfo } = session;
    if (deviceInfo.browser && deviceInfo.os) {
      return `${deviceInfo.browser} on ${deviceInfo.os}`;
    } else if (deviceInfo.browser) {
      return deviceInfo.browser;
    } else if (deviceInfo.os) {
      return deviceInfo.os;
    } else {
      return "Unknown Device";
    }
  };

  const handleUpgradeClick = () => {
    router.push("/upgrade");
  };

  const handleManageSubscription = () => {
    // Redirect to dedicated subscription management page
    router.push("/manage-subscription");
  };

  const handleReactivateSubscription = () => {
    // TODO: Implement reactivation flow
    console.log("Reactivate subscription clicked");
  };

  const handlePasswordSetup = async () => {
    setPasswordError("");
    setPasswordSuccess("");

    // Validate passwords
    if (!passwordData.newPassword || !passwordData.confirmPassword) {
      setPasswordError("Please fill in all password fields");
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    if (passwordData.newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters long");
      return;
    }

    try {
      const userId = localStorage.getItem("userId");
      const username = localStorage.getItem("username");

      if (!userId || !username) {
        setPasswordError("User information not found. Please sign in again.");
        return;
      }

      // Check if user has existing password
      if (accountData?.hasPassword) {
        // User has password, require current password for change
        if (!passwordData.currentPassword) {
          setPasswordError("Current password is required to change password");
          return;
        }

        // Verify current password first
        const verifyResponse = await axios.post("/api/auth/signin", {
          identifier: username,
          password: passwordData.currentPassword,
        });

        if (!verifyResponse.data.user) {
          setPasswordError("Current password is incorrect");
          return;
        }
      }

      // Set up or change password
      const response = await axios.post("/api/auth/setup-password", {
        userId,
        username,
        newPassword: passwordData.newPassword,
      });

      if (response.data) {
        setPasswordSuccess("Password updated successfully!");
        setAccountData((prev) =>
          prev ? { ...prev, hasPassword: true } : null
        );

        // Clear form
        setPasswordData({
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        });

        // Close modal after 2 seconds
        setTimeout(() => {
          setShowPasswordModal(false);
          setPasswordSuccess("");
        }, 2000);
      }
    } catch (error: any) {
      console.error("Password setup error:", error);
      setPasswordError(
        error.response?.data?.message ||
          "Failed to update password. Please try again."
      );
    }
  };

  const handlePasswordModalClose = () => {
    setShowPasswordModal(false);
    setPasswordData({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setPasswordError("");
    setPasswordSuccess("");
  };

  // Health settings handlers
  const handleHealthSettingsChange = (
    field: keyof HealthMonitoring,
    value: any
  ) => {
    setHealthSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveHealthSettings = async () => {
    setHealthSettingsLoading(true);
    setHealthSettingsError("");
    setHealthSettingsSuccess("");

    try {
      const username = localStorage.getItem("username");
      if (!username) {
        setHealthSettingsError("User not found. Please sign in again.");
        return;
      }

      const response = await axios.post("/api/health/updateSettings", {
        username,
        settings: healthSettings,
      });

      if (response.data.success) {
        setHealthSettingsSuccess("Health settings updated successfully!");
        setAccountData((prev) =>
          prev
            ? {
                ...prev,
                healthMonitoring: healthSettings,
              }
            : null
        );

        // Dispatch custom event to notify other tabs/pages that settings changed
        try {
          window.dispatchEvent(
            new CustomEvent("healthSettingsUpdated", {
              detail: { settings: healthSettings },
            })
          );
          // Also trigger localStorage change event for same-tab sync
          const event = new CustomEvent("localStorageChange", {
            detail: {
              key: "healthSettingsUpdated",
              newValue: JSON.stringify(healthSettings),
              oldValue: null,
            },
          });
          window.dispatchEvent(event);
        } catch (e) {
          // Ignore event dispatch errors
        }

        // Clear success message after 3 seconds
        setTimeout(() => {
          setHealthSettingsSuccess("");
        }, 3000);
      }
    } catch (error: any) {
      console.error("Error updating health settings:", error);
      setHealthSettingsError(
        error.response?.data?.message ||
          "Failed to update health settings. Please try again."
      );
    } finally {
      setHealthSettingsLoading(false);
    }
  };

  const handleResetUsername = () => {
    setShowUsernameModal(true);
    setNewUsername("");
    setUsernameResetError("");
    setUsernameResetSuccess("");
  };

  const handleUsernameSubmit = async () => {
    if (!newUsername || newUsername.trim().length === 0) {
      setUsernameResetError("Please enter a username.");
      return;
    }

    if (newUsername.trim().length < 3) {
      setUsernameResetError("Username must be at least 3 characters long.");
      return;
    }

    if (newUsername.trim().length > 32) {
      setUsernameResetError("Username must be 32 characters or less.");
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(newUsername.trim())) {
      setUsernameResetError(
        "Username can only contain letters, numbers, underscores, and hyphens."
      );
      return;
    }
    setUsernameResetLoading(true);
    setUsernameResetError("");
    setUsernameResetSuccess("");

    try {
      // Get current user info
      const userId = localStorage.getItem("userId");
      const email = localStorage.getItem("userEmail");

      if (!userId || !email) {
        setUsernameResetError(
          "User information not found. Please sign in again."
        );
        return;
      }

      // Use the syncUser API to update username with content moderation
      const res = await axios.post("/api/syncUser", {
        userId,
        email,
        username: newUsername.trim(),
      });

      if (res.data && res.data.user) {
        // Update local storage
        localStorage.setItem("username", newUsername.trim());
        localStorage.setItem("userId", res.data.user.userId);
        localStorage.setItem("userEmail", res.data.user.email);

        // Update account data
        setAccountData((prev) =>
          prev
            ? {
                ...prev,
                username: newUsername.trim(),
              }
            : null
        );

        setUsernameResetSuccess(
          `Username updated successfully to: ${newUsername.trim()}`
        );

        // Close modal and clear success message after 3 seconds
        setShowUsernameModal(false);
        setTimeout(() => {
          setUsernameResetSuccess("");
        }, 3000);
      }
    } catch (err: any) {
      console.error("Error resetting username:", err);

      if (err.response?.data?.message) {
        // Handle content violation specifically
        if (
          err.response.data.offendingWords &&
          err.response.data.violationResult
        ) {
          const violationResult = err.response.data.violationResult;
          let violationMessage = err.response.data.message;

          // Add specific violation details based on action
          if (violationResult.action === "warning") {
            violationMessage += ` Warning ${violationResult.count}/3. Please choose a different username.`;
          } else if (violationResult.action === "banned") {
            const banDate = new Date(
              violationResult.expiresAt
            ).toLocaleDateString();
            violationMessage += ` You are temporarily banned until ${banDate}. Please try again later.`;
          } else if (violationResult.action === "permanent_ban") {
            violationMessage += ` You are permanently banned from using this application.`;
          }

          setUsernameResetError(violationMessage);
        } else {
          setUsernameResetError(err.response.data.message);
        }
      } else {
        setUsernameResetError("Failed to update username. Please try again.");
      }
    } finally {
      setUsernameResetLoading(false);
    }
  };

  const handleCloseUsernameModal = () => {
    setShowUsernameModal(false);
    setNewUsername("");
    setUsernameResetError("");
    setUsernameResetSuccess("");
  };

  const getSubscriptionStatusDisplay = () => {
    // If we have detailed subscription status, use it
    if (accountData?.subscriptionStatus) {
      const status = accountData.subscriptionStatus;

      switch (status.type) {
        case "free_period":
          return {
            status: status.showWarning
              ? "Free Period (Expiring Soon)"
              : "Free Period Active",
            color: status.showWarning ? "text-orange-400" : "text-green-400",
            bgColor: status.showWarning
              ? "bg-orange-500/20"
              : "bg-green-500/20",
            borderColor: status.showWarning
              ? "border-orange-500/40"
              : "border-green-500/40",
            action: status.showWarning ? "Upgrade Now" : "Upgrade Now",
            actionHandler: handleUpgradeClick,
            actionColor: "from-[#00ffff] to-[#ff69b4]",
            details: {
              type: "FREE PERIOD",
              status: status.showWarning
                ? "Free Period (Expiring Soon)"
                : "Free Period Active",
              canUpgrade: true,
            },
          };

        case "paid_active":
          return {
            status: "Paid Subscription Active",
            color: "text-blue-400",
            bgColor: "bg-blue-500/20",
            borderColor: "border-blue-500/40",
            action: "Manage Subscription",
            actionHandler: handleManageSubscription,
            actionColor: "from-purple-500 to-pink-500",
            details: {
              type: "PAID SUBSCRIPTION",
              status: "Paid Subscription Active",
              canUpgrade: false,
            },
          };

        case "canceled_active":
          return {
            status: "Pro Member (Canceled)",
            color: "text-yellow-400",
            bgColor: "bg-yellow-500/20",
            borderColor: "border-yellow-500/40",
            action: "Reactivate Subscription",
            actionHandler: handleReactivateSubscription,
            actionColor: "from-green-500 to-blue-500",
            details: {
              type: "CANCELED ACTIVE",
              status: "Subscription Canceled (Active Until Period End)",
              canUpgrade: false,
              expiresAt: status.expiresAt,
            },
          };

        case "expired_free":
          return {
            status: "Free Period Expired",
            color: "text-red-400",
            bgColor: "bg-red-500/20",
            borderColor: "border-red-500/40",
            action: "Upgrade Now",
            actionHandler: handleUpgradeClick,
            actionColor: "from-[#00ffff] to-[#ff69b4]",
            details: {
              type: "EXPIRED FREE",
              status: "Free Period Expired",
              canUpgrade: true,
            },
          };

        case "no_subscription":
          return {
            status: "No Subscription",
            color: "text-gray-400",
            bgColor: "bg-gray-500/20",
            borderColor: "border-gray-500/40",
            action: "Upgrade Now",
            actionHandler: handleUpgradeClick,
            actionColor: "from-[#00ffff] to-[#ff69b4]",
            details: {
              type: "NO SUBSCRIPTION",
              status: "No Active Subscription",
              canUpgrade: true,
              canCancel: false,
            },
          };

        default:
          // Fallback for unknown status types
          break;
      }
    }

    // Fallback: If user has Pro access but no detailed subscription status, show as active
    if (accountData?.hasProAccess) {
      return {
        status: "Paid Subscription Active",
        color: "text-blue-400",
        bgColor: "bg-blue-500/20",
        borderColor: "border-blue-500/40",
        action: "Manage Subscription",
        actionHandler: handleManageSubscription,
        actionColor: "from-purple-500 to-pink-500",
        details: {
          type: "PAID SUBSCRIPTION",
          status: "Paid Subscription Active",
          canUpgrade: false,
          canCancel: true,
        },
      };
    }

    // Final fallback: No subscription data
    return {
      status: "No Subscription",
      color: "text-gray-400",
      bgColor: "bg-gray-500/20",
      borderColor: "border-gray-500/40",
      action: "Upgrade Now",
      actionHandler: handleUpgradeClick,
      actionColor: "from-[#00ffff] to-[#ff69b4]",
      details: {
        type: "NO SUBSCRIPTION",
        status: "No Active Subscription",
        canUpgrade: true,
        canCancel: false,
      },
    };
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1b2e] text-white py-12 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00ffff] mx-auto mb-4"></div>
            <p className="text-gray-300">Loading your account information...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#1a1b2e] text-white py-12 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center">
            <div className="text-red-400 mb-4">⚠️</div>
            <p className="text-gray-300 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:from-[#00e6e6] hover:to-[#ff4da6] transition-all duration-200"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!accountData) {
    return (
      <div className="min-h-screen bg-[#1a1b2e] text-white py-12 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center">
            <p className="text-gray-300 mb-4">No account data available</p>
            <button
              onClick={() => router.push("/")}
              className="px-6 py-3 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:from-[#00e6e6] hover:to-[#ff4da6] transition-all duration-200"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusDisplay = getSubscriptionStatusDisplay();

  return (
    <div className="min-h-screen bg-[#1a1b2e] text-white py-12 px-4">
      <style jsx>{`
        .slider {
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          border-radius: 4px;
          outline: none;
        }

        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #00ffff;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #00ffff;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
      `}</style>
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">
            Account Dashboard
            <div className="w-48 h-1 bg-gradient-to-r from-[#00ffff] via-[#ff69b4] to-[#00ffff] mx-auto mt-4"></div>
          </h1>
          <p className="text-xl text-gray-300">
            Manage your account and subscription settings
          </p>
        </div>

        {/* Back Button */}
        <div className="mb-8">
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white font-semibold rounded-lg hover:opacity-90 transition-all duration-200 shadow-lg flex items-center space-x-2"
            aria-label="Back to main page"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            <span>Back to Wingman</span>
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Account Information */}
          <div className="lg:col-span-1">
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
              <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
                Account Info
              </h2>

              <div className="space-y-4">
                {/* Avatar Section */}
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Profile Picture
                  </label>
                  <div className="flex items-center space-x-4 mb-4">
                    <Avatar
                      src={avatarUrl}
                      username={accountData.username}
                      size={64}
                      onClick={() => setShowAvatarSelector(true)}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                    />
                    <button
                      onClick={() => setShowAvatarSelector(true)}
                      className="px-4 py-2 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 text-sm font-semibold"
                    >
                      Change Avatar
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-gray-400 text-sm">Username</label>
                  <div className="flex items-center justify-between">
                    <p className="text-white font-semibold">
                      {accountData.username}
                    </p>
                    <button
                      onClick={handleResetUsername}
                      disabled={usernameResetLoading}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors duration-200"
                    >
                      {usernameResetLoading ? "Updating..." : "Change"}
                    </button>
                  </div>

                  {/* Username reset messages */}
                  {usernameResetError && (
                    <p className="text-red-400 text-sm mt-2">
                      {usernameResetError}
                    </p>
                  )}
                  {usernameResetSuccess && (
                    <p className="text-green-400 text-sm mt-2">
                      {usernameResetSuccess}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-gray-400 text-sm">Email</label>
                  <p className="text-white font-semibold">
                    {accountData.email}
                  </p>
                </div>

                <div>
                  <label className="text-gray-400 text-sm">Conversations</label>
                  <p className="text-white font-semibold">
                    {accountData.conversationCount}
                  </p>
                </div>

                <div>
                  <label className="text-gray-400 text-sm">
                    Total Questions
                  </label>
                  <p className="text-white font-semibold">
                    {accountData.progress.totalQuestions || 0}
                  </p>
                </div>
              </div>

              {/* Profile Share Button */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <button
                  onClick={() => setShowProfileShareModal(true)}
                  className="w-full px-4 py-3 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 font-semibold flex items-center justify-center gap-2"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  Share My Profile
                </button>
                <p className="text-gray-400 text-xs mt-2 text-center">
                  Create a shareable profile card with your stats
                </p>
              </div>
            </div>

            {/* Security Settings */}
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20 mt-6">
              <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
                Security Settings
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="text-gray-400 text-sm">
                    Password Status
                  </label>
                  <p className="text-white font-semibold">
                    {accountData.hasPassword ? (
                      <span className="text-green-400">✓ Password Set</span>
                    ) : (
                      <span className="text-yellow-400">⚠ No Password</span>
                    )}
                  </p>
                </div>

                <div>
                  <button
                    onClick={() => setShowPasswordModal(true)}
                    className="w-full px-4 py-2 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 text-sm font-semibold"
                  >
                    {accountData.hasPassword
                      ? "Change Password"
                      : "Set Password"}
                  </button>
                </div>

                {!accountData.hasPassword && (
                  <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-3">
                    <p className="text-yellow-200 text-xs">
                      <strong>Security Notice:</strong> Your account
                      doesn&apos;t have a password set. We recommend setting one
                      for better security.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Active Sessions */}
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20 mt-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-[#00ffff]">
                  Active Sessions
                </h2>
                <button
                  onClick={() => fetchSessions()}
                  disabled={sessionsLoading}
                  className="px-3 py-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors duration-200"
                  title="Refresh sessions"
                >
                  <svg
                    className={`w-4 h-4 ${
                      sessionsLoading ? "animate-spin" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>

              {sessionsError && (
                <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 mb-4">
                  <p className="text-red-200 text-sm mb-2">{sessionsError}</p>
                  <button
                    onClick={() => {
                      // Clear session storage to prevent loops
                      sessionStorage.clear();
                      // Redirect to sign out
                      window.location.href = "/api/auth/logout";
                    }}
                    className="text-red-300 hover:text-red-200 text-xs underline"
                  >
                    Sign out and sign back in
                  </button>
                </div>
              )}

              {sessionsLoading && sessions.length === 0 ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#00ffff]"></div>
                  <p className="text-gray-400 mt-2">Loading sessions...</p>
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-400">No active sessions found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <div
                      key={session.sessionId}
                      className={`bg-[#1a1b2e]/50 rounded-lg p-4 border ${
                        session.isCurrentSession
                          ? "border-[#00ffff]/50"
                          : "border-gray-700/50"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-white font-semibold">
                              {getDeviceDisplayName(session)}
                            </h3>
                            {session.isCurrentSession && (
                              <span className="px-2 py-0.5 bg-[#00ffff]/20 text-[#00ffff] text-xs rounded-full font-semibold">
                                Current Session
                              </span>
                            )}
                          </div>
                          <div className="space-y-1 text-sm text-gray-400">
                            {session.deviceInfo.device && (
                              <p>
                                <span className="text-gray-500">Device:</span>{" "}
                                {session.deviceInfo.device}
                              </p>
                            )}
                            {session.deviceInfo.platform && (
                              <p>
                                <span className="text-gray-500">Platform:</span>{" "}
                                {session.deviceInfo.platform}
                              </p>
                            )}
                            <p>
                              <span className="text-gray-500">IP Address:</span>{" "}
                              {formatIpAddress(session.ipAddress)}
                            </p>
                            <p>
                              <span className="text-gray-500">
                                Last Activity:
                              </span>{" "}
                              {formatRelativeDate(session.lastActivity)}
                            </p>
                            {session.createdAt && (
                              <p>
                                <span className="text-gray-500">Created:</span>{" "}
                                {formatRelativeDate(session.createdAt)}
                              </p>
                            )}
                          </div>
                        </div>
                        {!session.isCurrentSession && (
                          <button
                            onClick={() => revokeSession(session.sessionId)}
                            disabled={revokingSessionId === session.sessionId}
                            className="ml-4 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors duration-200"
                            title="Revoke this session"
                          >
                            {revokingSessionId === session.sessionId
                              ? "Revoking..."
                              : "Revoke"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sessions.length > 1 && (
                <div className="mt-4 pt-4 border-t border-gray-700">
                  <button
                    onClick={revokeAllOtherSessions}
                    disabled={sessionsLoading}
                    className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors duration-200 text-sm font-semibold"
                  >
                    Revoke All Other Sessions
                  </button>
                  <p className="text-gray-400 text-xs mt-2 text-center">
                    This will log you out on all devices except this one
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Subscription Status */}
          <div className="lg:col-span-2">
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
              {/* Subscription Details */}
              <div className="grid md:grid-cols-3 gap-6">
                <div className="bg-[#1a1b2e]/50 rounded-lg p-6 md:col-span-2">
                  <h4 className="text-lg font-semibold mb-3 text-[#00ffff]">
                    Subscription Details
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Type:</span>
                      <span className="text-white">
                        {statusDisplay.details?.type ||
                          (accountData.subscriptionStatus?.type
                            ? accountData.subscriptionStatus.type
                                .replace(/_/g, " ")
                                .toUpperCase()
                            : "NO SUBSCRIPTION")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Status:&nbsp;</span>
                      <span className="text-white whitespace-nowrap">
                        {statusDisplay.details?.status ||
                          accountData.subscriptionStatus?.status ||
                          "No Active Subscription"}
                      </span>
                    </div>
                    {accountData.subscriptionStatus?.daysUntilExpiration && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Days Remaining:</span>
                        <span className="text-white font-semibold">
                          {accountData.subscriptionStatus.daysUntilExpiration}{" "}
                          days
                        </span>
                      </div>
                    )}
                    {(statusDisplay.details?.canUpgrade ||
                      accountData.subscriptionStatus?.canUpgrade) && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Can Upgrade:</span>
                        <span className="text-green-400">Yes</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-[#1a1b2e]/50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold mb-3 text-[#00ffff]">
                    Quick Actions
                  </h4>
                  <div className="space-y-3">
                    <button
                      onClick={statusDisplay.actionHandler}
                      className="w-full px-4 py-2 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 text-sm"
                    >
                      {statusDisplay.action}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Game Tracker */}
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20 mt-6">
              <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
                Game Tracker
              </h2>
              <p className="text-gray-400 text-sm mb-4">
                Track games you want to play or are currently playing. Share
                your gaming status with others!
              </p>
              {accountData && (
                <GameTracker
                  gameTracking={gameTracking || undefined}
                  onUpdate={async () => {
                    // Refresh game tracking data
                    try {
                      const { data } = await axios.post("/api/game-tracking-get");
                      setGameTracking(data.gameTracking || null);
                    } catch (error) {
                      console.error("Error refreshing game tracking:", error);
                    }
                  }}
                />
              )}
            </div>

            {/* Challenge History */}
            {accountData && (
              <div className="mt-6">
                <ChallengeHistory username={accountData.username} />
              </div>
            )}

            {/* Health & Wellness Settings */}
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20 mt-6">
              <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
                Health & Wellness
              </h2>

              <div className="space-y-6">
                {/* Break Reminders */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-white font-semibold">
                        Break Reminders
                      </label>
                      <p className="text-gray-400 text-sm">
                        Get reminders to take breaks while gaming
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        handleHealthSettingsChange(
                          "breakReminderEnabled",
                          !healthSettings.breakReminderEnabled
                        )
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        healthSettings.breakReminderEnabled
                          ? "bg-[#00ffff]"
                          : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          healthSettings.breakReminderEnabled
                            ? "translate-x-6"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Break Interval */}
                  {healthSettings.breakReminderEnabled && (
                    <div className="ml-4 space-y-2">
                      <label className="text-gray-300 text-sm">
                        Break Interval: {healthSettings.breakIntervalMinutes}{" "}
                        minutes
                      </label>
                      <div className="relative max-w-md mx-auto">
                        <input
                          type="range"
                          min="15"
                          max="90"
                          step="15"
                          value={healthSettings.breakIntervalMinutes}
                          onChange={(e) => {
                            const actualValue = parseInt(e.target.value);
                            handleHealthSettingsChange(
                              "breakIntervalMinutes",
                              actualValue
                            );
                          }}
                          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                          style={{
                            background: `linear-gradient(to right, #00ffff 0%, #00ffff ${
                              ((healthSettings.breakIntervalMinutes - 15) /
                                (90 - 15)) *
                              100
                            }%, #374151 ${
                              ((healthSettings.breakIntervalMinutes - 15) /
                                (90 - 15)) *
                              100
                            }%, #374151 100%)`,
                          }}
                        />
                        <div className="relative text-xs text-gray-400 mt-2 w-full">
                          <span
                            className="absolute"
                            style={{
                              left: "0%",
                              transform: "translateX(-50%)",
                            }}
                          >
                            15m
                          </span>
                          <span
                            className="absolute"
                            style={{
                              left: "20%",
                              transform: "translateX(-50%)",
                            }}
                          >
                            30m
                          </span>
                          <span
                            className="absolute"
                            style={{
                              left: "40%",
                              transform: "translateX(-50%)",
                            }}
                          >
                            45m
                          </span>
                          <span
                            className="absolute"
                            style={{
                              left: "60%",
                              transform: "translateX(-50%)",
                            }}
                          >
                            60m
                          </span>
                          <span
                            className="absolute"
                            style={{
                              left: "80%",
                              transform: "translateX(-50%)",
                            }}
                          >
                            75m
                          </span>
                          <span
                            className="absolute"
                            style={{
                              left: "100%",
                              transform: "translateX(-50%)",
                            }}
                          >
                            90m
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Health Tips */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-white font-semibold">
                      Health Tips
                    </label>
                    <p className="text-gray-400 text-sm">
                      Show health tips every 30 minutes
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      handleHealthSettingsChange(
                        "healthTipsEnabled",
                        !healthSettings.healthTipsEnabled
                      )
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      healthSettings.healthTipsEnabled
                        ? "bg-[#00ffff]"
                        : "bg-gray-600"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        healthSettings.healthTipsEnabled
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {/* Error/Success Messages */}
                {healthSettingsError && (
                  <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-lg">
                    <p className="text-red-200 text-sm">
                      {healthSettingsError}
                    </p>
                  </div>
                )}

                {healthSettingsSuccess && (
                  <div className="p-3 bg-green-500/20 border border-green-500/40 rounded-lg">
                    <p className="text-green-200 text-sm">
                      {healthSettingsSuccess}
                    </p>
                  </div>
                )}

                {/* Save Button */}
                <button
                  onClick={handleSaveHealthSettings}
                  disabled={healthSettingsLoading}
                  className="w-full px-4 py-2 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {healthSettingsLoading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Saving...
                    </div>
                  ) : (
                    "Save Health Settings"
                  )}
                </button>
              </div>
            </div>

            {/* Email Preferences */}
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20 mt-6">
              <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
                Email Preferences
              </h2>

              <div className="space-y-6">
                {/* Weekly Digest Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-white font-semibold">
                      Weekly Digest Email
                    </label>
                    <p className="text-gray-400 text-sm">
                      Receive a weekly summary of your achievements, forum
                      activity, and game recommendations
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const newValue = !weeklyDigestEnabled;
                      setWeeklyDigestEnabled(newValue);

                      // Auto-save when toggled
                      setEmailPreferencesLoading(true);
                      setEmailPreferencesError("");
                      setEmailPreferencesSuccess("");

                      try {
                        const username = localStorage.getItem("username");
                        if (!username) {
                          setEmailPreferencesError(
                            "User not found. Please sign in again."
                          );
                          setWeeklyDigestEnabled(!newValue); // Revert
                          return;
                        }

                        const response = await axios.post(
                          "/api/email-preferences",
                          {
                            username,
                            weeklyDigestEnabled: newValue,
                          }
                        );

                        if (response.data.success) {
                          setEmailPreferencesSuccess(
                            newValue
                              ? "Weekly digest emails enabled"
                              : "Weekly digest emails disabled"
                          );
                          setTimeout(
                            () => setEmailPreferencesSuccess(""),
                            3000
                          );
                        }
                      } catch (error: any) {
                        console.error(
                          "Error updating email preferences:",
                          error
                        );
                        setEmailPreferencesError(
                          error.response?.data?.message ||
                            "Failed to update email preferences. Please try again."
                        );
                        setWeeklyDigestEnabled(!newValue); // Revert on error
                      } finally {
                        setEmailPreferencesLoading(false);
                      }
                    }}
                    disabled={emailPreferencesLoading}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      weeklyDigestEnabled ? "bg-[#00ffff]" : "bg-gray-600"
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        weeklyDigestEnabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {/* Error/Success Messages */}
                {emailPreferencesError && (
                  <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-lg">
                    <p className="text-red-200 text-sm">
                      {emailPreferencesError}
                    </p>
                  </div>
                )}

                {emailPreferencesSuccess && (
                  <div className="p-3 bg-green-500/20 border border-green-500/40 rounded-lg">
                    <p className="text-green-200 text-sm">
                      {emailPreferencesSuccess}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Twitch Account Linking (for viewers) */}
            <div className="mt-6">
              <TwitchAccountLinker
                twitchUsername={accountData.twitchUsername}
                twitchId={accountData.twitchId}
              />
            </div>

            {/* Twitch Bot Channel Management (for streamers) */}
            <div className="mt-6">
              <TwitchBotChannelManager />
            </div>

            {/* Twitch Bot Moderation Settings (only show when Twitch account is linked) */}
            {accountData.twitchUsername && (
              <div className="mt-6">
                <TwitchModerationSettings />
              </div>
            )}

            {/* Twitch Bot Analytics */}
            <div className="mt-6">
              <TwitchBotAnalytics />
            </div>
          </div>
        </div>

        {/* Challenge Rewards Section */}
        {accountData.challengeRewards &&
          accountData.challengeRewards.length > 0 && (
            <div className="mt-8">
              <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(255,215,0,0.1)] border border-[#ffd700]/20">
                <h2 className="text-2xl font-bold mb-6 text-[#ffd700]">
                  Challenge Rewards
                </h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {accountData.challengeRewards
                    .slice()
                    .sort((a, b) => {
                      // Sort by date earned (most recent first)
                      const dateA = a.dateEarned
                        ? new Date(a.dateEarned).getTime()
                        : 0;
                      const dateB = b.dateEarned
                        ? new Date(b.dateEarned).getTime()
                        : 0;
                      return dateB - dateA;
                    })
                    .slice(0, 6)
                    .map((reward, index) => (
                      <div
                        key={index}
                        className="bg-[#1a1b2e]/50 rounded-lg p-4"
                      >
                        <div className="text-2xl mb-2">
                          {reward.icon || "🎁"}
                        </div>
                        <h3 className="font-semibold text-white">
                          {reward.name}
                        </h3>
                        <p className="text-gray-400 text-sm mb-1">
                          {reward.description}
                        </p>
                        {reward.dateEarned && (
                          <p className="text-gray-500 text-xs">
                            Earned: {formatDate(reward.dateEarned)}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

        {/* Achievements Section */}
        {accountData.achievements.length > 0 && (
          <div className="mt-8">
            <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
              <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
                Recent Achievements
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {accountData.achievements
                  .slice(0, 6)
                  .map((achievement, index) => (
                    <div key={index} className="bg-[#1a1b2e]/50 rounded-lg p-4">
                      <div className="text-2xl mb-2">🏆</div>
                      <h3 className="font-semibold text-white">
                        {achievement.name}
                      </h3>
                      <p className="text-gray-400 text-sm">
                        Earned: {formatDate(achievement.dateEarned)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Password Setup/Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-[#252642] p-8 rounded-lg shadow-lg w-full max-w-md mx-4 border border-[#00ffff]/20">
            <div className="flex flex-col items-center mb-6">
              <h2 className="text-2xl font-bold mb-2 text-center text-[#00ffff]">
                {accountData?.hasPassword ? "Change Password" : "Set Password"}
              </h2>
              <p className="text-gray-300 text-center text-sm">
                {accountData?.hasPassword
                  ? "Enter your current password and choose a new one"
                  : "Set a password to secure your account"}
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handlePasswordSetup();
              }}
              className="space-y-4"
            >
              {/* Current Password (only if user has password) */}
              {accountData?.hasPassword && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={passwordData.currentPassword}
                    onChange={(e) =>
                      setPasswordData((prev) => ({
                        ...prev,
                        currentPassword: e.target.value,
                      }))
                    }
                    className="w-full p-3 border border-gray-600 rounded-lg focus:ring-2 focus:ring-[#00ffff] focus:border-transparent bg-gray-800 text-white"
                    placeholder="Enter your current password"
                    required
                  />
                </div>
              )}

              {/* New Password */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) =>
                    setPasswordData((prev) => ({
                      ...prev,
                      newPassword: e.target.value,
                    }))
                  }
                  className="w-full p-3 border border-gray-600 rounded-lg focus:ring-2 focus:ring-[#00ffff] focus:border-transparent bg-gray-800 text-white"
                  placeholder="Enter your new password"
                  minLength={8}
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  Password must be at least 8 characters long
                </p>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) =>
                    setPasswordData((prev) => ({
                      ...prev,
                      confirmPassword: e.target.value,
                    }))
                  }
                  className="w-full p-3 border border-gray-600 rounded-lg focus:ring-2 focus:ring-[#00ffff] focus:border-transparent bg-gray-800 text-white"
                  placeholder="Confirm your new password"
                  required
                />
              </div>

              {/* Error/Success Messages */}
              {passwordError && (
                <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-lg">
                  <p className="text-red-200 text-sm">{passwordError}</p>
                </div>
              )}

              {passwordSuccess && (
                <div className="p-3 bg-green-500/20 border border-green-500/40 rounded-lg">
                  <p className="text-green-200 text-sm">{passwordSuccess}</p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={handlePasswordModalClose}
                  className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 font-semibold"
                >
                  {accountData?.hasPassword
                    ? "Update Password"
                    : "Set Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Username Change Modal */}
      {showUsernameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm">
          <div className="bg-[#252642]/95 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_25px_rgba(0,255,255,0.3)] border border-[#00ffff]/30 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-[#00ffff]">
                Change Username
              </h3>
              <button
                onClick={handleCloseUsernameModal}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg
                  className="w-6 h-6"
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

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  New Username
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter your new username"
                  className="w-full px-4 py-3 bg-[#1a1a2e]/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#00ffff] focus:border-transparent transition-all duration-200"
                  maxLength={32}
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">
                  Username must be 3-32 characters, letters, numbers,
                  underscores, and hyphens only.
                </p>
              </div>

              {/* Error Message */}
              {usernameResetError && (
                <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-lg">
                  <p className="text-red-200 text-sm">{usernameResetError}</p>
                </div>
              )}

              {/* Success Message */}
              {usernameResetSuccess && (
                <div className="p-3 bg-green-500/20 border border-green-500/40 rounded-lg">
                  <p className="text-green-200 text-sm">
                    {usernameResetSuccess}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex space-x-3">
                <button
                  onClick={handleCloseUsernameModal}
                  className="flex-1 px-4 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUsernameSubmit}
                  disabled={usernameResetLoading || !newUsername.trim()}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all duration-200 font-semibold"
                >
                  {usernameResetLoading ? "Updating..." : "Update Username"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Profile Share Modal */}
      {accountData && (
        <ProfileShareModal
          isOpen={showProfileShareModal}
          onClose={() => setShowProfileShareModal(false)}
          username={accountData.username}
        />
      )}

      {/* Avatar Selector Modal */}
      {accountData && (
        <AvatarSelector
          isOpen={showAvatarSelector}
          onClose={() => setShowAvatarSelector(false)}
          username={accountData.username}
          onAvatarChange={(newAvatarUrl) => {
            setAvatarUrl(newAvatarUrl);
          }}
        />
      )}
    </div>
  );
}
