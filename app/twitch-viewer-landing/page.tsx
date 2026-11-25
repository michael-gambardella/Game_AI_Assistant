"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import Image from "next/image";
import { ensureTokenValid } from "../../utils/tokenRefresh";

export const dynamic = "force-dynamic";

// Create a separate component for the main content
function TwitchViewerLandingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const twitchUsername = searchParams?.get("twitchUsername") ?? null;
  const authStatus = searchParams?.get("auth") ?? null;
  const error = searchParams?.get("error") ?? null;
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    // If auth was successful, show success message
    if (authStatus === "success" && twitchUsername) {
      // Auto-redirect to account page after 3 seconds
      setTimeout(() => {
        router.push("/account?twitchLinked=success");
      }, 3000);
    }
  }, [authStatus, twitchUsername, router]);

  // Handle linking the Twitch account
  const handleLinkAccount = async () => {
    setIsLinking(true);
    // The account to link comes from the session: refresh it first (an idle tab's access
    // token may have expired, and a page navigation can't refresh it), then start OAuth
    await ensureTokenValid();
    window.location.href = "/api/twitchViewerLogin";
  };

  // Get error message based on error code
  const getErrorMessage = () => {
    switch (error) {
      case "login_required":
        return "You must be logged into Video Game Wingman to link your Twitch account.";
      case "invalid_state":
        return "The authorization request was invalid or expired. Please try again.";
      case "no_code":
        return "No authorization code received from Twitch. Please try again.";
      case "no_token":
        return "Failed to obtain access token from Twitch. Please try again.";
      case "no_user_data":
        return "Failed to fetch your Twitch account information. Please try again.";
      case "fetch_failed":
        return "Error communicating with Twitch. Please try again.";
      case "user_not_found":
        return "Your Video Game Wingman account was not found. Please log in and try again.";
      case "already_linked":
        return `This Twitch account (@${twitchUsername || "unknown"}) is already linked to another Video Game Wingman account.`;
      case "access_denied":
        return "You cancelled the authorization. Your Twitch account was not linked.";
      case "redirect_uri_mismatch":
        return "Redirect URI mismatch. Please contact support if this issue persists.";
      case "server_error":
        return "An internal server error occurred. Please try again later.";
      default:
        return "An error occurred while linking your Twitch account. Please try again.";
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

      <div className="relative bg-white/95 backdrop-blur-sm p-10 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border border-white/20">
        {authStatus === "success" && twitchUsername ? (
          // Success state
          <div className="flex flex-col items-center">
            <div className="text-6xl mb-4">✅</div>
            <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-4">
              Twitch Account Linked!
            </h1>
            <p className="text-gray-600 text-center mb-6">
              Your Twitch account{" "}
              <span className="font-semibold text-purple-600">
                @{twitchUsername}
              </span>{" "}
              has been successfully linked to your Video Game Wingman account.
            </p>
            <p className="text-sm text-gray-500 text-center mb-6">
              You can now use the bot in Twitch chats with your Pro access!
            </p>
            <p className="text-sm text-gray-500 text-center mb-6">
              Redirecting to account page...
            </p>
            <button
              onClick={() => router.push("/account?twitchLinked=success")}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold"
            >
              Go to Account Page
            </button>
          </div>
        ) : authStatus === "error" ? (
          // Error state
          <div className="flex flex-col items-center">
            <div className="text-6xl mb-4">❌</div>
            <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-red-600 to-pink-600 bg-clip-text text-transparent mb-4">
              Linking Failed
            </h1>
            <p className="text-gray-600 text-center mb-6">{getErrorMessage()}</p>
            <button
              onClick={handleLinkAccount}
              disabled={isLinking}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50"
            >
              {isLinking ? "Processing..." : "Try Again"}
            </button>
            <button
              onClick={() => router.push("/account")}
              className="w-full mt-3 bg-gray-500 text-white py-3 px-6 rounded-xl hover:bg-gray-600 transition-all duration-300 font-semibold"
            >
              Go to Account Page
            </button>
          </div>
        ) : (
          // Default state - Link account
          <>
            <div className="flex flex-col items-center mb-8">
              <Image
                src="/assets/video-game-wingman-logo.png"
                alt="Video Game Wingman Logo"
                width={180}
                height={180}
                className="mb-6 drop-shadow-lg"
                priority
              />
              <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
                Link Your Twitch Account
              </h1>
              <p className="text-gray-600 text-center text-sm">
                Connect your Twitch account to use Hero Game Wingman bot in
                Twitch chats with your Pro access
              </p>
            </div>
            <div className="space-y-4">
              <button
                onClick={handleLinkAccount}
                disabled={isLinking}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLinking ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428H12l-3 3v-3H4.714V1.714h15.143Z" />
                    </svg>
                    <span>🔗 Link Twitch Account</span>
                  </>
                )}
              </button>
              <button
                onClick={() => router.push("/account")}
                className="w-full bg-gray-500 text-white py-3 px-6 rounded-xl hover:bg-gray-600 transition-all duration-300 font-semibold"
              >
                Cancel
              </button>
            </div>

            {/* Feature highlights */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>Pro Access</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>Personalized</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>Secure</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>Easy Setup</span>
                </div>
              </div>
            </div>

            {/* Usage instructions */}
            <div className="mt-6 p-4 bg-white rounded-lg border-2 border-gray-400 shadow-sm">
              <p
                className="text-sm font-semibold mb-3"
                style={{ color: "#000000" }}
              >
                💡 Why link your account?
              </p>
              <ul
                className="text-sm space-y-2.5 list-disc list-inside leading-relaxed"
                style={{ color: "#000000" }}
              >
                <li style={{ color: "#000000" }}>
                  Use your Pro access when chatting with the bot on Twitch
                </li>
                <li style={{ color: "#000000" }}>
                  Get personalized responses based on your gaming history
                </li>
                <li style={{ color: "#000000" }}>
                  Track your bot usage across platforms
                </li>
                <li style={{ color: "#000000" }}>
                  Secure and private - only links your username
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Main component with Suspense wrapper
export default function TwitchViewerLanding() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-lg">Loading...</div>
        </div>
      }
    >
      <TwitchViewerLandingContent />
    </Suspense>
  );
}

