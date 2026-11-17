"use client";

import { useState, useEffect } from "react";
import axios from "../utils/axiosConfig";
import { SmartGameResumeProps, GameResumeData } from "../types";

export default function SmartGameResume({
  username,
  onAskQuestion,
}: SmartGameResumeProps) {
  const [resumeData, setResumeData] = useState<GameResumeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only fetch if user is logged in and not dismissed
    if (!username || dismissed) {
      return;
    }

    // Get today's date for tracking when resume was shown
    const today = new Date().toDateString();
    const lastShown = localStorage.getItem(`gameResume_${username}_lastShown`);

    // Don't show if already shown today (prevents multiple displays on refresh/return)
    if (lastShown === today) {
      setDismissed(true);
      return;
    }

    const fetchGameResume = async () => {
      setLoading(true);

      try {
        const response = await axios.get<GameResumeData>("/api/game-resume", {
          params: {},
        });

        if (response.data && response.data.game && response.data.suggestion) {
          setResumeData(response.data);
          // Mark as shown today
          localStorage.setItem(`gameResume_${username}_lastShown`, today);
        } else {
          // No game found - this is not an error, just hide the component
          setDismissed(true);
        }
      } catch (err: any) {
        console.error("Error fetching game resume:", err);
        // Don't show error to user, just hide the component
        setDismissed(true);
      } finally {
        setLoading(false);
      }
    };

    fetchGameResume();
  }, [username, dismissed]);

  // Reset dismissed state when username changes (new login)
  useEffect(() => {
    setDismissed(false);
    setResumeData(null);
  }, [username]);

  // Don't render if loading, dismissed, or no data
  if (
    loading ||
    dismissed ||
    !resumeData ||
    !resumeData.game ||
    !resumeData.suggestion
  ) {
    return null;
  }

  const { game, suggestion } = resumeData;

  const getIcon = () => {
    switch (suggestion.type) {
      case "challenge":
        return "⚔️";
      case "build":
        return "🛡️";
      case "achievement":
        return "🏆";
      default:
        return "🎮";
    }
  };

  const getColorClass = () => {
    switch (suggestion.type) {
      case "challenge":
        return "from-red-500 to-orange-500";
      case "build":
        return "from-blue-500 to-purple-500";
      case "achievement":
        return "from-yellow-500 to-amber-500";
      default:
        return "from-gray-500 to-gray-600";
    }
  };

  return (
    <div
      className="w-full max-w-2xl mx-auto mb-6"
      style={{ animation: "fadeIn 0.5s ease-in-out forwards" }}
    >
      <div
        className={`bg-gradient-to-r ${getColorClass()} rounded-lg p-6 shadow-lg border-2 border-white/20`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{getIcon()}</span>
              <h3 className="text-xl font-bold text-white">
                Continue your journey in{" "}
                <span className="underline">{game}</span>!
              </h3>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-4">
              <h4 className="text-lg font-semibold text-white mb-2">
                {suggestion.title}
              </h4>
              <p className="text-white/90 text-sm leading-relaxed">
                {suggestion.description}
              </p>
            </div>

            <button
              onClick={() => {
                onAskQuestion(suggestion.questionPrompt);
                setDismissed(true);
              }}
              className="px-6 py-2.5 bg-white text-gray-800 font-semibold rounded-lg hover:bg-gray-100 transition-colors shadow-md hover:shadow-lg transform hover:scale-105 duration-200"
            >
              Ask About This
            </button>
          </div>

          <button
            onClick={() => setDismissed(true)}
            className="ml-4 text-white/80 hover:text-white transition-colors p-1"
            aria-label="Dismiss"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
