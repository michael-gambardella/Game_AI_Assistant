"use client";

import React, { useState, useEffect } from "react";
import { ChallengeHistoryEntry, ChallengeHistoryProps } from "../types";
import axios from "../utils/axiosConfig";

const ChallengeHistory: React.FC<ChallengeHistoryProps> = ({ username }) => {
  const [history, setHistory] = useState<ChallengeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [limit] = useState(30);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!username) {
      setLoading(false);
      return;
    }

    const fetchHistory = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await axios.get(
          `/api/challenge-history?limit=${limit}&offset=${offset}`
        );

        if (response.data && response.data.history) {
          // Debug: Log the received data to check if challengeTitle is present
          // console.log(
          //   "Challenge history data received:",
          //   response.data.history
          // );
          setHistory(response.data.history);
          setTotal(response.data.total);
          setHasMore(
            offset + response.data.history.length < response.data.total
          );
        }
      } catch (err) {
        console.error("Error fetching challenge history:", err);
        setError("Failed to load challenge history");
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [username, limit, offset]);

  const formatDate = (date: Date | string): string => {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (date: Date | string): string => {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getDifficultyColor = (difficulty?: string): string => {
    switch (difficulty) {
      case "easy":
        return "text-green-400 bg-green-400/20";
      case "medium":
        return "text-yellow-400 bg-yellow-400/20";
      case "hard":
        return "text-red-400 bg-red-400/20";
      default:
        return "text-gray-400 bg-gray-400/20";
    }
  };

  const getDifficultyLabel = (difficulty?: string): string => {
    switch (difficulty) {
      case "easy":
        return "Easy";
      case "medium":
        return "Medium";
      case "hard":
        return "Hard";
      default:
        return "";
    }
  };

  if (!username) {
    return null;
  }

  if (loading && history.length === 0) {
    return (
      <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
        <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
          Challenge History
        </h2>
        <div className="text-gray-400">Loading challenge history...</div>
      </div>
    );
  }

  if (error && history.length === 0) {
    return (
      <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
        <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
          Challenge History
        </h2>
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
        <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
          Challenge History
        </h2>
        <div className="text-gray-400">
          No challenge history yet. Complete daily challenges to see them here!
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
      <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
        Challenge History
      </h2>
      {total > 0 && (
        <div className="text-sm text-gray-400 mb-4">
          {total} challenge{total !== 1 ? "s" : ""} completed
        </div>
      )}

      <div className="space-y-3 max-h-[600px] overflow-y-auto">
        {history.map((entry, index) => {
          // Debug: Log each entry to see what fields are available
          // if (index === 0) {
          //   console.log("Rendering challenge history entry:", entry);
          // }
          return (
            <div
              key={`${entry.challengeId}-${entry.date}-${index}`}
              className="bg-[#1a1b2e]/50 rounded-lg p-4 border border-[#00ffff]/10 hover:border-[#00ffff]/30 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-white text-sm">
                      {entry.challengeTitle ||
                        entry.challengeId ||
                        "Challenge Completed"}
                    </h3>
                    {entry.difficulty && (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${getDifficultyColor(
                          entry.difficulty
                        )}`}
                      >
                        {getDifficultyLabel(entry.difficulty)}
                      </span>
                    )}
                  </div>
                  {entry.challengeDescription && (
                    <p className="text-sm text-gray-400 mb-2">
                      {entry.challengeDescription}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>
                      {formatDate(entry.completedAt)} at{" "}
                      {formatTime(entry.completedAt)}
                    </span>
                    {entry.streakAtCompletion > 0 && (
                      <span className="text-yellow-400">
                        🔥 {entry.streakAtCompletion} day streak
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setOffset(offset + limit)}
            className="px-4 py-2 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 text-sm font-semibold"
            disabled={loading}
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
};

export default ChallengeHistory;
