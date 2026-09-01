"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import axios from "../utils/axiosConfig";
import Sidebar from "../components/Sidebar";
import Image from "next/image";
import { Conversation } from "../types";
import ForumList from "../components/ForumList";
import { ForumProvider } from "../context/ForumContext";
import PasswordSetupModal from "../components/PasswordSetupModal";
import EarlyAccessSetupModal from "../components/EarlyAccessSetupModal";
import FeedbackForm from "../components/FeedbackForm";
import MyFeedbackList from "../components/MyFeedbackList";
import AdminFeedbackDashboard from "../components/AdminFeedbackDashboard";
import FeedbackList from "../components/FeedbackList";
import FeedbackDetail from "../components/FeedbackDetail";
// import useSocket from "../hooks/useSocket"; // DISABLED due to 404 errors
import useAchievementPolling from "../hooks/useAchievementPolling";
import useHealthMonitoring from "../hooks/useHealthMonitoring";
import HealthStatusWidget from "../components/HealthStatusWidget";
import HealthTipsWidget from "../components/HealthTipsWidget";
import RecommendationsDisplay from "../components/RecommendationsDisplay";
import SmartGameResume from "../components/SmartGameResume";
import QuickTemplates from "../components/QuickTemplates";
import ShareCardModal from "../components/ShareCardModal";
import DailyChallengeBanner from "../components/DailyChallengeBanner";
import MyGuides from "../components/MyGuides";
import { isLongGuide, extractGuideTitle } from "../utils/guideDetection";
import { trackQuestionAsked } from "../utils/analytics";
import { getSourceName } from "../utils/linkShortener";
// import { useRouter } from "next/navigation";

const STRATEGY_ADVISOR_PROMPT =
  "Analyze this screenshot and give me strategic advice — what's dangerous, what's the opportunity, and what should I do next?";

