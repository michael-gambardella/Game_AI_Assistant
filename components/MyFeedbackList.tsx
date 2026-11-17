import React, { useState, useEffect, useCallback } from "react";
import { MyFeedbackListProps, Feedback } from "../types";
import { authFetch } from "../utils/authFetch";

const MyFeedbackList: React.FC<MyFeedbackListProps> = ({ username }) => {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "new" | "under_review" | "in_progress" | "resolved" | "closed"
  >("all");

  const fetchMyFeedback = useCallback(async () => {
    if (!username) return;

    setLoading(true);
    setError(null);

    try {
      const response = await authFetch(
        `/api/feedback/my-feedback`
      );
      const result = await response.json();

      if (response.ok) {
        setFeedbacks(result.feedback || []);
      } else {
        setError(result.error || "Failed to fetch feedback");
      }
    } catch (error) {
      console.error("Error fetching feedback:", error);
      setError("Failed to fetch feedback");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    if (username) {
      fetchMyFeedback();
    }
  }, [username, fetchMyFeedback]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "new":
        return "bg-blue-100 text-blue-800";
      case "under_review":
        return "bg-yellow-100 text-yellow-800";
      case "in_progress":
        return "bg-purple-100 text-purple-800";
      case "resolved":
        return "bg-green-100 text-green-800";
      case "closed":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "low":
        return "text-green-600";
      case "medium":
        return "text-yellow-600";
      case "high":
        return "text-orange-600";
      case "critical":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "bug_report":
        return "🐛";
      case "feature_request":
        return "💡";
      case "improvement":
        return "⚡";
      case "general":
        return "💬";
      case "privacy_inquiry":
        return "🔒";
      case "data_request":
        return "📋";
      case "legal_matter":
        return "⚖️";
      case "account_issue":
        return "👤";
      case "subscription_issue":
        return "💳";
      case "complaint":
        return "😞";
      case "praise":
        return "⭐";
      default:
        return "📝";
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filteredFeedbacks = feedbacks.filter(
    (feedback) => filter === "all" || feedback.status === filter
  );

  if (!username) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">🔒</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            Authentication Required
          </h3>
          <p className="text-gray-300">
            Please log in to view your feedback submissions.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading your feedback...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            Error Loading Feedback
          </h3>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={fetchMyFeedback}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">My Feedback</h2>
        <p className="text-gray-300">
          Track the status of your feedback submissions and responses from our
          team.
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {[
            { value: "all", label: "All", count: feedbacks.length },
            {
              value: "new",
              label: "New",
              count: feedbacks.filter((f) => f.status === "new").length,
            },
            {
              value: "under_review",
              label: "Under Review",
              count: feedbacks.filter((f) => f.status === "under_review")
                .length,
            },
            {
              value: "in_progress",
              label: "In Progress",
              count: feedbacks.filter((f) => f.status === "in_progress").length,
            },
            {
              value: "resolved",
              label: "Resolved",
              count: feedbacks.filter((f) => f.status === "resolved").length,
            },
            {
              value: "closed",
              label: "Closed",
              count: feedbacks.filter((f) => f.status === "closed").length,
            },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value as any)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                filter === tab.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {/* Feedback List */}
      {filteredFeedbacks.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            {filter === "all"
              ? "No Feedback Submitted"
              : `No ${filter.replace("_", " ")} Feedback`}
          </h3>
          <p className="text-gray-300">
            {filter === "all"
              ? "You haven't submitted any feedback yet. Share your thoughts to help us improve!"
              : `You don't have any feedback with status "${filter.replace(
                  "_",
                  " "
                )}" yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFeedbacks.map((feedback) => (
            <div
              key={feedback.feedbackId}
              className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">
                    {getCategoryIcon(feedback.category)}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {feedback.title}
                    </h3>
                    <div className="flex items-center space-x-4 mt-1">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                          feedback.status
                        )}`}
                      >
                        {feedback.status.replace("_", " ").toUpperCase()}
                      </span>
                      <span
                        className={`text-sm font-medium ${getPriorityColor(
                          feedback.priority
                        )}`}
                      >
                        {feedback.priority.toUpperCase()} Priority
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <div>Submitted</div>
                  <div>{formatDate(feedback.createdAt)}</div>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-gray-700 whitespace-pre-wrap">
                  {feedback.message}
                </p>
              </div>

              {/* Admin Response */}
              {feedback.adminResponse && (
                <div className="mt-4 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-md">
                  <div className="flex items-center mb-2">
                    <div className="w-2 h-2 bg-blue-400 rounded-full mr-2"></div>
                    <span className="text-sm font-medium text-blue-900">
                      Admin Response
                      {feedback.adminResponseBy && (
                        <span className="text-blue-700 ml-1">
                          by {feedback.adminResponseBy}
                        </span>
                      )}
                    </span>
                    {feedback.adminResponseAt && (
                      <span className="text-xs text-blue-600 ml-auto">
                        {formatDate(feedback.adminResponseAt.toString())}
                      </span>
                    )}
                  </div>
                  <p className="text-blue-800 whitespace-pre-wrap">
                    {feedback.adminResponse}
                  </p>
                </div>
              )}

              {/* Last Updated */}
              {feedback.updatedAt !== feedback.createdAt && (
                <div className="text-xs text-gray-500 mt-2">
                  Last updated: {formatDate(feedback.updatedAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Refresh Button */}
      <div className="mt-6 text-center">
        <button
          onClick={fetchMyFeedback}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
};

export default MyFeedbackList;
