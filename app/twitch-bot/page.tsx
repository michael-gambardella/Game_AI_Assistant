"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import axios from "axios";
import { botConfig } from "@/config/botConfig";
import { BotStats } from "@/types";
import { ensureTokenValid } from "../../utils/tokenRefresh";

export const dynamic = "force-dynamic";

function TwitchBotProfileContent() {
  const router = useRouter();
  const [stats, setStats] = useState<BotStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Fetch bot statistics
  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await axios.get("/api/twitchBot/stats");
        if (response.data.success) {
          setStats(response.data.stats);
        } else {
          setError("Failed to load bot statistics");
        }
      } catch (err: any) {
        console.error("Error fetching bot stats:", err);
        setError(
          err.response?.data?.message || "Failed to load bot statistics"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  // Handle adding the bot to the channel
  const handleAddToChannel = async () => {
    setIsAdding(true);
    // The account to link comes from the session: refresh it first (an idle tab's access
    // token may have expired, and a page navigation can't refresh it), then start OAuth
    await ensureTokenValid();
    window.location.href = "/api/twitchBotLogin";
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  // Format number with commas
  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  return (
    <div className="docs-page min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      ></div>

      <div className="relative container mx-auto px-4 py-12">
        {/* Header Section */}
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 mb-8 border border-white/20">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
            <div className="flex-shrink-0">
              <Image
                src="/assets/video-game-wingman-logo.png"
                alt="Hero Game Wingman Logo"
                width={180}
                height={180}
                className="drop-shadow-lg rounded-full"
                priority
              />
            </div>
            <div className="flex-1 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-3 mb-4">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  {botConfig.name}
                </h1>
                {stats && (
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-semibold ${
                      stats.status === "online"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {stats.status === "online" ? "🟢 Online" : "⚫ Offline"}
                  </span>
                )}
              </div>
              <p className="text-gray-700 text-lg mb-4">
                {botConfig.description}
              </p>
              <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                {botConfig.knowledge.slice(0, 6).map((topic, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Statistics Section */}
        {loading ? (
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-white/20 text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            <p className="mt-4 text-gray-600">Loading statistics...</p>
          </div>
        ) : error ? (
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-white/20">
            <div className="text-center text-red-600">
              <p className="text-lg font-semibold">⚠️ {error}</p>
            </div>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* Total Channels */}
            <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg p-6 border border-white/20">
              <div className="text-sm text-gray-600 mb-2">Total Channels</div>
              <div className="text-3xl font-bold text-purple-600 mb-1">
                {formatNumber(stats.totalChannels)}
              </div>
              <div className="text-xs text-gray-500">
                {stats.activeChannels} active
              </div>
            </div>

            {/* Total Messages */}
            <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg p-6 border border-white/20">
              <div className="text-sm text-gray-600 mb-2">Total Messages</div>
              <div className="text-3xl font-bold text-blue-600 mb-1">
                {formatNumber(stats.totalMessages)}
              </div>
              <div className="text-xs text-gray-500">
                {formatNumber(stats.recentMessages)} in last 30 days
              </div>
            </div>

            {/* Recent Users */}
            <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg p-6 border border-white/20">
              <div className="text-sm text-gray-600 mb-2">Recent Users</div>
              <div className="text-3xl font-bold text-indigo-600 mb-1">
                {formatNumber(stats.recentUniqueUsers)}
              </div>
              <div className="text-xs text-gray-500">Last 30 days</div>
            </div>

            {/* Success Rate */}
            <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg p-6 border border-white/20">
              <div className="text-sm text-gray-600 mb-2">Success Rate</div>
              <div className="text-3xl font-bold text-green-600 mb-1">
                {stats.recentSuccessRate.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">Last 30 days</div>
            </div>
          </div>
        ) : null}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Add Bot & Features */}
          <div className="lg:col-span-2 space-y-6">
            {/* Add Bot Section */}
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-800">
                  Add {botConfig.name} to Your Channel
                </h2>
                <button
                  onClick={() => router.push("/twitch-bot/docs")}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-semibold"
                >
                  📚 Documentation
                </button>
              </div>
              <p className="text-gray-600 mb-6">
                Join hundreds of streamers who use {botConfig.name} to enhance
                their Twitch chat experience. Get AI-powered gaming assistance
                for your viewers 24/7.
              </p>
              <button
                onClick={handleAddToChannel}
                disabled={isAdding}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-3 text-lg"
              >
                {isAdding ? (
                  <>
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-6 h-6"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428H12l-3 3v-3H4.714V1.714h15.143Z" />
                    </svg>
                    <span>🚀 Add Bot to Your Channel</span>
                  </>
                )}
              </button>
              <p className="text-sm text-gray-500 mt-4 text-center">
                Free to use • No credit card required • Setup in seconds
              </p>
            </div>

            {/* Features Section */}
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-white/20">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">
                Features
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🤖</span>
                  <div>
                    <h3 className="font-semibold text-gray-800">AI-Powered</h3>
                    <p className="text-sm text-gray-600">
                      Advanced AI for accurate gaming advice
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚡</span>
                  <div>
                    <h3 className="font-semibold text-gray-800">
                      Fast Responses
                    </h3>
                    <p className="text-sm text-gray-600">
                      Quick answers to keep chat flowing
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🎮</span>
                  <div>
                    <h3 className="font-semibold text-gray-800">
                      Game Knowledge
                    </h3>
                    <p className="text-sm text-gray-600">
                      Expertise across all game genres
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🛡️</span>
                  <div>
                    <h3 className="font-semibold text-gray-800">Moderation</h3>
                    <p className="text-sm text-gray-600">
                      Built-in content filtering and moderation
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚙️</span>
                  <div>
                    <h3 className="font-semibold text-gray-800">
                      Customizable
                    </h3>
                    <p className="text-sm text-gray-600">
                      Configure commands, rate limits, and more
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">📊</span>
                  <div>
                    <h3 className="font-semibold text-gray-800">Analytics</h3>
                    <p className="text-sm text-gray-600">
                      Track usage and engagement metrics
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Usage Instructions */}
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-white/20">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">
                How to Use
              </h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">
                    1
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-1">
                      Add the Bot
                    </h3>
                    <p className="text-sm text-gray-600">
                      Click &quot;Add Bot to Your Channel&quot; and authorize
                      with Twitch. The bot will automatically join your channel.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">
                    2
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-1">
                      Use Commands
                    </h3>
                    <p className="text-sm text-gray-600">
                      Viewers can use{" "}
                      <code className="bg-gray-100 px-2 py-1 rounded font-mono text-sm">
                        !wingman
                      </code>{" "}
                      or{" "}
                      <code className="bg-gray-100 px-2 py-1 rounded font-mono text-sm">
                        @HeroGameWingman
                      </code>{" "}
                      followed by their question in chat.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">
                    3
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-1">
                      Manage Settings
                    </h3>
                    <p className="text-sm text-gray-600">
                      Configure bot settings, moderation, and view analytics
                      from your account page.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Stats & Info */}
          <div className="space-y-6">
            {/* Bot Info */}
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Bot Info</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-gray-600">Status</div>
                  <div className="font-semibold text-gray-800">
                    {stats?.status === "online" ? "🟢 Online" : "⚫ Offline"}
                  </div>
                </div>
                {stats?.botLaunchDate && (
                  <div>
                    <div className="text-gray-600">Launched</div>
                    <div className="font-semibold text-gray-800">
                      {formatDate(stats.botLaunchDate)}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-gray-600">Platform</div>
                  <div className="font-semibold text-gray-800">Twitch</div>
                </div>
                <div>
                  <div className="text-gray-600">Access</div>
                  <div className="font-semibold text-gray-800">
                    Requires Pro Account
                  </div>
                </div>
              </div>
            </div>

            {/* Top Channels */}
            {stats && stats.topChannels.length > 0 && (
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-6 border border-white/20">
                <h2 className="text-xl font-bold text-gray-800 mb-4">
                  Top Channels
                </h2>
                <div className="space-y-3">
                  {stats.topChannels.map((channel, idx) => (
                    <div
                      key={channel.channelName}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 font-bold">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold text-gray-800">
                          #{channel.channelName}
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        {formatNumber(channel.messageCount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Links */}
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Quick Links
              </h2>
              <div className="space-y-3">
                <button
                  onClick={() => router.push("/account")}
                  className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all duration-300 font-semibold text-sm"
                >
                  Manage Channels
                </button>
                <button
                  onClick={() => router.push("/")}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-300 font-semibold text-sm"
                >
                  Video Game Wingman
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Main component with Suspense wrapper
export default function TwitchBotProfile() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-lg">Loading...</div>
        </div>
      }
    >
      <TwitchBotProfileContent />
    </Suspense>
  );
}