const HYPE_REACTION_PROMPT =
  "React to this screenshot — hype up the win, commiserate the loss, whatever fits the moment.";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [totalConversations, setTotalConversations] = useState<number>(0);
  const [metrics, setMetrics] = useState<any>({});
  const [recommendations, setRecommendations] = useState<any>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsMessage, setRecommendationsMessage] = useState<
    string | null
  >(null);

  const [activeView, setActiveView] = useState<"chat" | "forum" | "feedback">(
    "chat"
  );

  // Image state variables for question/answer system
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Store image URL for the current response (separate from input image)
  const [responseImageUrl, setResponseImageUrl] = useState<string | null>(null);

  //const router = useRouter();

  const [username, setUsername] = useState<string | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showPasswordSetupModal, setShowPasswordSetupModal] = useState(false);
  const [accountLocked, setAccountLocked] = useState(false);
  const [lockoutMessage, setLockoutMessage] = useState("");
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [requiresUnlock, setRequiresUnlock] = useState(false);
  const [savingGuide, setSavingGuide] = useState(false);
  const [guideSaved, setGuideSaved] = useState(false);
  const [showGuidesModal, setShowGuidesModal] = useState(false);
  const [showEarlyAccessSetupModal, setShowEarlyAccessSetupModal] =
    useState(false);
  const [, setIsEarlyAccessUser] = useState(false); // intentionally unused; only need setter for downstream effects
  const [earlyAccessUserData, setEarlyAccessUserData] = useState<any>(null);

  // Feedback system state
  const [userType, setUserType] = useState<"free" | "pro">("free");
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState<any>(null);
  const [feedbackView, setFeedbackView] = useState<
    "form" | "my-feedback" | "admin-dashboard" | "admin-list"
  >("form");

  // Track break reminder enabled setting
  // Default to false (disabled) until we load settings from database
  // This prevents the widget from showing before we know the user's preference
  const [breakReminderEnabled, setBreakReminderEnabled] =
    useState<boolean>(false);

  // Achievement polling system - replaces Socket.IO for notifications
  const { isPolling, lastChecked } = useAchievementPolling({
    username: username,
    isEnabled: !!username, // Only poll when user is logged in
    pollingInterval: 30000, // Check every 30 seconds
  });

  // Health monitoring system for break reminders
  const {
    healthStatus,
    healthTips,
    dismissHealthTips,
    recordBreak,
    endBreak,
    snoozeReminder,
  } = useHealthMonitoring({
    username: username,
    isEnabled: !!username && breakReminderEnabled, // Only monitor when user is logged in AND break reminders are enabled
    checkInterval: 60000, // Check every minute
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Set mounted state after component mounts
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // function to get conversations
  const fetchConversations = useCallback(async (forceRefresh = false) => {
    if (typeof window === "undefined") return;
    const storedUsername = localStorage.getItem("username");
    if (!storedUsername) return;

    // Add timestamp to bypass cache when forcing refresh (cache is already cleared server-side)
    const cacheBuster = forceRefresh ? `&_t=${Date.now()}` : "";

    const res = await axios.get(
      `/api/getConversation?username=${storedUsername}&page=1&pageSize=20${cacheBuster}`
    );

    // Merge fetched conversations with existing ones to preserve optimistic updates
    setConversations((prev) => {
      const fetched = res.data.conversations;

      // If forcing refresh (after new question), replace all but keep optimistic updates
      if (forceRefresh) {
        // Find any temporary (optimistic) conversations in prev that aren't in fetched
        const tempConversations = prev.filter((conv) =>
          conv._id?.startsWith("temp-")
        );

        // Start with fetched conversations (page 1 from server)
        const merged = [...fetched];

        // Add optimistic conversations that aren't in fetched results yet
        tempConversations.forEach((tempConv) => {
          const existsInFetched = fetched.some(
            (fetchedConv: Conversation) =>
              fetchedConv.question === tempConv.question &&
              Math.abs(
                new Date(fetchedConv.timestamp).getTime() -
                  new Date(tempConv.timestamp).getTime()
              ) < 10000 // Within 10 seconds
          );

          // If temp conversation not in fetched results yet, keep it
          if (!existsInFetched) {
            merged.push(tempConv);
          }
        });

        // Sort by timestamp (most recent first)
        merged.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // Return merged conversations (page 1 from server + any optimistic updates)
        // The reset logic in Sidebar checks non-temp conversations, so it will correctly
        // detect that we're back to page 1 (20 non-temp conversations)
        return merged;
      }

      // Normal fetch - just replace
      return fetched;
    });

    // Use the actual total from pagination, not just the returned array length
    if (res.data.pagination && res.data.pagination.total !== undefined) {
      setTotalConversations(res.data.pagination.total);
    } else {
      // Fallback to array length if pagination info not available
      setTotalConversations(res.data.conversations.length);
    }
  }, []);

  // Check for query parameter to show sign-in modal (runs first, independently)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("showSignIn") === "true") {
      setShowUsernameModal(true);
      // Clean up the URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // Run only once on mount

  useEffect(() => {
    // Only initialize if component is mounted (client-side only)
    if (typeof window === "undefined") return;

    const initializeUser = async () => {
      setLoading(true);
      try {
        // Check for token in URL parameters first (for cross-domain authentication)
        const urlParams = new URLSearchParams(
          typeof window !== "undefined" ? window.location.search : ""
        );
        const token = urlParams.get("token");
        const tokenUserId = urlParams.get("userId");
        const tokenEmail = urlParams.get("email");

        // If token is present, exchange it for session cookies
        if (token) {
          try {
            console.log("Token detected in URL, exchanging for session...");

            // Exchange token for session cookies
            const exchangeRes = await axios.post(
              "/api/auth/exchange-token",
              {
                token,
                userId: tokenUserId || undefined,
                email: tokenEmail || undefined,
              },
              {
                withCredentials: true, // Ensure cookies are sent and received
              }
            );

            if (
              exchangeRes.data &&
              exchangeRes.data.success &&
              exchangeRes.data.user
            ) {
              const userData = exchangeRes.data.user;
              const newUsername = userData.username || tokenUserId || "";

              // Clear any existing session to prevent logging in wrong user
              const oldUsername = localStorage.getItem("username");
              const oldUserId = localStorage.getItem("userId");
              localStorage.removeItem("username");
              localStorage.removeItem("userId");
              localStorage.removeItem("userEmail");

              // Store user data
              console.log(
                "Token exchange successful, setting localStorage for user:",
                {
                  username: newUsername,
                  userId: userData.userId,
                  email: userData.email,
                }
              );

              localStorage.setItem("username", newUsername);
              localStorage.setItem("userId", userData.userId);
              localStorage.setItem("userEmail", userData.email);

              // Record token refresh time for automatic refresh tracking
              // Also reset any invalid refresh token flags
              if (typeof window !== "undefined") {
                // Record login to prevent immediate refresh attempts
                const { recordLogin, clearTokenRefreshRecord } = await import(
                  "../utils/tokenRefresh"
                );
                clearTokenRefreshRecord(); // Clear any invalid flags first
                recordLogin(); // Record login time
              }

              // Dispatch custom events to notify components
              window.dispatchEvent(
                new CustomEvent("localStorageChange", {
                  detail: {
                    key: "username",
                    oldValue: oldUsername,
                    newValue: newUsername,
                  },
                })
              );
              window.dispatchEvent(
                new CustomEvent("localStorageChange", {
                  detail: {
                    key: "userId",
                    oldValue: oldUserId,
                    newValue: userData.userId,
                  },
                })
              );

              setUserId(userData.userId);
              setUsername(newUsername);

              // Clean up URL parameters
              if (typeof window !== "undefined") {
                window.history.replaceState({}, "", window.location.pathname);
              }

              // Proceed with normal flow
              setShowUsernameModal(false);
              fetchConversations();
              setLoading(false);
              return;
            }
          } catch (err: any) {
            console.error("Error exchanging token:", err);

            // If token exchange fails, show error and fall through to normal flow
            if (err.response?.status === 401 || err.response?.status === 403) {
              const errorMessage =
                err.response?.data?.message ||
                "Authentication failed. Please try logging in again.";
              console.error("Token exchange failed:", errorMessage);
              // Don't show alert - let user proceed to normal login flow
            }

            // Clean up URL parameters even on error
            if (typeof window !== "undefined") {
              window.history.replaceState({}, "", window.location.pathname);
            }

            // Fall through to normal flow
          }
        }

        // Robust URL parameter parsing to handle malformed URLs
        const parseEarlyAccessParams = (searchString: string) => {
          const urlParams = new URLSearchParams(searchString);
          let userId = urlParams.get("userId");
          let email = urlParams.get("email");
          let earlyAccess = urlParams.get("earlyAccess");
          let isEarlyAccess = earlyAccess === "true";

          // Debug logging
          console.log("URL Search Params:", searchString);
          console.log("Initial parsed parameters:", {
            userId,
            email,
            earlyAccess,
            isEarlyAccess,
          });

          // Handle malformed URLs where parameters might be incorrectly appended to email
          if (email && email.includes("?")) {
            console.log("Detected malformed email with URL parameters:", email);

            // Extract the actual email (everything before the first ?)
            const actualEmail = email.split("?")[0];
            const malformedPart = email.split("?")[1];

            console.log("Extracted email:", actualEmail);
            console.log("Malformed part:", malformedPart);

            // Check if the malformed part contains earlyAccess=true
            if (malformedPart && malformedPart.includes("earlyAccess=true")) {
              isEarlyAccess = true;
              console.log(
                "Found earlyAccess=true in malformed part, setting isEarlyAccess to true"
              );
            }

            email = actualEmail;
          }

          // Additional cleanup for any remaining malformed parameters
          if (email && email.includes("?earlyAccess=true")) {
            email = email.replace("?earlyAccess=true", "");
            console.log("Cleaned remaining malformed parameters from email");
          }

          console.log("Final parsed parameters:", {
            userId,
            email,
            earlyAccess,
            isEarlyAccess,
          });
          return { userId, email, isEarlyAccess };
        };

        const {
          userId: earlyAccessUserId,
          email: earlyAccessEmail,
          isEarlyAccess,
        } = parseEarlyAccessParams(
          typeof window !== "undefined" ? window.location.search : ""
        );

        if (isEarlyAccess && earlyAccessUserId) {
          // Handle early access user
          // Clear any existing session to prevent logging in wrong user
          const oldUsername = localStorage.getItem("username");
          const oldUserId = localStorage.getItem("userId");
          localStorage.removeItem("username");
          localStorage.removeItem("userId");
          localStorage.removeItem("userEmail");

          // Dispatch custom event to notify components in same tab
          window.dispatchEvent(
            new CustomEvent("localStorageChange", {
              detail: {
                key: "username",
                oldValue: oldUsername,
                newValue: null,
              },
            })
          );
          window.dispatchEvent(
            new CustomEvent("localStorageChange", {
              detail: { key: "userId", oldValue: oldUserId, newValue: null },
            })
          );

          try {
            const res = await axios.post("/api/auth/splash-login", {
              userId: earlyAccessUserId,
              email: earlyAccessEmail,
            });

            if (res.data && res.data.user) {
              const userData = res.data.user;
              const newUsername = userData.username || earlyAccessUserId;

              // Store user data with logging for debugging
              console.log("Splash login: Setting localStorage for user:", {
                username: newUsername,
                userId: userData.userId,
                email: userData.email,
              });

              localStorage.setItem("username", newUsername);
              localStorage.setItem("userId", userData.userId);
              localStorage.setItem("userEmail", userData.email);

              // Dispatch custom events to notify components in same tab
              window.dispatchEvent(
                new CustomEvent("localStorageChange", {
                  detail: {
                    key: "username",
                    oldValue: oldUsername,
                    newValue: newUsername,
                  },
                })
              );
              window.dispatchEvent(
                new CustomEvent("localStorageChange", {
                  detail: {
                    key: "userId",
                    oldValue: oldUserId,
                    newValue: userData.userId,
                  },
                })
              );

              setUserId(userData.userId);
              setUsername(newUsername);

              // Check if user needs setup
              if (
                userData.requiresUsernameSetup ||
                userData.requiresPasswordSetup
              ) {
                setEarlyAccessUserData(userData);
                setShowEarlyAccessSetupModal(true);
                setIsEarlyAccessUser(true);
              } else {
                // User is fully set up, proceed normally
                setShowUsernameModal(false);
                fetchConversations();
              }

              setLoading(false);
              return;
            }
          } catch (err: any) {
            console.error("Error authenticating early access user:", err);

            // Show error message to user if it's an authentication failure
            if (err.response?.status === 403) {
              const errorMessage =
                err.response?.data?.message ||
                "Authentication failed. Please use the correct link for your account.";
              alert(errorMessage);
              // Show username modal for manual sign-in
              setShowUsernameModal(true);
            } else if (err.response?.status === 404) {
              alert(
                "User not found. Please contact support if you believe this is an error."
              );
              setShowUsernameModal(true);
            } else {
              // For other errors, fall through to normal flow
              console.error(
                "Unexpected error during early access authentication:",
                err
              );
            }
            setLoading(false);
            return;
          }
        }

        // Normal user flow
        const storedUsername = localStorage.getItem("username");
        if (storedUsername) {
          // Try to fetch user by username
          try {
            const res = await axios.get(
              `/api/findUserByUsername?username=${storedUsername}`
            );
            if (res.data && res.data.user) {
              // Existing user: sync userId/email from backend
              localStorage.setItem("userId", res.data.user.userId);
              localStorage.setItem("userEmail", res.data.user.email);
              setUserId(res.data.user.userId);
              setUsername(storedUsername);
              setShowUsernameModal(false);
              setLoading(false);
              return;
            } else {
              // Username not found, treat as new user - don't show modal
              setShowUsernameModal(false);
              setLoading(false);
              return;
            }
          } catch (err: any) {
            // If error is 404, user not found, treat as new user - don't show modal
            if (err.response && err.response.status === 404) {
              setShowUsernameModal(false);
              setLoading(false);
              return;
            } else {
              // Other errors
              console.error("Error fetching user by username:", err);
            }
          }
        }
        // No username in localStorage - don't show modal, allow viewing the app
        setShowUsernameModal(false);
      } catch (error) {
        console.error("Error initializing user:", error);
      } finally {
        setLoading(false);
      }
    };

    initializeUser();
  }, [fetchConversations]);

  // Fetch break reminder enabled setting when username changes
  const fetchHealthSettings = useCallback(async () => {
    if (!username) {
      setBreakReminderEnabled(false); // No user = disabled
      return;
    }

    try {
      const response = await axios.post("/api/accountData", {
        username,
      });

      if (response.data?.user?.healthMonitoring) {
        // Use the actual setting from database, default to false if not set
        const breakReminderEnabled =
          response.data.user.healthMonitoring.breakReminderEnabled ?? false;
        setBreakReminderEnabled(breakReminderEnabled);

        // If break reminders are disabled, clear any stored health timer data
        if (!breakReminderEnabled) {
          try {
            const key = `vgw_health_remaining_${username}`;
            localStorage.removeItem(key);
            // console.log(
            //   "Break reminders disabled - cleared localStorage health timer"
            // );
          } catch (e) {
            // Ignore localStorage errors
          }
        }
      } else {
        // No health monitoring settings found - default to disabled (safer)
        setBreakReminderEnabled(false);
      }
    } catch (error) {
      console.error("Error fetching health settings:", error);
      // On error, default to disabled to avoid showing widget when it shouldn't
      setBreakReminderEnabled(false);
    }
  }, [username]);

  useEffect(() => {
    fetchHealthSettings();
  }, [fetchHealthSettings]);

  // Refresh health settings when page becomes visible (user might have changed settings in account page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && username) {
        // Refresh settings when page becomes visible
        fetchHealthSettings();
      }
    };

    const handleFocus = () => {
      if (username) {
        fetchHealthSettings();
      }
    };

    // Listen for custom event when health settings are updated
    const handleHealthSettingsUpdated = () => {
      if (username) {
        fetchHealthSettings();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener(
      "healthSettingsUpdated",
      handleHealthSettingsUpdated
    );

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(
        "healthSettingsUpdated",
        handleHealthSettingsUpdated
      );
    };
  }, [username, fetchHealthSettings]);

  useEffect(() => {
    if (userId) {
      fetchConversations();
    }
  }, [userId, fetchConversations]);

  // Listen for localStorage changes to handle user switching (cross-tab or splash login)
  useEffect(() => {
    const handleStorageChange = async (
      e:
        | StorageEvent
        | CustomEvent<{
            key: string;
            oldValue: string | null;
            newValue: string | null;
          }>
    ) => {
      // Handle both native storage events (cross-tab) and custom events (same-tab)
      const key = "key" in e ? e.key : e.detail?.key;
      const newValue = "newValue" in e ? e.newValue : e.detail?.newValue;
      const oldValue = "oldValue" in e ? e.oldValue : e.detail?.oldValue;

      if (key === "username" && newValue !== oldValue) {
        const newUsername = newValue;
        const currentUsername = username;

        // Only update if the username actually changed
        if (newUsername !== currentUsername) {
          console.log("Username changed in localStorage, updating user:", {
            oldUsername: currentUsername,
            newUsername: newUsername,
          });

          // Clear current state
          setSelectedConversation(null);
          setConversations([]);
          setQuestion("");
          setResponse("");

          if (newUsername) {
            // Fetch new user data
            try {
              const res = await axios.get(
                `/api/findUserByUsername?username=${newUsername}`
              );
              if (res.data && res.data.user) {
                // Update state with new user
                localStorage.setItem("userId", res.data.user.userId);
                localStorage.setItem("userEmail", res.data.user.email);

                // Update state and fetch conversations
                setUserId(res.data.user.userId);
                setUsername(newUsername);

                // Fetch new user's conversations and usage status
                // Clear conversations first to show loading state
                setConversations([]);

                // Fetch will happen automatically via the userId useEffect,
                // but we also call it directly to ensure it happens
                setTimeout(() => {
                  fetchConversations();
                }, 0);
              }
            } catch (err: any) {
              console.error("Error fetching new user data:", err);
              // If user not found, clear state
              if (err.response?.status === 404) {
                setUsername(null);
                setUserId(null);
              }
            }
          } else {
            // Username was removed, clear state
            setUsername(null);
            setUserId(null);
          }
        }
      } else if (key === "userId" && newValue !== oldValue) {
        // If userId changes, update it
        if (newValue) {
          setUserId(newValue);
        } else {
          setUserId(null);
        }
      }
    };

    // Wrapper for native storage events
    const handleNativeStorage = (e: StorageEvent) => {
      handleStorageChange(e);
    };

    // Wrapper for custom events
    const handleCustomStorage = (e: Event) => {
      const customEvent = e as CustomEvent<{
        key: string;
        oldValue: string | null;
        newValue: string | null;
      }>;
      handleStorageChange(customEvent);
    };

    // Listen for storage changes (cross-tab synchronization)
    window.addEventListener("storage", handleNativeStorage);
    // Listen for custom localStorage change events (same-tab synchronization)
    window.addEventListener("localStorageChange", handleCustomStorage);

    return () => {
      window.removeEventListener("storage", handleNativeStorage);
      window.removeEventListener("localStorageChange", handleCustomStorage);
    };
  }, [username, fetchConversations]);

  // Listen for session expiration events and handle token refresh
  useEffect(() => {
    let loginGracePeriodEnd = 0;

    const handleSessionExpired = () => {
      // Don't handle session expired if we just logged in (grace period)
      const now = Date.now();
      if (loginGracePeriodEnd > 0 && now < loginGracePeriodEnd) {
        console.log(
          "[Session] Ignoring session expired event - within login grace period"
        );
        return;
      }

      console.log("[Session] Session expired event received");
      // Clear user data from localStorage
      localStorage.removeItem("username");
      localStorage.removeItem("userId");
      localStorage.removeItem("userEmail");

      // Update state to reflect logged out status
      setUsername(null);
      setUserId(null);
      setConversations([]);
      setSelectedConversation(null);

      // Show message to user
      setError("Your session has expired. Please sign in again.");

      // Redirect to sign-in page after a short delay
      setTimeout(() => {
        window.location.href = "/signin";
      }, 2000);
    };

    const handleTokenRefreshed = () => {
      // Token was refreshed successfully - no action needed
      // The axios interceptor already handled the retry
      console.log("[Session] Token refreshed successfully");
    };

    const handleLocalStorageChange = (e: Event) => {
      const customEvent = e as CustomEvent<{
        key: string;
        oldValue: string | null;
        newValue: string | null;
      }>;
      // If username was just set (login), set grace period
      if (
        customEvent.detail?.key === "username" &&
        customEvent.detail?.newValue
      ) {
        loginGracePeriodEnd = Date.now() + 10000; // 10 second grace period
        console.log("[Session] Login detected, setting grace period");
      }
    };

    // Listen for session expiration events
    window.addEventListener("sessionExpired", handleSessionExpired);
    window.addEventListener("tokenRefreshed", handleTokenRefreshed);
    window.addEventListener("localStorageChange", handleLocalStorageChange);

    return () => {
      window.removeEventListener("sessionExpired", handleSessionExpired);
      window.removeEventListener("tokenRefreshed", handleTokenRefreshed);
      window.removeEventListener(
        "localStorageChange",
        handleLocalStorageChange
      );
    };
  }, []);

  // Periodic token refresh check (every 13 minutes to refresh before 15-minute expiration)
  useEffect(() => {
    if (!username) return; // Only check if user is logged in

    const checkAndRefreshToken = async () => {
      const { ensureTokenValid, recordTokenRefresh } = await import(
        "../utils/tokenRefresh"
      );
      const refreshed = await ensureTokenValid();
      if (refreshed) {
        recordTokenRefresh();
      }
    };

    // Check immediately on mount
    checkAndRefreshToken();

    // Then check every 13 minutes (780000ms) to refresh before 15-minute expiration
    const interval = setInterval(() => {
      checkAndRefreshToken();
    }, 13 * 60 * 1000);

    return () => clearInterval(interval);
  }, [username]);

  // Check user type and admin status
  useEffect(() => {
    const checkUserStatus = async () => {
      if (!username) {
        // Reset user type and admin status when no username
        setUserType("free");
        setIsAdmin(false);
        return;
      }

      try {
        // Lightweight admin check - uses dedicated endpoint that doesn't trigger errors
        const adminCheckResponse = await fetch(
          `/api/feedback/admin/check?username=${encodeURIComponent(username)}`,
          {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          }
        );

        if (adminCheckResponse.ok) {
          const checkResult = await adminCheckResponse.json();
          if (checkResult.isAdmin) {
            setIsAdmin(true);
            // Set default view to admin dashboard for admins
            setFeedbackView("admin-dashboard");
          } else {
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(false);
        }

        // Check user type (pro vs free)
        const usageResponse = await fetch("/api/usageStatus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });

        if (usageResponse.ok) {
          const usageData = await usageResponse.json();
          setUserType(usageData.usageStatus?.isProUser ? "pro" : "free");
        } else {
          // If API call fails, default to free
          setUserType("free");
        }
      } catch (error) {
        console.error("Error checking user status:", error);
        setIsAdmin(false);
        setUserType("free");
      }
    };

    checkUserStatus();
  }, [username]);

  useEffect(() => {
    if (selectedConversation) {
      setQuestion(selectedConversation.question);
      setResponse(selectedConversation.response);
      // Load image URL from conversation if it exists
      if (selectedConversation.imageUrl) {
        setResponseImageUrl(selectedConversation.imageUrl);
      } else {
        setResponseImageUrl(null);
      }
      // Clear input image when loading a conversation
      setImage(null);
      setImageUrl(null);
      // Clear recommendations when loading a conversation (they're specific to each question)
      setRecommendations(null);
      setRecommendationsLoading(false);
      setRecommendationsMessage(null);
      // Reset file input
      const fileInput = document.getElementById(
        "question-image-upload"
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    }
  }, [selectedConversation]);

  // Achievement polling status logging
  useEffect(() => {
    if (username && isPolling) {
      // console.log("✅ Achievement polling active for user:", username); // Commented out for production
    } else if (username && !isPolling) {
      // console.log("⏸️ Achievement polling paused for user:", username); // Commented out for production
    }
  }, [username, isPolling]);

  // Display conversation and forum count in the UI
  const conversationCount = totalConversations || conversations.length;

  // function to handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if user is logged in
    if (!username) {
      setError(
        "Please sign in to ask questions. Click 'Sign In/Up' to get started."
      );
      // Navigate to sign-in page
      window.location.href = "/signin";
      return;
    }

    setLoading(true);
    setError("");
    // Clear previous recommendations when asking a new question
    setRecommendations(null);
    setRecommendationsLoading(false);
    setRecommendationsMessage(null);
    const startTime = performance.now();

    try {
      // console.log("Submitting question:", {
      //   userId,
      //   question,
      //   timestamp: new Date().toISOString(),
      // }); // Commented out for production
      let imageFilePath: string | null = null;
      let imageUrlForAnalysis: string | null = null;

      // Image upload section
      if (image) {
        try {
          const formData = new FormData();
          formData.append("image", image);
          // Add username for violation tracking
          if (username) {
            formData.append("username", username);
          }

          const uploadRes = await axios.post("/api/uploadImage", formData);

          // The new uploadImage API returns both filePath (for local) and url (for cloud)
          imageFilePath = uploadRes.data.filePath || uploadRes.data.url;
          imageUrlForAnalysis = uploadRes.data.url || uploadRes.data.filePath;
        } catch (imageError: any) {
          console.error("Error uploading image:", imageError);

          // Handle image moderation errors
          if (
            imageError.response?.status === 400 ||
            imageError.response?.status === 403
          ) {
            const errorData = imageError.response?.data;

            if (errorData?.isContentViolation || errorData?.violationResult) {
              const violationResult = errorData.violationResult;

              if (violationResult?.action === "banned") {
                setError(
                  errorData.message ||
                    "Your account has been suspended due to content violations."
                );
                setLoading(false);
                return;
              }

              if (violationResult?.action === "permanent_ban") {
                setError(
                  errorData.message ||
                    "Your account has been permanently suspended."
                );
                setLoading(false);
                return;
              }

              // Warning
              const message =
                errorData.message ||
                `Your image contains inappropriate content. Warning (${
                  violationResult?.count || 1
                }/3).`;
              setError(message);
              setLoading(false);
              return;
            } else if (
              errorData?.error === "Image contains inappropriate content"
            ) {
              setError(
                `Image rejected: ${
                  errorData.details ||
                  "The image contains content that violates our community guidelines"
                }`
              );
              setLoading(false);
              return;
            }
          }

          // Other upload errors
          setError(
            imageError.response?.data?.error ||
              imageError.message ||
              "Failed to upload image"
          );
          setLoading(false);
          return;
        }
      }

      let res;
      try {
        res = await axios.post(
          "/api/assistant",
          {
            question,
            imageFilePath: imageFilePath, // For backward compatibility
            imageUrl: imageUrlForAnalysis, // New: cloud storage URL
            // Note: username and userId are now extracted from JWT token in cookies
          },
          {
            timeout: 65000, // Increased timeout to 65 seconds to accommodate vision API calls (60s + buffer)
            headers: {
              "Content-Type": "application/json",
            },
            withCredentials: true, // Ensure cookies are sent
          }
        );
      } catch (error: any) {
        // Handle authentication errors
        // Note: The axios interceptor should have already tried to refresh the token
        // This is a fallback in case the interceptor didn't handle it
        if (error.response?.status === 401) {
          const errorMessage = error.response?.data?.message || "";
          if (
            errorMessage.includes("Authentication required") ||
            errorMessage.includes("sign in") ||
            errorMessage.includes("Token expired")
          ) {
            // Session expired - the interceptor should have handled this
            // But if we're here, it means refresh failed
            setResponse(
              "Your session has expired. Redirecting to sign-in page..."
            );
            setTimeout(() => {
              window.location.href = "/signin";
            }, 1500);
            return;
          }
        }

        // Re-throw other errors
        throw error;
      }

      //const endTime = performance.now();
      // console.log(
      //   `Total frontend latency: ${(endTime - startTime).toFixed(2)}ms`
      // ); // Commented out for production
      // console.log("Response:", res.data); // Commented out for production

      setResponse(res.data.answer);
      if (res.data.metrics) {
        setMetrics(res.data.metrics);
      }

      // Track question asked event for GA4
      trackQuestionAsked(
        question,
        res.data.detectedGame,
        res.data.detectedGenre
      );

      // Optimistically add the new question to conversations immediately when response is received
      // This ensures the question appears in the sidebar right away
      const newConversation: Conversation = {
        _id: `temp-${Date.now()}`, // Temporary ID until we fetch from server
        username: username || "anonymous",
        question: question,
        response: res.data.answer,
        timestamp: new Date(),
        imageUrl: imageUrlForAnalysis || undefined,
      };

      // Add to conversations list immediately (optimistic update) - happens synchronously
      setConversations((prev) => {
        // Check if conversation already exists to avoid duplicates
        const exists = prev.some(
          (conv) =>
            conv.question === question &&
            Math.abs(
              new Date(conv.timestamp).getTime() - new Date().getTime()
            ) < 5000
        );
        if (exists) return prev;
        // Add new conversation at the beginning (most recent first)
        // This will cause the sidebar to update immediately
        return [newConversation, ...prev];
      });

      // Force refresh conversations to sync with server (after a delay to allow DB write)
      // The merge logic in fetchConversations will preserve the optimistic update if needed
      setTimeout(() => {
        fetchConversations(true);
      }, 800); // Increased delay slightly to ensure DB write completes

      // Recommendations are now fetched on-demand via button click

      // Store image URL for response display (use the uploaded URL, not the blob URL)
      // The imageUrlForAnalysis is the actual uploaded image URL from cloud storage
      if (imageUrlForAnalysis) {
        setResponseImageUrl(imageUrlForAnalysis);
      } else if (imageUrl) {
        // Fallback to blob URL if cloud URL not available (shouldn't happen, but just in case)
        setResponseImageUrl(imageUrl);
      }
      // Clear image from input area after submission
      setImage(null);
      setImageUrl(null);
      // Reset file input
      const fileInput = document.getElementById(
        "question-image-upload"
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      if (res.data && res.data.user) {
        setUsername(res.data.user.username);
        setUserId(res.data.user.userId);
        localStorage.setItem("username", res.data.user.username);
        localStorage.setItem("userId", res.data.user.userId);
        localStorage.setItem("userEmail", res.data.user.email);
        setShowUsernameModal(false);
        setConversations([]); // Clear old conversations
        fetchConversations(); // Fetch new user's conversations
      }
    } catch (error: any) {
      console.error("Error details:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      // Handle rate limiting specifically
      if (error.response?.status === 429) {
        const rateLimitData = error.response.data;
        setError(
          `${rateLimitData.message} ${
            rateLimitData.cooldownUntil
              ? `Next question available at ${new Date(
                  rateLimitData.cooldownUntil
                ).toLocaleTimeString()}`
              : ""
          }`
        );
      } else {
        setError(
          error.response?.data?.message ||
            "There was an error processing your request. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // Image handler
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      // Validate file type
      if (!file.type.startsWith("image/")) {
        setError(`${file.name} is not a valid image file`);
        return;
      }

      // Validate file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} exceeds 10MB size limit`);
        return;
      }

      setImage(file);
      setImageUrl(URL.createObjectURL(file));
      setError(""); // Clear any previous errors
    }
  };

  // function to clear the form
  const handleClear = () => {
    setQuestion("");
    setResponse("");
    setError("");
    setSelectedConversation(null);
    setImage(null);
    setImageUrl(null);
    setResponseImageUrl(null); // Clear response image too
    // Reset file input
    const fileInput = document.getElementById(
      "question-image-upload"
    ) as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  // delete conversation from database
  const handleDeleteConversation = async (id: string) => {
    try {
      const storedUsername = localStorage.getItem("username");
      // Optimistically remove from UI immediately
      setConversations((prev) => prev.filter((conv) => conv._id !== id));

      await axios.post("/api/deleteInteraction", {
        id,
        username: storedUsername,
      });

      // Refresh conversations to ensure sync with database
      fetchConversations();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      // If deletion failed, refresh to restore the conversation
      fetchConversations();
    }
  };

  // handle twitch authentication (for linking viewer accounts)
  const handleTwitchAuth = () => {
    // Get username from localStorage
    const username = localStorage.getItem("username");

    // Use the new dedicated viewer OAuth flow
    const loginUrl = username
      ? `/api/twitchViewerLogin?username=${encodeURIComponent(username)}`
      : "/api/twitchViewerLogin";

    window.location.href = loginUrl;
  };

  const handleSteamAuth = () => {
    window.location.href = '/api/steamLogin';
  };

  // Capture pending Steam ID from URL params on mount and clean the URL immediately.
  // The actual API call is deferred until username is confirmed (see effect below).
  const [pendingSteamId, setPendingSteamId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const steamLinked = params.get('steamLinked');
    const steamId = params.get('steamId');

    if (steamLinked === 'true' && steamId && /^\d+$/.test(steamId)) {
      setPendingSteamId(steamId);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Once username is confirmed (auth ready), link the pending Steam ID.
  // Use axios so the request interceptor can refresh an expired access token first.
  useEffect(() => {
    if (!pendingSteamId || !username) return;

    axios.post('/api/linkSteamId', { steamId: pendingSteamId })
      .then(({ data }) => {
        if (data.success) {
          console.log('Steam account linked successfully:', pendingSteamId);
        } else {
          console.error('Failed to link Steam account:', data.error);
        }
      })
      .catch((err) => console.error('Error linking Steam account:', err))
      .finally(() => setPendingSteamId(null));
  }, [pendingSteamId, username]);

  const handleDiscordAuth = async () => {
    try {
      // Get the current logged-in username from localStorage
      const currentUsername = localStorage.getItem("username");

      if (!currentUsername) {
        setError(
          "Please log in to Video Game Wingman before connecting Discord."
        );
        return;
      }

      // Get the current domain based on environment
      const domain =
        process.env.NODE_ENV === "production"
          ? "https://assistant.videogamewingman.com"
          : "http://localhost:3000";

      // Construct the Discord login URL with username parameter
      // This ensures the correct Video Game Wingman account is linked to the Discord account
      const discordLoginUrl = `${domain}/api/discordLogin?username=${encodeURIComponent(
        currentUsername
      )}`;

      // Open Discord login in new tab instead of current window
      window.open(discordLoginUrl, "_blank");
    } catch (error) {
      console.error("Error during Discord authentication:", error); // Already commented out
      setError("Failed to authenticate with Discord");
    }
  };

  // Shorten URL for inline display (e.g., "youtube.com/watch?v=abc123...")
  const shortenUrl = (url: string, maxLength: number = 40): string => {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/^www\./, "");
      const pathname = urlObj.pathname;
      const search = urlObj.search;

      // Combine hostname + pathname + search params
      let fullPath = hostname + pathname + search;

      // If it's too long, truncate and add ellipsis
      if (fullPath.length > maxLength) {
        return fullPath.substring(0, maxLength - 3) + "...";
      }

      return fullPath;
    } catch {
      // If URL parsing fails, just truncate the original URL
      return url.length > maxLength
        ? url.substring(0, maxLength - 3) + "..."
        : url;
    }
  };

  // Parse markdown links and plain URLs, then extract sources
  const parseResponseWithSources = (
    response: string
  ): {
    formattedText: string;
    sources: Array<{ name: string; url: string }>;
    linkMap: Map<string, { url: string; shortened: string }>;
  } => {
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    // Match plain URLs: http://, https://, or www. at start, or domain.com patterns
    // This regex matches URLs that aren't already in markdown format
    // Updated to handle URLs with query parameters, fragments, and trailing punctuation
    const plainUrlRegex =
      /(https?:\/\/[^\s\)\]\>]+|www\.[^\s\)\]\>]+|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s\)\]\>]*)?)/g;
    const sourcesMap = new Map<string, { name: string; url: string }>();
    const urlToSourceName = new Map<string, string>();
    const linkMap = new Map<string, { url: string; shortened: string }>();
    const processedUrls = new Set<string>();

    // First pass: find all markdown links and extract sources
    let match;
    const markdownMatches: Array<{
      fullMatch: string;
      url: string;
      linkText: string;
    }> = [];
    while ((match = markdownLinkRegex.exec(response)) !== null) {
      const [fullMatch, linkText, url] = match;
      // Normalize URL (add https:// if missing)
      const normalizedUrl =
        url.startsWith("http://") || url.startsWith("https://")
          ? url
          : `https://${url}`;
      markdownMatches.push({ fullMatch, url: normalizedUrl, linkText });
      processedUrls.add(normalizedUrl);

      // Store unique sources and their display names
      if (!sourcesMap.has(normalizedUrl)) {
        const sourceName = getSourceName(normalizedUrl);
        sourcesMap.set(normalizedUrl, { name: sourceName, url: normalizedUrl });
        urlToSourceName.set(normalizedUrl, sourceName);
      }
    }

    // Second pass: find plain URLs (not already in markdown format)
    const plainUrlMatches: Array<{ fullMatch: string; url: string }> = [];
    // Reset regex
    plainUrlRegex.lastIndex = 0;
    while ((match = plainUrlRegex.exec(response)) !== null) {
      let fullMatch = match[0];

      // Trim trailing punctuation that shouldn't be part of the URL
      // But keep punctuation that's part of URLs (like ?query=value&param=value)
      const trailingPunctuation = /([.,;:!?])+$/;
      const punctuationMatch = fullMatch.match(trailingPunctuation);
      if (punctuationMatch && !fullMatch.includes("?")) {
        // Only trim if it's not a query string URL
        fullMatch = fullMatch.replace(trailingPunctuation, "");
      }

      let url = fullMatch;

      // Normalize URL (add https:// if missing)
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }

      // Skip if this URL was already processed as a markdown link
      if (processedUrls.has(url)) {
        continue;
      }

      // Skip if this is part of a markdown link (already processed)
      let isPartOfMarkdown = false;
      for (const markdownMatch of markdownMatches) {
        if (
          markdownMatch.fullMatch.includes(fullMatch) ||
          markdownMatch.url === url
        ) {
          isPartOfMarkdown = true;
          break;
        }
      }
      if (isPartOfMarkdown) {
        continue;
      }

      // Use the original fullMatch from the response for replacement
      const originalMatch = match[0];
      plainUrlMatches.push({ fullMatch: originalMatch, url });
      processedUrls.add(url);
      processedUrls.add(originalMatch);

      // Store unique sources and their display names
      if (!sourcesMap.has(url)) {
        const sourceName = getSourceName(url);
        sourcesMap.set(url, { name: sourceName, url });
        urlToSourceName.set(url, sourceName);
      }
    }

    // Third pass: replace all markdown links with shortened URL (inline format)
    let formattedText = response;
    markdownMatches.forEach(({ fullMatch, url }) => {
      const shortened = shortenUrl(url);

      // Create a placeholder with just the shortened URL in parentheses
      // Format: (shortened-url) where shortened-url will be clickable
      // This matches the screenshot style: ([domain.com](url))
      const placeholder = `(${shortened})`;

      // Store the mapping for later rendering
      linkMap.set(placeholder, { url, shortened });

      // Escape special regex characters in the full match
      const escapedMatch = fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      formattedText = formattedText.replace(
        new RegExp(escapedMatch, "g"),
        placeholder
      );
    });

    // Fourth pass: replace plain URLs with shortened URL (inline format)
    // Process in reverse order to maintain correct indices when replacing
    plainUrlMatches.reverse().forEach(({ fullMatch, url }) => {
      const shortened = shortenUrl(url);
      const placeholder = `(${shortened})`;

      // Store the mapping for later rendering
      linkMap.set(placeholder, { url, shortened });

      // Escape special regex characters in the full match for regex replacement
      const escapedMatch = fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Replace the URL in the formatted text
      // Use a simple global replace - the escaped match should be unique enough
      formattedText = formattedText.replace(
        new RegExp(escapedMatch, "g"),
        placeholder
      );
    });

    // Third pass: Move links that appear after colons with whitespace/newlines to be inline
    // Pattern: colon + whitespace/newlines + link placeholder -> colon + space + link placeholder
    // This removes empty space after colons by moving links to the same line
    const placeholders = Array.from(linkMap.keys());
    placeholders.forEach((placeholder) => {
      const escapedPlaceholder = placeholder.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      // Match colon followed by any whitespace (including newlines) and then our placeholder
      // This handles cases like "video:\n(link)" or "video:  (link)" -> "video: (link)"
      // \s+ matches any whitespace including spaces, tabs, and newlines
      const colonPattern = new RegExp(`(:\\s+)(${escapedPlaceholder})`, "g");
      formattedText = formattedText.replace(colonPattern, `: $2`);
    });

    // Convert map to array
    const sources = Array.from(sourcesMap.values());

    return { formattedText, sources, linkMap };
  };

  // Parse text and convert source placeholders to clickable links
  const parseInlineLinks = (
    text: string,
    linkMap: Map<string, { url: string; shortened: string }>
  ): React.ReactNode[] => {
    // If linkMap is empty, just return the text as-is
    if (linkMap.size === 0) {
      return [text];
    }

    // Build a regex pattern from all placeholders in linkMap
    // Escape special regex characters in each placeholder
    const placeholderPatterns = Array.from(linkMap.keys())
      .map((placeholder) => placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");

    if (!placeholderPatterns) {
      return [text];
    }

    const placeholderRegex = new RegExp(`(${placeholderPatterns})`, "g");
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = placeholderRegex.exec(text)) !== null) {
      const fullMatch = match[0];
      const matchStart = match.index;
      const matchEnd = matchStart + fullMatch.length;

      // Add text before the match
      if (matchStart > lastIndex) {
        const beforeText = text.substring(lastIndex, matchStart);
        if (beforeText) {
          parts.push(beforeText);
        }
      }

      // Get link info from linkMap
      const linkInfo = linkMap.get(fullMatch);
      if (linkInfo) {
        // Render as: (clickable-shortened-url) - compact format like screenshot
        parts.push(
          <span key={`link-${matchStart}`}>
            (
            <a
              href={linkInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
            >
              {linkInfo.shortened}
            </a>
            )
          </span>
        );
      } else {
        // Shouldn't happen, but fallback to plain text
        parts.push(fullMatch);
      }

      lastIndex = matchEnd;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex);
      if (remainingText) {
        parts.push(remainingText);
      }
    }

    // If no matches found, return the original text
    return parts.length > 0 ? parts : [text];
  };

  // format assistant's response
  const formatResponse = (response: string) => {
    const { formattedText, sources, linkMap } =
      parseResponseWithSources(response);
    const lines = formattedText.split("\n");

    // Parse inline bold markers (**text**) and links within a line
    const parseLine = (text: string, keyPrefix: string): React.ReactNode => {
      const segments = text.split(/(\*\*[^*]+\*\*)/g);
      if (segments.length === 1) {
        return <>{parseInlineLinks(text, linkMap)}</>;
      }
      return (
        <>
          {segments.map((segment, i) => {
            if (segment.startsWith("**") && segment.endsWith("**") && segment.length > 4) {
              return (
                <strong key={`${keyPrefix}-b${i}`}>
                  {parseInlineLinks(segment.slice(2, -2), linkMap)}
                </strong>
              );
            }
            return (
              <Fragment key={`${keyPrefix}-s${i}`}>
                {parseInlineLinks(segment, linkMap)}
              </Fragment>
            );
          })}
        </>
      );
    };

    const elements: React.ReactNode[] = [];
    let bulletItems: React.ReactNode[] = [];
    let stepCounter = 1;

    const flushBullets = (key: string) => {
      if (bulletItems.length > 0) {
        elements.push(
          <ul key={key} className="list-disc pl-5 mt-2 space-y-1">
            {bulletItems}
          </ul>
        );
        bulletItems = [];
      }
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (!trimmed) {
        flushBullets(`ul-${index}`);
        return;
      }

      // ## Section heading
      if (trimmed.startsWith("## ")) {
        flushBullets(`ul-${index}`);
        elements.push(
          <h3 key={`h3-${index}`} className="text-base font-bold mt-5 mb-1 pb-1 border-b border-gray-300 dark:border-gray-600">
            {parseLine(trimmed.slice(3).trim(), `h3-${index}`)}
          </h3>
        );
        return;
      }

      // ### Sub-heading
      if (trimmed.startsWith("### ")) {
        flushBullets(`ul-${index}`);
        elements.push(
          <h4 key={`h4-${index}`} className="text-sm font-semibold mt-3 mb-1 text-gray-700 dark:text-gray-300">
            {parseLine(trimmed.slice(4).trim(), `h4-${index}`)}
          </h4>
        );
        return;
      }

      // Numbered list item
      if (trimmed.match(/^\d+\.\s/)) {
        flushBullets(`ul-${index}`);
        const stepNumber = stepCounter++;
        const stepContent = trimmed.replace(/^\d+\.\s/, "").trim();
        elements.push(
          <p key={`step-${index}-${stepNumber}`} className="mt-2">
            <strong>{stepNumber}. </strong>
            {parseLine(stepContent, `step-${index}`)}
          </p>
        );
        return;
      }

      // Bullet point (- or *)
      if (trimmed.match(/^[-*]\s/)) {
        const content = trimmed.replace(/^[-*]\s/, "").trim();
        bulletItems.push(
          <li key={`li-${index}`}>{parseLine(content, `li-${index}`)}</li>
        );
        return;
      }

      // Line that is only a bold phrase — treat as a section header
      // e.g. "**Phase One:**" or "**Recommended Loadout:**"
      const onlyBold = trimmed.match(/^\*\*([^*]+)\*\*:?\s*$/);
      if (onlyBold) {
        flushBullets(`ul-${index}`);
        const headerText = onlyBold[1].replace(/:$/, "");
        elements.push(
          <p key={`bh-${index}`} className="mt-4 mb-1 font-bold text-gray-900 dark:text-gray-100">
            {headerText}:
          </p>
        );
        return;
      }

      // Regular paragraph
      flushBullets(`ul-${index}`);
      elements.push(
        <p key={`p-${index}`} className="mt-2">
          {parseLine(trimmed, `p-${index}`)}
        </p>
      );
    });

    flushBullets(`ul-end`);
    return { content: elements, sources };
  };

  // Component to render formatted response with sources
  const FormattedResponse = ({ response }: { response: string }) => {
    const formatted = formatResponse(response);
    return (
      <>
        <div>{formatted.content}</div>
        {formatted.sources && formatted.sources.length > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-300 dark:border-gray-600">
            <p className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">
              Sources:
            </p>
            <div className="flex flex-wrap gap-2">
              {formatted.sources.map((source, index) => (
                <a
                  key={index}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                >
                  {source.name}
                </a>
              ))}
            </div>
          </div>
        )}
      </>
    );
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError("");
    if (!usernameInput.trim()) {
      setUsernameError("Username or email is required");
      return;
    }

    // Check if input is an email address
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usernameInput.trim());

    // Basic validation before API call
    if (isEmail) {
      // Email validation
      if (usernameInput.trim().length < 5) {
        setUsernameError("Please enter a valid email address.");
        return;
      }
      if (usernameInput.trim().length > 254) {
        setUsernameError("Email address is too long.");
        return;
      }
    } else {
      // Username validation
      if (usernameInput.trim().length < 3) {
        setUsernameError("Username must be at least 3 characters long.");
        return;
      }

      if (usernameInput.trim().length > 32) {
        setUsernameError("Username must be 32 characters or less.");
        return;
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(usernameInput.trim())) {
        setUsernameError(
          "Username can only contain letters, numbers, underscores, and hyphens."
        );
        return;
      }
    }

    try {
      setIsSigningIn(true);
      // Use new authentication system
      const res = await axios.post(
        "/api/auth/signin",
        {
          identifier: usernameInput.trim(),
          password: passwordInput,
        },
        {
          withCredentials: true, // Ensure cookies are sent and received
        }
      );

      if (res.data && res.data.user) {
        // Get old values before updating
        const oldUsername = localStorage.getItem("username");
        const oldUserId = localStorage.getItem("userId");

        // Update localStorage
        localStorage.setItem("username", res.data.user.username);
        localStorage.setItem("userId", res.data.user.userId);
        localStorage.setItem("userEmail", res.data.user.email);

        // Dispatch custom events to notify Sidebar and other components
        window.dispatchEvent(
          new CustomEvent("localStorageChange", {
            detail: {
              key: "username",
              oldValue: oldUsername,
              newValue: res.data.user.username,
            },
          })
        );
        window.dispatchEvent(
          new CustomEvent("localStorageChange", {
            detail: {
              key: "userId",
              oldValue: oldUserId,
              newValue: res.data.user.userId,
            },
          })
        );

        // Update state
        setUsername(res.data.user.username);
        setUserId(res.data.user.userId);
        setShowUsernameModal(false);
        setConversations([]); // Clear old conversations
        fetchConversations(); // Fetch new user's conversations

        // Check if user needs to set up password (legacy user)
        if (res.data.requiresPasswordSetup && res.data.isLegacyUser) {
          setShowPasswordSetupModal(true);
        }
      }
    } catch (err: any) {
      // Check if account is locked
      if (err.response?.status === 403 && err.response?.data?.accountLocked) {
        setAccountLocked(true);
        setLockoutMessage(
          err.response.data.message ||
            "Account is locked. Please check your email for unlock instructions."
        );
        setRequiresUnlock(err.response.data.requiresUnlock || false);
        if (err.response.data.lockedUntil) {
          setLockedUntil(new Date(err.response.data.lockedUntil));
        }
        setUsernameError(""); // Clear regular error, show lockout message instead
      } else {
        // Regular error (not account locked)
        setAccountLocked(false);
        if (err.response?.data?.message) {
          setUsernameError(err.response.data.message);
        } else {
          setUsernameError("Failed to sign in. Please try again.");
        }
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handlePasswordSetup = async (password: string) => {
    const userId = localStorage.getItem("userId");
    const username = localStorage.getItem("username");

    if (!userId || !username) {
      throw new Error("User information not found");
    }

    const res = await axios.post("/api/auth/setup-password", {
      userId,
      username,
      newPassword: password,
    });

    if (res.data && res.data.user) {
      // Update local storage with updated user data
      localStorage.setItem("userId", res.data.user.userId);
      localStorage.setItem("userEmail", res.data.user.email);
    }
  };

  const handleEarlyAccessSetup = async (
    username: string,
    password?: string
  ) => {
    const userId = localStorage.getItem("userId");

    if (!userId) {
      throw new Error("User information not found");
    }

    const res = await axios.post("/api/auth/setup-early-access", {
      userId,
      username,
      password,
    });

    if (res.data && res.data.user) {
      // Update local storage with updated user data
      localStorage.setItem("username", res.data.user.username);
      localStorage.setItem("userId", res.data.user.userId);
      localStorage.setItem("userEmail", res.data.user.email);

      // Update state
      setUsername(res.data.user.username);
      setUserId(res.data.user.userId);

      // Fetch conversations for the newly set up user
      fetchConversations();
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);

    // Get old values before clearing
    const oldUsername = localStorage.getItem("username");
    const oldUserId = localStorage.getItem("userId");

    try {
      // Call logout API to blacklist tokens with timeout
      // This ensures tokens are invalidated on the server
      // Use Promise.race to add a 5-second timeout to prevent infinite hanging
      const logoutPromise = axios.post(
        "/api/auth/logout",
        {},
        {
          withCredentials: true, // Ensure cookies are sent
        }
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Logout request timed out")), 5000)
      );

      await Promise.race([logoutPromise, timeoutPromise]);
    } catch (error) {
      // Log error but continue with logout process
      // Even if API call fails or times out, we still want to clear local state
      console.error("Error calling logout API:", error);
    } finally {
      // Always clear state and reset loading, even if API call fails or hangs
      // Clear state immediately for better UX
      setUsername(null);
      setUserId(null);
      setQuestion("");
      setResponse("");
      setSelectedConversation(null);
      setError("");
      setPasswordInput("");
      setShowPasswordSetupModal(false);
      setShowEarlyAccessSetupModal(false);
      setIsEarlyAccessUser(false);
      setEarlyAccessUserData(null);
      setUserType("free"); // Reset user type on sign out
      setIsAdmin(false); // Reset admin status on sign out

      // Clear localStorage
      localStorage.removeItem("username");
      localStorage.removeItem("userId");
      localStorage.removeItem("userEmail");

      // Dispatch custom events to notify Sidebar and other components
      window.dispatchEvent(
        new CustomEvent("localStorageChange", {
          detail: {
            key: "username",
            oldValue: oldUsername,
            newValue: null,
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("localStorageChange", {
          detail: {
            key: "userId",
            oldValue: oldUserId,
            newValue: null,
          },
        })
      );

      setShowUsernameModal(false); // Don't show modal, allow viewing the app

      // Always reset signing out state
      setIsSigningOut(false);
    }
  };

  const handleNavigateToAccount = () => {
    window.location.href = "/account";
  };

  // Handle saving a guide
  const handleSaveGuide = async () => {
    if (!username) {
      setError("Please sign in to save guides");
      return;
    }

    const currentResponse = response || selectedConversation?.response || "";
    const currentQuestion = question || selectedConversation?.question || "";

    if (!currentResponse || !currentQuestion) {
      setError("No guide to save");
      return;
    }

    try {
      setSavingGuide(true);
      setGuideSaved(false);
      setError("");

      const guideTitle = extractGuideTitle(currentQuestion);

      const res = await axios.post("/api/guides/save", {
        username,
        question: currentQuestion,
        response: currentResponse,
        title: guideTitle,
        imageUrl:
          responseImageUrl || selectedConversation?.imageUrl || undefined,
      });

      if (res.data.success) {
        setGuideSaved(true);
        // Reset the saved state after 3 seconds
        setTimeout(() => {
          setGuideSaved(false);
        }, 3000);
      }
    } catch (error: any) {
      console.error("Error saving guide:", error);
      if (error.response?.data?.message) {
        setError(error.response.data.message);
      } else {
        setError("Failed to save guide. Please try again.");
      }
    } finally {
      setSavingGuide(false);
    }
  };

  // Used for debugging
  // if (typeof window !== "undefined") {
  //   console.log("Current username:", localStorage.getItem("username")); // Already commented out
  // }

  // Prevent hydration mismatch by not rendering until mounted
  if (!isMounted) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sign In Modal */}
      {showUsernameModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60"
          onClick={() => {
            setShowUsernameModal(false);
            setAccountLocked(false);
            setLockoutMessage("");
            setLockedUntil(null);
            setRequiresUnlock(false);
          }}
        >
          <div
            className="bg-white dark:bg-gray-900 p-8 rounded-lg shadow-lg w-full max-w-md flex flex-col items-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => {
                setShowUsernameModal(false);
                setAccountLocked(false);
                setLockoutMessage("");
                setLockedUntil(null);
                setRequiresUnlock(false);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Close sign in modal"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <Image
              src="/assets/video-game-wingman-logo.png"
              alt="Video Game Wingman Logo"
              width={180}
              height={180}
              className="mb-6"
              priority
            />
            <h2 className="text-2xl font-bold mb-4 text-center">Sign In</h2>
            <form
              onSubmit={handleUsernameSubmit}
              className="space-y-4 w-full mt-2"
              noValidate
            >
              <div>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="Username or email"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  minLength={3}
                  maxLength={320}
                  required
                  autoFocus
                />
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Password (optional for legacy users)"
                  className="w-full p-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  {showPassword ? (
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                      />
                    </svg>
                  )}
                </button>
              </div>
              {/* Account Lockout Message */}
              {accountLocked && (
                <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-700 rounded-lg mb-3">
                  <div className="flex items-start">
                    <svg
                      className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2 mt-0.5 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-yellow-800 dark:text-yellow-200 text-sm font-medium mb-1">
                        Account Locked
                      </p>
                      <p className="text-yellow-700 dark:text-yellow-300 text-xs mb-1">
                        {lockoutMessage}
                      </p>
                      {lockedUntil && !requiresUnlock && (
                        <p className="text-yellow-600 dark:text-yellow-400 text-xs">
                          Try again in{" "}
                          {Math.ceil(
                            (lockedUntil.getTime() - Date.now()) / (60 * 1000)
                          )}{" "}
                          minute(s).
                        </p>
                      )}
                      {requiresUnlock && (
                        <p className="text-yellow-600 dark:text-yellow-400 text-xs mt-1">
                          Check your email for unlock instructions.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Regular Error Message */}
              {usernameError && !accountLocked && (
                <p className="text-red-500 text-sm">{usernameError}</p>
              )}
              <button
                type="submit"
                disabled={isSigningIn}
                className="w-full p-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSigningIn ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Signing In...
                  </div>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>

            {/* Forgot Password Link */}
            <div className="mt-4 text-center">
              <button
                onClick={() => (window.location.href = "/forgot-password")}
                className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 text-sm"
              >
                Forgot Password?
              </button>
            </div>

            {/* Sign Up Link */}
            <div className="mt-4 text-center">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => (window.location.href = "/signup")}
                  className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 font-medium"
                >
                  Sign Up
                </button>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Password Setup Modal for Legacy Users */}
      <PasswordSetupModal
        isOpen={showPasswordSetupModal}
        onClose={() => setShowPasswordSetupModal(false)}
        onSetup={handlePasswordSetup}
        username={username || ""}
        userId={userId || ""}
      />

      {/* Early Access Setup Modal */}
      <EarlyAccessSetupModal
        isOpen={showEarlyAccessSetupModal}
        onClose={() => setShowEarlyAccessSetupModal(false)}
        onSetup={handleEarlyAccessSetup}
        userEmail={earlyAccessUserData?.email || ""}
        userId={earlyAccessUserData?.userId || ""}
      />

      {/* Share Card Modal */}
      <ShareCardModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        conversation={
          selectedConversation ||
          (response
            ? ({
                _id: "",
                username: username || "anonymous",
                question: question,
                response: response,
                timestamp: new Date(),
                imageUrl: responseImageUrl || undefined,
              } as Conversation)
            : null)
        }
        detectedGame={(selectedConversation as any)?.detectedGame || undefined}
      />

      {/* My Guides Modal */}
      <MyGuides
        username={username}
        isOpen={showGuidesModal}
        onClose={() => setShowGuidesModal(false)}
      />
      {/* Main App Content - always visible, even for non-logged-in users */}
      <>
        {/* Hamburger menu for mobile */}
        <button
          className="hamburger"
          aria-label="Open sidebar menu"
          onClick={() => setSidebarOpen(true)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="4"
              y="6"
              width="16"
              height="2.5"
              rx="1.25"
              fill="currentColor"
            />
            <rect
              x="4"
              y="11"
              width="16"
              height="2.5"
              rx="1.25"
              fill="currentColor"
            />
            <rect
              x="4"
              y="16"
              width="16"
              height="2.5"
              rx="1.25"
              fill="currentColor"
            />
          </svg>
          <span className="hamburger-label">Menu</span>
        </button>
        {/* Show hamburger only on mobile via CSS */}
        <style>{`
            @media (max-width: 767px) {
              .hamburger { display: flex !important; }
            }
          `}</style>

        {/* Sidebar Drawer and Backdrop for mobile */}
        {sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          ></div>
        )}
        <Sidebar
          key={username || "no-user"} // Force re-render when username changes
          conversations={conversations}
          onSelectConversation={(convo) => {
            setSelectedConversation(convo);
            setSidebarOpen(false); // Close sidebar on mobile after selecting
          }}
          onDeleteConversation={handleDeleteConversation}
          onClear={handleClear}
          onTwitchAuth={handleTwitchAuth}
          onDiscordAuth={handleDiscordAuth}
          onSteamAuth={handleSteamAuth}
          onNavigateToAccount={handleNavigateToAccount}
          onOpenGuides={() => setShowGuidesModal(true)}
          activeView={activeView}
          setActiveView={setActiveView}
          conversationCount={conversationCount}
          onLoadMore={(newConversations) => {
            setConversations((prev) => {
              // Create a Set of existing conversation IDs (using question + timestamp as unique key)
              const existingKeys = new Set(
                prev.map((conv) => `${conv.question}-${conv.timestamp}`)
              );
              // Filter out duplicates from new conversations
              const uniqueNew = newConversations.filter(
                (conv) =>
                  !existingKeys.has(`${conv.question}-${conv.timestamp}`)
              );
              return [...prev, ...uniqueNew];
            });
          }}
          className={sidebarOpen ? "sidebar open" : "sidebar"}
        />
        <div className="main-content flex-1">
          <div className="flex-1 flex flex-col items-center justify-center py-2">
            <Image
              src="/assets/video-game-wingman-logo.png"
              alt="Video Game Wingman Logo"
              className="logo"
              width={350}
              height={350}
              priority={true}
            />

            {/* Daily Challenge Banner - only show for logged-in users */}
            {username && (
              <DailyChallengeBanner
                username={username}
                conversations={conversations}
              />
            )}

            {/* Display conversation count in the UI - only for logged-in users */}
            {username && conversationCount > 0 && (
              <p className="text-sm text-white font-medium mt-2 bg-gray-800 px-3 py-2 rounded-lg border border-gray-700">
                {conversationCount} total conversation
                {conversationCount !== 1 ? "s" : ""}
                {conversations.length < conversationCount && (
                  <span className="text-gray-400 text-xs block mt-1">
                    ({conversations.length} shown,{" "}
                    {conversationCount - conversations.length} more available)
                  </span>
                )}
              </p>
            )}

            <ul className="mt-4 text-lg text-center">
              <li>Discover a game&apos;s hidden secrets.</li>
              <li>Get personalized game recommendations.</li>
              <li>Analyze gameplay data to improve your strategies.</li>
              <li>Access detailed game guides.</li>
              <li>
                Info about game sales, console bundles, and technical specs.
              </li>
            </ul>

            {activeView === "chat" && (
              <>
                {/* Smart Game Resume - Shows on login */}
                {username && (
                  <SmartGameResume
                    username={username}
                    onAskQuestion={(question) => {
                      setQuestion(question);
                      // Focus the input field so user can edit or submit
                      setTimeout(() => {
                        const input = document.querySelector(
                          'input[type="text"]'
                        ) as HTMLInputElement;
                        if (input) {
                          input.focus();
                          input.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }
                      }, 100);
                    }}
                  />
                )}

                {/* Health Status Widget - only show for logged-in users */}
                {username && (
                  <HealthStatusWidget
                    healthStatus={healthStatus}
                    onRecordBreak={recordBreak}
                    onEndBreak={endBreak}
                    onSnoozeReminder={snoozeReminder}
                  />
                )}

                {/* Health Tips Widget - only show for logged-in users */}
                {username && (
                  <HealthTipsWidget
                    tips={healthTips}
                    onDismiss={dismissHealthTips}
                  />
                )}

                {/* Quick Question Templates */}
                <QuickTemplates
                  username={username}
                  onSelectTemplate={(question) => {
                    setQuestion(question);
                    // Focus the input field so user can edit or submit
                    setTimeout(() => {
                      const input = document.querySelector(
                        'input[type="text"]'
                      ) as HTMLInputElement;
                      if (input) {
                        input.focus();
                        input.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }
                    }, 100);
                  }}
                />

                <form onSubmit={handleSubmit} className="w-full max-w-md mt-2" noValidate>
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={
                      username
                        ? "Message Video Game Wingman"
                        : "Sign in to ask questions"
                    }
                    className="w-full p-2 border border-gray-300 rounded mb-4"
                    disabled={!username}
                  />

                  {/* Image upload UI section */}
                  <div className="mb-4">
                    <div className="flex flex-col gap-3">
                      <label
                        className={`inline-flex items-center px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded transition-colors w-fit ${
                          username
                            ? "cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600"
                            : "opacity-50 cursor-not-allowed"
                        }`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                          />
                        </svg>
                        <span>Attach Screenshot</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          className="hidden"
                          id="question-image-upload"
                          disabled={!username}
                        />
                      </label>
                      {imageUrl && (
                        <>
                          <div className="relative inline-block">
                            <Image
                              src={imageUrl}
                              alt="Selected screenshot"
                              width={200}
                              height={200}
                              className="rounded border border-gray-300 dark:border-gray-600"
                              unoptimized={
                                imageUrl.startsWith("http") ||
                                imageUrl.startsWith("//") ||
                                imageUrl.startsWith("blob:")
                              }
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setImage(null);
                                setImageUrl(null);
                                // Reset file input
                                const fileInput = document.getElementById(
                                  "question-image-upload"
                                ) as HTMLInputElement;
                                if (fileInput) fileInput.value = "";
                              }}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-75 hover:opacity-100 transition-opacity"
                              aria-label="Remove image"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
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
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setQuestion(STRATEGY_ADVISOR_PROMPT);
                                setTimeout(() => {
                                  const input = document.querySelector(
                                    'input[type="text"]'
                                  ) as HTMLInputElement;
                                  if (input) {
                                    input.focus();
                                    input.scrollIntoView({
                                      behavior: "smooth",
                                      block: "center",
                                    });
                                  }
                                }, 100);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors w-fit"
                            >
                              <span>⚔️</span>
                              <span>Get Strategy Advice</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQuestion(HYPE_REACTION_PROMPT);
                                setTimeout(() => {
                                  const input = document.querySelector(
                                    'input[type="text"]'
                                  ) as HTMLInputElement;
                                  if (input) {
                                    input.focus();
                                    input.scrollIntoView({
                                      behavior: "smooth",
                                      block: "center",
                                    });
                                  }
                                }, 100);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors w-fit"
                            >
                              <span>🔥</span>
                              <span>Hype Me Up</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex space-x-4">
                    <button
                      type="submit"
                      className="w-full p-2 bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!username}
                      title={
                        !username ? "Please sign in to submit questions" : ""
                      }
                    >
                      Submit
                    </button>
                    <button
                      type="button"
                      onClick={handleClear}
                      className="w-full p-2 bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!username}
                    >
                      Clear
                    </button>
                  </div>
                </form>
              </>
            )}

            {activeView === "forum" && (
              <ForumProvider>
                <div className="w-full mt-4">
                  <ForumList />
                </div>
              </ForumProvider>
            )}

            {activeView === "feedback" && (
              <div className="w-full mt-4">
                {/* Feedback Navigation */}
                <div className="mb-6">
                  <div className="flex flex-wrap gap-2 justify-center">
                    {!isAdmin && (
                      <>
                        <button
                          onClick={() => setFeedbackView("form")}
                          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            feedbackView === "form"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          Submit Feedback
                        </button>
                        <button
                          onClick={() => setFeedbackView("my-feedback")}
                          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            feedbackView === "my-feedback"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          My Feedback
                        </button>
                      </>
                    )}
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => setFeedbackView("admin-dashboard")}
                          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            feedbackView === "admin-dashboard"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          Dashboard
                        </button>
                        <button
                          onClick={() => setFeedbackView("admin-list")}
                          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            feedbackView === "admin-list"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          All Feedback
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Feedback Content */}
                {feedbackView === "form" &&
                  (username ? (
                    <FeedbackForm
                      username={username}
                      userType={userType}
                      onFeedbackSubmitted={() => setFeedbackView("my-feedback")}
                    />
                  ) : (
                    <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                      <div className="text-center">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                          Submit Feedback
                        </h2>
                        <p className="text-gray-600 dark:text-gray-400 mb-4">
                          Want to submit feedback?
                        </p>
                        <p className="text-gray-600 dark:text-gray-400 mb-6">
                          Sign in or sign up to share your thoughts, report
                          bugs, or suggest new features.
                        </p>
                        <button
                          onClick={() => {
                            window.location.href = "/signin";
                          }}
                          className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors font-medium"
                        >
                          Sign In/Up
                        </button>
                      </div>
                    </div>
                  ))}

                {feedbackView === "my-feedback" && (
                  <MyFeedbackList username={username} />
                )}

                {isAdmin && feedbackView === "admin-dashboard" && (
                  <AdminFeedbackDashboard username={username} />
                )}

                {isAdmin && feedbackView === "admin-list" && (
                  <FeedbackList
                    username={username}
                    onFeedbackSelect={setSelectedFeedback}
                  />
                )}
              </div>
            )}

            {/* Feedback Detail Modal */}
            {selectedFeedback && (
              <FeedbackDetail
                feedback={selectedFeedback}
                username={username}
                onClose={() => setSelectedFeedback(null)}
                onStatusUpdate={() => {
                  // Refresh the current view if it's an admin view
                  if (
                    isAdmin &&
                    (feedbackView === "admin-list" ||
                      feedbackView === "admin-dashboard")
                  ) {
                    // The components will handle their own refresh
                  }
                }}
                onResponseSubmit={() => {
                  // Refresh the current view if it's an admin view
                  if (
                    isAdmin &&
                    (feedbackView === "admin-list" ||
                      feedbackView === "admin-dashboard")
                  ) {
                    // The components will handle their own refresh
                  }
                }}
              />
            )}

            {loading && <div className="spinner mt-4"></div>}
            {error && <div className="mt-4 text-red-500">{error}</div>}
            {activeView === "chat" &&
              (response || selectedConversation?.response) && (
                <div className="mt-8 w-full max-w-3xl">
                  <h2 className="text-2xl font-bold">Response</h2>
                  {/* Show the image that was analyzed if it exists for this response */}
                  {responseImageUrl && (
                    <div className="mt-4 mb-4 relative inline-block">
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        Analyzed screenshot:
                      </p>
                      <Image
                        src={responseImageUrl}
                        alt="Screenshot that was analyzed"
                        width={300}
                        height={300}
                        className="rounded border border-gray-300 dark:border-gray-600"
                        unoptimized={
                          responseImageUrl.startsWith("http") ||
                          responseImageUrl.startsWith("//")
                        }
                      />
                    </div>
                  )}
                  <div className="bg-gray-100 p-4 rounded response-box">
                    <FormattedResponse
                      response={
                        response || selectedConversation?.response || ""
                      }
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-4 flex justify-end gap-3">
                    {/* Save Guide Button - Show when response is a long guide */}
                    {isLongGuide(
                      response || selectedConversation?.response || "",
                      question || selectedConversation?.question
                    ) && (
                      <button
                        onClick={handleSaveGuide}
                        disabled={savingGuide || guideSaved || !username}
                        className={`px-4 py-2 font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl ${
                          guideSaved
                            ? "bg-green-500 text-white cursor-default"
                            : savingGuide
                            ? "bg-gray-400 text-white cursor-not-allowed"
                            : !username
                            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                            : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
                        }`}
                        title={
                          !username
                            ? "Sign in to save guides"
                            : guideSaved
                            ? "Guide saved!"
                            : "Save this guide to My Guides"
                        }
                      >
                        {guideSaved ? (
                          <>
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
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            Saved!
                          </>
                        ) : (
                          <>
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
                                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                              />
                            </svg>
                            {savingGuide ? "Saving..." : "Save Guide"}
                          </>
                        )}
                      </button>
                    )}
                    {/* Share Card Button */}
                    <button
                      onClick={() => setShowShareModal(true)}
                      className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-pink-500 hover:from-cyan-600 hover:to-pink-600 text-white font-semibold rounded-lg transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl"
                      title="Share this conversation as an image card"
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
                          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                        />
                      </svg>
                      Share Card
                    </button>
                  </div>

                  {/* Display metrics if available */}
                  {Object.keys(metrics).length > 0 && (
                    <div className="mt-4 text-xs text-gray-500">
                      <details>
                        <summary>Performance Metrics</summary>
                        <div className="mt-2 p-2 bg-gray-100 rounded">
                          {metrics.totalTime && (
                            <p>
                              Total time: {Number(metrics.totalTime).toFixed(2)}
                              ms
                            </p>
                          )}
                          {metrics.responseSize && (
                            <p>
                              Response size:{" "}
                              {metrics.responseSize.kilobytes || "N/A"}
                            </p>
                          )}
                          {metrics.aiCacheMetrics && (
                            <p>
                              Cache hit rate:{" "}
                              {metrics.aiCacheMetrics.hitRate || "N/A"}
                            </p>
                          )}
                        </div>
                      </details>
                    </div>
                  )}

                  {/* Phase 3 Step 3: Display Recommendations */}
                  {recommendationsMessage && (
                    <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <div className="flex items-start gap-2">
                        <span className="text-yellow-600 dark:text-yellow-400 text-lg">
                          ℹ️
                        </span>
                        <div className="flex-1">
                          <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                            Recommendations Not Available
                          </p>
                          <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                            {recommendationsMessage}
                          </p>
                          <button
                            onClick={() => setRecommendationsMessage(null)}
                            className="mt-2 text-xs text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {recommendations && username && (
                    <RecommendationsDisplay
                      username={username}
                      recommendations={recommendations}
                      onDismiss={() => {
                        // console.log("[Recommendations] Dismissed by user");
                        setRecommendations(null);
                        setRecommendationsMessage(null);
                      }}
                    />
                  )}
                  {/* Get Recommendations Button - appears after response */}
                  {username &&
                    response &&
                    !recommendations &&
                    !recommendationsMessage &&
                    activeView === "chat" && (
                      <div className="mt-6 flex items-center justify-center">
                        <button
                          onClick={async () => {
                            try {
                              setRecommendationsLoading(true);
                              setRecommendationsMessage(null);
                              const recRes = await axios.get(
                                `/api/recommendations?username=${encodeURIComponent(
                                  username
                                )}&question=${encodeURIComponent(question)}`
                              );
                              // console.log(
                              //   "[Recommendations] Fetch response:",
                              //   recRes.data
                              // );

                              if (
                                recRes.data.success &&
                                recRes.data.recommendations
                              ) {
                                const recs = recRes.data.recommendations;
                                const hasContent =
                                  recs.strategyTips?.tips?.length > 0 ||
                                  recs.learningPath?.suggestions?.length > 0 ||
                                  recs.learningPath?.nextSteps?.length > 0 ||
                                  recs.personalizedTips?.tips?.length > 0;

                                if (hasContent) {
                                  setRecommendations(recs);
                                  setRecommendationsMessage(null);
                                } else {
                                  // Show user-friendly message
                                  const reason =
                                    recRes.data.progressiveDisclosure?.reason ||
                                    "Not enough activity yet. Keep asking questions to get personalized recommendations!";
                                  setRecommendationsMessage(reason);
                                  setRecommendations(null);
                                }
                              } else {
                                // Show message if recommendations aren't available
                                const reason =
                                  recRes.data.progressiveDisclosure?.reason ||
                                  "Recommendations not available at this time.";
                                setRecommendationsMessage(reason);
                              }
                            } catch (error: any) {
                              console.error(
                                "[Recommendations] Fetch error:",
                                error
                              );
                              setRecommendationsMessage(
                                `Error: ${
                                  error.response?.data?.error ||
                                  error.message ||
                                  "Failed to load recommendations"
                                }`
                              );
                            } finally {
                              setRecommendationsLoading(false);
                            }
                          }}
                          disabled={recommendationsLoading}
                          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {recommendationsLoading ? (
                            <>
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                              Loading personalized recommendations...
                            </>
                          ) : (
                            <>💡 Get Personalized Recommendations</>
                          )}
                        </button>
                      </div>
                    )}
                </div>
              )}
            {/* Sign Out / Sign In/Up Button */}
            {username ? (
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="absolute top-4 right-4 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSigningOut ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 dark:border-gray-300 mr-2"></div>
                    Signing Out...
                  </div>
                ) : (
                  "Sign Out"
                )}
              </button>
            ) : (
              <button
                onClick={() => {
                  // Show sign-in modal on main page
                  setShowUsernameModal(true);
                }}
                className="absolute top-4 right-4 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 shadow"
              >
                Sign In/Up
              </button>
            )}
          </div>
        </div>
      </>
    </div>
  );
}
