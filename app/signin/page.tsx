"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "../../utils/axiosConfig";
import Image from "next/image";
import PasswordSetupModal from "../../components/PasswordSetupModal";
import { trackSignIn, setUserProperties } from "../../utils/analytics";

const SignInPage: React.FC = () => {
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showPasswordSetupModal, setShowPasswordSetupModal] = useState(false);
  const [isLegacyUser, setIsLegacyUser] = useState(false);
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [accountLocked, setAccountLocked] = useState(false);
  const [lockoutMessage, setLockoutMessage] = useState("");
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [requiresUnlock, setRequiresUnlock] = useState(false);
  const router = useRouter();

  // Check if user is already logged in
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedUsername = localStorage.getItem("username");
      if (storedUsername) {
        // User is already logged in, redirect to main page
        router.push("/");
      }
    }
  }, [router]);

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
      const res = await axios.post("/api/auth/signin", {
        identifier: usernameInput.trim(),
        password: passwordInput,
      }, {
        withCredentials: true, // Ensure cookies are sent and received
      });

      if (res.data && res.data.user) {
        // Get old values before updating
        const oldUsername = localStorage.getItem("username");
        const oldUserId = localStorage.getItem("userId");

        // Update localStorage
        localStorage.setItem("username", res.data.user.username);
        localStorage.setItem("userId", res.data.user.userId);
        localStorage.setItem("userEmail", res.data.user.email);

        // Record token refresh time for automatic refresh tracking
        // Also reset any invalid refresh token flags
        if (typeof window !== 'undefined') {
          // Record login to prevent immediate refresh attempts
          const { recordLogin, clearTokenRefreshRecord } = await import('../../utils/tokenRefresh');
          clearTokenRefreshRecord(); // Clear any invalid flags first
          recordLogin(); // Record login time
        }

        // Track sign in event and set user properties
        trackSignIn('email');
        setUserProperties(
          res.data.user.username,
          res.data.user.hasProAccess ? 'pro' : 'free'
        );

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

        // Check if user needs to set up password (legacy user)
        if (res.data.requiresPasswordSetup && res.data.isLegacyUser) {
          setIsLegacyUser(true);
          setShowPasswordSetupModal(true);
        } else {
          // Redirect to main page after successful sign-in
          router.push("/");
        }
      }
    } catch (err: any) {
      // Passwordless account: a reset code was emailed - continue on the code screen
      if (err.response?.status === 403 && err.response?.data?.requiresPasswordReset) {
        if (err.response.data.codeSent) {
          router.push("/forgot-password?codeSent=1");
        } else {
          setUsernameError(err.response.data.message);
        }
        return;
      }
      // Check if account is locked
      if (err.response?.status === 403 && err.response?.data?.accountLocked) {
        setAccountLocked(true);
        setLockoutMessage(err.response.data.message || "Account is locked. Please check your email for unlock instructions.");
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
    // Identified by the auth cookie
    const res = await axios.post("/api/auth/setup-password", {
      newPassword: password,
    });

    if (res.data && res.data.user) {
      // Update local storage with updated user data
      localStorage.setItem("userId", res.data.user.userId);
      localStorage.setItem("userEmail", res.data.user.email);

      // Close modal and redirect
      setShowPasswordSetupModal(false);
      setIsLegacyUser(false);
      router.push("/");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      ></div>

      <div className="relative bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm p-10 rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-white/20">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/assets/video-game-wingman-logo.png"
            alt="Video Game Wingman Logo"
            width={120}
            height={120}
            className="mb-6 drop-shadow-lg"
            priority
          />
          <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
            Sign In
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-center text-sm">
            Welcome back to Video Game Wingman
          </p>
        </div>

        <form onSubmit={handleUsernameSubmit} className="space-y-4">
          {/* Username/Email Field */}
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Username or Email
            </label>
            <input
              type="text"
              id="username"
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

          {/* Password Field */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                id="password"
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
          </div>

          {/* Account Lockout Message */}
          {accountLocked && (
            <div className="p-4 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-700 rounded-lg">
              <div className="flex items-start">
                <svg
                  className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-3 mt-0.5 flex-shrink-0"
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
                  <p className="text-yellow-700 dark:text-yellow-300 text-sm mb-2">
                    {lockoutMessage}
                  </p>
                  {lockedUntil && !requiresUnlock && (
                    <p className="text-yellow-600 dark:text-yellow-400 text-xs">
                      You can try again in {Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 1000))} minute(s).
                    </p>
                  )}
                  {requiresUnlock && (
                    <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                      <p className="text-yellow-800 dark:text-yellow-200 text-xs font-medium mb-1">
                        To unlock your account:
                      </p>
                      <ol className="text-yellow-700 dark:text-yellow-300 text-xs list-decimal list-inside space-y-1">
                        <li>Check your email for the unlock link</li>
                        <li>Click the unlock link in the email</li>
                        <li>Or visit the unlock page with your token</li>
                      </ol>
                      <p className="text-yellow-600 dark:text-yellow-400 text-xs mt-2">
                        Didn&apos;t receive an email? Check your spam folder or contact support.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Regular Error Message */}
          {usernameError && !accountLocked && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg">
              <p className="text-red-700 dark:text-red-300 text-sm">
                {usernameError}
              </p>
            </div>
          )}

          {/* Sign In Button */}
          <button
            type="submit"
            disabled={isSigningIn}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
            onClick={() => router.push("/forgot-password")}
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
              onClick={() => router.push("/signup")}
              className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 font-medium"
            >
              Sign Up
            </button>
          </p>
        </div>
      </div>

      {/* Password Setup Modal for Legacy Users */}
      <PasswordSetupModal
        isOpen={showPasswordSetupModal}
        onClose={() => {
          setShowPasswordSetupModal(false);
          setIsLegacyUser(false);
        }}
        onSetup={handlePasswordSetup}
        username={username || ""}
        userId={userId || ""}
      />
    </div>
  );
};

export default SignInPage;
