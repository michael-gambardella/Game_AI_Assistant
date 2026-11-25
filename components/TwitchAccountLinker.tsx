"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ensureTokenValid } from "../utils/tokenRefresh";

interface TwitchAccountLinkerProps {
  twitchUsername?: string | null;
  twitchId?: string | null;
  className?: string;
}

const TwitchAccountLinker: React.FC<TwitchAccountLinkerProps> = ({
  twitchUsername,
  twitchId,
  className = "",
}) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  // Check URL params for success/error messages
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("twitchLinked") === "success") {
        setSuccess("Twitch account linked successfully!");
        // Clean up URL
        window.history.replaceState({}, "", window.location.pathname);
        // Refresh page data after a short delay
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    }
  }, []);

  const handleLinkAccount = async () => {
    setLoading(true);
    setError(null);
    // The account to link comes from the session: refresh it first (an idle tab's access
    // token may have expired, and a page navigation can't refresh it), then start OAuth
    await ensureTokenValid();
    window.location.href = "/api/twitchViewerLogin";
  };

  const handleUnlinkAccount = async () => {
    if (!confirm("Are you sure you want to unlink your Twitch account? You'll need to link it again to use the bot with Pro access.")) {
      return;
    }

    setIsUnlinking(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await axios.post("/api/twitchViewerUnlink");
      
      if (response.data.success) {
        setSuccess("Twitch account unlinked successfully!");
        // Refresh page data after a short delay
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setError(response.data.message || "Failed to unlink account");
      }
    } catch (err: any) {
      console.error("Error unlinking Twitch account:", err);
      setError(err.response?.data?.message || "Failed to unlink Twitch account");
    } finally {
      setIsUnlinking(false);
    }
  };

  const isLinked = !!(twitchUsername && twitchId);

  return (
    <div className={`bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-purple-500/20 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <svg
            className="w-6 h-6 text-purple-400"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428H12l-3 3v-3H4.714V1.714h15.143Z" />
          </svg>
          Twitch Account
        </h2>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
          {success}
        </div>
      )}

      {isLinked ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="text-2xl">✅</div>
              <div>
                <p className="text-white font-semibold">
                  Linked: @{twitchUsername}
                </p>
                <p className="text-gray-400 text-sm">
                  Your Twitch account is linked and ready to use with Pro access
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#1a1b2e]/50 rounded-lg p-4 border border-gray-700/50">
            <h3 className="text-white font-semibold mb-2">Benefits:</h3>
            <ul className="text-gray-300 text-sm space-y-1 list-disc list-inside">
              <li>Use the bot in Twitch chats with your Pro access</li>
              <li>Get personalized responses based on your gaming history</li>
              <li>Track your bot usage across platforms</li>
            </ul>
          </div>

          <button
            onClick={handleUnlinkAccount}
            disabled={isUnlinking}
            className="w-full bg-red-600/20 hover:bg-red-600/30 text-red-300 py-2 px-4 rounded-lg transition-all duration-200 border border-red-500/30 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUnlinking ? "Unlinking..." : "Unlink Twitch Account"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="text-2xl">⚠️</div>
              <div>
                <p className="text-white font-semibold">
                  Not Linked
                </p>
                <p className="text-gray-400 text-sm">
                  Link your Twitch account to use the bot with Pro access
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#1a1b2e]/50 rounded-lg p-4 border border-gray-700/50">
            <h3 className="text-white font-semibold mb-2">Why link your account?</h3>
            <ul className="text-gray-300 text-sm space-y-1 list-disc list-inside">
              <li>Use your Pro access when chatting with the bot on Twitch</li>
              <li>Get personalized responses based on your gaming history</li>
              <li>Track your bot usage across platforms</li>
              <li>Secure and private - only links your username</li>
            </ul>
          </div>

          <button
            onClick={handleLinkAccount}
            disabled={loading}
            className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white py-3 px-4 rounded-lg transition-all duration-200 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
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
                <span>Link Twitch Account</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default TwitchAccountLinker;

