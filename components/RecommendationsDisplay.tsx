/**
 * RecommendationsDisplay Component
 * Phase 3 Step 3: Displays personalized recommendations to users
 *
 * Features:
 * - Shows 3 recommendation types (strategy tips, learning path, personalized tips)
 * - Collapsible sections for better UX
 * - Dismiss button functionality
 * - Responsive design with dark mode support
 */

"use client";

import { useState, useMemo, memo, useRef } from "react";
import axios from "../utils/axiosConfig";

import { RecommendationsDisplayProps } from "@/types";

const RecommendationsDisplay = memo(
  function RecommendationsDisplay({
    username,
    recommendations,
    onDismiss,
  }: RecommendationsDisplayProps) {
    const [isDismissing, setIsDismissing] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const [expandedSections, setExpandedSections] = useState<{
      strategy: boolean;
      learning: boolean;
      tips: boolean;
    }>({
      strategy: true,
      learning: false,
      tips: true,
    });

    const handleDismiss = async () => {
      if (isDismissing || isDismissed) return;

      setIsDismissing(true);
      try {
        await axios.post("/api/dismiss-recommendations", {});
        setIsDismissed(true);
        if (onDismiss) {
          onDismiss();
        }
      } catch (error) {
        console.error("Error dismissing recommendations:", error);
        alert("Failed to dismiss recommendations. Please try again.");
      } finally {
        setIsDismissing(false);
      }
    };

    const toggleSection = (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({
        ...prev,
        [section]: !prev[section],
      }));
    };

    // Memoize the hasRecommendations check to avoid recalculating on every render
    // IMPORTANT: Hooks must be called before any early returns
    const hasRecommendations = useMemo(() => {
      return (
        recommendations.strategyTips.tips.length > 0 ||
        recommendations.learningPath.suggestions.length > 0 ||
        recommendations.learningPath.nextSteps.length > 0 ||
        recommendations.personalizedTips.tips.length > 0
      );
    }, [
      recommendations.strategyTips.tips.length,
      recommendations.learningPath.suggestions.length,
      recommendations.learningPath.nextSteps.length,
      recommendations.personalizedTips.tips.length,
    ]);

    // Debug logging (only in development, and only once per mount)
    // IMPORTANT: Hooks must be called before any early returns
    const hasLoggedRef = useRef(false);
    if (process.env.NODE_ENV === "development" && !hasLoggedRef.current) {
      console.log("[RecommendationsDisplay] Initial render:", {
        hasRecommendations,
        strategyTips: recommendations.strategyTips.tips.length,
        learningSuggestions: recommendations.learningPath.suggestions.length,
        learningNextSteps: recommendations.learningPath.nextSteps.length,
        personalizedTips: recommendations.personalizedTips.tips.length,
      });
      hasLoggedRef.current = true;
    }

    // Early returns after all hooks have been called
    if (isDismissed) {
      return null;
    }

    if (!hasRecommendations) {
      return null;
    }

    return (
      <div className="mt-6 w-full max-w-3xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-blue-900 dark:text-blue-100">
              💡 Personalized Recommendations
            </h3>
          </div>
          <button
            onClick={handleDismiss}
            disabled={isDismissing}
            className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
            title="Dismiss recommendations"
          >
            {isDismissing ? "Dismissing..." : "✕ Dismiss"}
          </button>
        </div>

        {/* Strategy Tips */}
        {recommendations.strategyTips.tips.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => toggleSection("strategy")}
              className="w-full flex items-center justify-between text-left font-semibold text-lg text-blue-800 dark:text-blue-200 mb-2 hover:text-blue-900 dark:hover:text-blue-100"
            >
              <span>⚔️ Strategy Tips</span>
              <span>{expandedSections.strategy ? "−" : "+"}</span>
            </button>
            {expandedSections.strategy && (
              <div className="pl-4 border-l-2 border-blue-300 dark:border-blue-700">
                <ul className="space-y-2 text-gray-700 dark:text-gray-300">
                  {recommendations.strategyTips.tips.map((tip, index) => (
                    <li key={index} className="flex items-start">
                      <span className="mr-2">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Learning Path */}
        {(recommendations.learningPath.suggestions.length > 0 ||
          recommendations.learningPath.nextSteps.length > 0) && (
          <div className="mb-4">
            <button
              onClick={() => toggleSection("learning")}
              className="w-full flex items-center justify-between text-left font-semibold text-lg text-blue-800 dark:text-blue-200 mb-2 hover:text-blue-900 dark:hover:text-blue-100"
            >
              <span>📚 Learning Path</span>
              <span>{expandedSections.learning ? "−" : "+"}</span>
            </button>
            {expandedSections.learning && (
              <div className="pl-4 border-l-2 border-blue-300 dark:border-blue-700">
                {recommendations.learningPath.suggestions.length > 0 && (
                  <div className="mb-3">
                    <p className="font-medium text-gray-800 dark:text-gray-200 mb-2">
                      Suggestions:
                    </p>
                    <ul className="space-y-1 text-gray-700 dark:text-gray-300">
                      {recommendations.learningPath.suggestions.map(
                        (suggestion, index) => (
                          <li key={index} className="flex items-start">
                            <span className="mr-2">•</span>
                            <span>{suggestion}</span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}
                {recommendations.learningPath.nextSteps.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-800 dark:text-gray-200 mb-2">
                      Next Steps:
                    </p>
                    <ul className="space-y-1 text-gray-700 dark:text-gray-300">
                      {recommendations.learningPath.nextSteps.map(
                        (step, index) => (
                          <li key={index} className="flex items-start">
                            <span className="mr-2">•</span>
                            <span>{step}</span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Personalized Tips */}
        {recommendations.personalizedTips.tips.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => toggleSection("tips")}
              className="w-full flex items-center justify-between text-left font-semibold text-lg text-blue-800 dark:text-blue-200 mb-2 hover:text-blue-900 dark:hover:text-blue-100"
            >
              <span>🌟 Personalized Tips</span>
              <span>{expandedSections.tips ? "−" : "+"}</span>
            </button>
            {expandedSections.tips && (
              <div className="pl-4 border-l-2 border-blue-300 dark:border-blue-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {recommendations.personalizedTips.basedOn}
                </p>
                <ul className="space-y-2 text-gray-700 dark:text-gray-300">
                  {recommendations.personalizedTips.tips.map((tip, index) => (
                    <li key={index} className="flex items-start">
                      <span className="mr-2">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison function to prevent unnecessary re-renders
    // Only re-render if recommendations actually changed
    return (
      prevProps.username === nextProps.username &&
      prevProps.recommendations.strategyTips.tips.length ===
        nextProps.recommendations.strategyTips.tips.length &&
      prevProps.recommendations.learningPath.suggestions.length ===
        nextProps.recommendations.learningPath.suggestions.length &&
      prevProps.recommendations.learningPath.nextSteps.length ===
        nextProps.recommendations.learningPath.nextSteps.length &&
      prevProps.recommendations.personalizedTips.tips.length ===
        nextProps.recommendations.personalizedTips.tips.length &&
      prevProps.onDismiss === nextProps.onDismiss
    );
  }
);

export default RecommendationsDisplay;
