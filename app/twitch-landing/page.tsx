"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import Image from "next/image";
import { ensureTokenValid } from "../../utils/tokenRefresh";

export const dynamic = "force-dynamic";

// Create a separate component for the main content
function TwitchLandingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const channelName = searchParams?.get("channel") ?? null;
  const authStatus = searchParams?.get("auth") ?? null;
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    // If auth was successful and we have a channel, show success message
    if (authStatus === "success" && channelName) {
      // Auto-redirect to account page after 3 seconds
      setTimeout(() => {
        router.push(
          "/account?twitchBot=added&channel=" + encodeURIComponent(channelName)
        );
      }, 3000);
    }
  }, [authStatus, channelName, router]);

  // Handle adding the bot to the channel
  const handleAddToChannel = async () => {
    setIsAdding(true);
    // The account to link comes from the session: refresh it first (an idle tab's access
    // token may have expired, and a page navigation can't refresh it), then start OAuth
    await ensureTokenValid();
    window.location.href = "/api/twitchBotLogin";
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
        {authStatus === "success" && channelName ? (
          // Success state
          <div className="flex flex-col items-center">
            <div className="text-6xl mb-4">✅</div>
            <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-4">
              Bot Added Successfully!
            </h1>
            <p className="text-gray-600 text-center mb-6">
              Hero Game Wingman has been added to your channel:{" "}
              <span className="font-semibold text-purple-600">
                #{channelName}
              </span>
            </p>
            <p className="text-sm text-gray-500 text-center mb-6">
              Redirecting to account page...
            </p>
            <button
              onClick={() =>
                router.push(
                  "/account?twitchBot=added&channel=" +
                    encodeURIComponent(channelName)
                )
              }
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
              Authorization Failed
            </h1>
            <p className="text-gray-600 text-center mb-6">
              There was an error adding the bot to your channel. Please try
              again.
            </p>
            <button
              onClick={handleAddToChannel}
              disabled={isAdding}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50"
            >
              {isAdding ? "Processing..." : "Try Again"}
            </button>
          </div>
        ) : (
          // Default state - Add bot
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
                Add Hero Game Wingman to Your Twitch Channel!
              </h1>
              <p className="text-gray-600 text-center text-sm mb-4">
                Your AI-powered gaming companion is ready to join your Twitch
                chat
              </p>
              <button
                onClick={() => router.push("/twitch-bot/docs")}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-semibold"
              >
                📚 View Documentation
              </button>
            </div>
            <div className="space-y-4">
              <button
                onClick={handleAddToChannel}
                disabled={isAdding}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isAdding ? (
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
                    <span>🚀 Add Bot to Channel</span>
                  </>
                )}
              </button>
              <button
                onClick={() => router.push("/account")}
                className="w-full bg-gray-500 text-white py-3 px-6 rounded-xl hover:bg-gray-600 transition-all duration-300 font-semibold"
              >
                Manage Channels
              </button>
              <button
                onClick={() => router.push("/twitch-bot")}
                className="w-full bg-blue-500 text-white py-3 px-6 rounded-xl hover:bg-blue-600 transition-all duration-300 font-semibold flex items-center justify-center gap-2"
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
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                <span>View Bot Profile & Stats</span>
              </button>
            </div>

            {/* Feature highlights */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>AI-Powered</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>Pro Access</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>Chat Commands</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-500">✓</span>
                  <span>24/7 Available</span>
                </div>
              </div>
            </div>

            {/* Usage instructions */}
            <div className="mt-6 p-4 bg-white rounded-lg border-2 border-gray-400 shadow-sm">
              <p
                className="text-sm font-semibold mb-3"
                style={{ color: "#000000" }}
              >
                💡 How to use:
              </p>
              <ul
                className="text-sm space-y-2.5 list-disc list-inside leading-relaxed"
                style={{ color: "#000000" }}
              >
                <li className="break-words" style={{ color: "#000000" }}>
                  <span style={{ color: "#000000" }}>Use</span>{" "}
                  <code
                    className="bg-gray-100 px-1.5 py-0.5 rounded font-mono font-semibold border border-gray-400"
                    style={{ color: "#000000" }}
                  >
                    !wingman
                  </code>{" "}
                  <span style={{ color: "#000000" }}>or</span>{" "}
                  <code
                    className="bg-gray-100 px-1.5 py-0.5 rounded font-mono font-semibold border border-gray-400"
                    style={{ color: "#000000" }}
                  >
                    @HeroGameWingman
                  </code>{" "}
                  <span style={{ color: "#000000" }}>in your chat</span>
                </li>
                <li style={{ color: "#000000" }}>
                  Ask questions about games, strategies, or tips
                </li>
                <li style={{ color: "#000000" }}>
                  Manage your channels from the Account page
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
export default function TwitchLanding() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-lg">Loading...</div>
        </div>
      }
    >
      <TwitchLandingContent />
    </Suspense>
  );
}
