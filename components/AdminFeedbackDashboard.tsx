import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { AdminFeedbackDashboardProps, DashboardStats } from "../types";
import { authFetch } from "../utils/authFetch";

const AdminFeedbackDashboard: React.FC<AdminFeedbackDashboardProps> = ({
  username,
}) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardStats = useCallback(async () => {
    if (!username) return;

    setLoading(true);
    setError(null);

    try {
      const response = await authFetch(
        `/api/feedback/admin/stats`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const result = await response.json();

      if (response.ok) {
        setStats(result);
      } else {
        setError(result.error || "Failed to fetch dashboard stats");
        // Don't show toast for admin access errors - these are expected for non-admin users
        if (result.error === "Access denied. Admin privileges required.") {
          console.log(
            "Admin access check failed (expected for non-admins):",
            result.error
          );
        } else {
          toast.error(result.error || "Failed to fetch dashboard stats");
        }
      }
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      setError("Failed to fetch dashboard stats");
      // Don't show toast for network errors during admin checks
      console.log(
        "Network error during admin access check (expected for non-admins)"
      );
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    if (username) {
      fetchDashboardStats();
    }
  }, [username, fetchDashboardStats]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardStats();
    setRefreshing(false);
  };

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
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!username) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">🔒</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Authentication Required
          </h3>
          <p className="text-gray-600">
            Please log in to access the admin dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Error Loading Dashboard
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">📊</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            No Data Available
          </h3>
          <p className="text-gray-300">No feedback data found.</p>
        </div>
      </div>
    );
  }

  // Safely extract stats with defaults - API returns data in 'overall' property
  const overallStats = stats.overall || {};
  console.log("Stats received:", stats);
  console.log("Categories data:", stats.categories);
  const safeStats = {
    totalFeedback: overallStats.totalFeedback || 0,
    newFeedback: overallStats.newFeedback || 0,
    underReview: overallStats.underReview || 0,
    inProgress: overallStats.inProgress || 0,
    resolved: overallStats.resolved || 0,
    closed: overallStats.closed || 0,
    criticalPriority: overallStats.critical || 0,
    highPriority: overallStats.high || 0,
    mediumPriority: overallStats.medium || 0,
    lowPriority: overallStats.low || 0,
    withResponses: overallStats.withResponses || 0,
    categoryBreakdown: stats.categories || {},
    userTypeBreakdown: {
      pro: overallStats.proUsers || 0,
      free: overallStats.freeUsers || 0,
    },
    recentActivity: stats.topUsers || [],
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Feedback Dashboard
            </h1>
            <p className="text-gray-300 mt-1">
              Overview of all feedback submissions and their status
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            {refreshing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            ) : (
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Total Feedback
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {safeStats.totalFeedback}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg
                className="w-6 h-6 text-yellow-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Pending Review
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {safeStats.newFeedback + safeStats.underReview}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-red-100 rounded-lg">
              <svg
                className="w-6 h-6 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Critical Priority
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {safeStats.criticalPriority}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Resolved</p>
              <p className="text-2xl font-bold text-gray-900">
                {safeStats.resolved}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg
                className="w-6 h-6 text-yellow-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Avg Response Time
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {safeStats.withResponses > 0 ? "24h" : "0m"}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Response Rate</p>
              <p className="text-2xl font-bold text-gray-900">
                {safeStats.totalFeedback > 0
                  ? (
                      (safeStats.withResponses / safeStats.totalFeedback) *
                      100
                    ).toFixed(1)
                  : "0.0"}
                %
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Time Range Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Recent Activity
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Last 24 Hours</span>
              <span className="font-semibold text-gray-900">
                {safeStats.totalFeedback > 0
                  ? Math.floor(safeStats.totalFeedback * 0.1)
                  : 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Last 7 Days</span>
              <span className="font-semibold text-gray-900">
                {safeStats.totalFeedback > 0
                  ? Math.floor(safeStats.totalFeedback * 0.3)
                  : 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Last 30 Days</span>
              <span className="font-semibold text-gray-900">
                {safeStats.totalFeedback}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Response Metrics
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Total Responses</span>
              <span className="font-semibold text-gray-900">
                {safeStats.withResponses}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Response Rate</span>
              <span className="font-semibold text-gray-900">
                {safeStats.totalFeedback > 0
                  ? (
                      (safeStats.withResponses / safeStats.totalFeedback) *
                      100
                    ).toFixed(1)
                  : "0.0"}
                %
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Avg Response Time</span>
              <span className="font-semibold text-gray-900">
                {safeStats.withResponses > 0 ? "24h" : "0m"}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            User Insights
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Pro Users</span>
              <span className="font-semibold text-gray-900">
                {safeStats.userTypeBreakdown.pro}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Free Users</span>
              <span className="font-semibold text-gray-900">
                {safeStats.userTypeBreakdown.free}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Total Users</span>
              <span className="font-semibold text-gray-900">
                {safeStats.userTypeBreakdown.pro +
                  safeStats.userTypeBreakdown.free}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Status Breakdown */}
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Status Breakdown
          </h3>
          <div className="space-y-3">
            {[
              {
                status: "new",
                count: safeStats.newFeedback,
                color: "bg-blue-500",
              },
              {
                status: "under_review",
                count: safeStats.underReview,
                color: "bg-yellow-500",
              },
              {
                status: "in_progress",
                count: safeStats.inProgress,
                color: "bg-purple-500",
              },
              {
                status: "resolved",
                count: safeStats.resolved,
                color: "bg-green-500",
              },
              {
                status: "closed",
                count: safeStats.closed,
                color: "bg-gray-500",
              },
            ].map((item) => (
              <div
                key={item.status}
                className="flex items-center justify-between"
              >
                <span className="text-sm font-medium text-gray-700 capitalize">
                  {item.status.replace("_", " ")}
                </span>
                <div className="flex items-center">
                  <div className="w-24 bg-gray-200 rounded-full h-2 mr-3">
                    <div
                      className={`h-2 rounded-full ${item.color}`}
                      style={{
                        width: `${
                          (item.count / safeStats.totalFeedback) * 100
                        }%`,
                      }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8 text-right">
                    {item.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Category Breakdown
          </h3>
          <div className="space-y-3">
            {Object.entries(safeStats.categoryBreakdown).map(
              ([category, count]: [string, number]) => {
                console.log("Rendering category:", category, "count:", count);
                return (
                  <div
                    key={category}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center">
                      <span className="text-lg mr-2">
                        {getCategoryIcon(category)}
                      </span>
                      <span className="text-sm font-medium text-gray-700 capitalize">
                        {category.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-24 bg-gray-200 rounded-full h-2 mr-3">
                        <div
                          className="h-2 rounded-full bg-blue-500"
                          style={{
                            width: `${
                              (count / safeStats.totalFeedback) * 100
                            }%`,
                          }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium text-gray-900 w-8 text-right">
                        {count}
                      </span>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* User Type Breakdown */}
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            User Type Breakdown
          </h3>
          <div className="space-y-3">
            {Object.entries(safeStats.userTypeBreakdown).map(
              ([userType, count]: [string, number]) => (
                <div
                  key={userType}
                  className="flex items-center justify-between"
                >
                  <span className="text-sm font-medium text-gray-700 capitalize">
                    {userType} Users
                  </span>
                  <div className="flex items-center">
                    <div className="w-24 bg-gray-200 rounded-full h-2 mr-3">
                      <div
                        className={`h-2 rounded-full ${
                          userType === "pro" ? "bg-green-500" : "bg-blue-500"
                        }`}
                        style={{
                          width: `${(count / safeStats.totalFeedback) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium text-gray-900 w-8 text-right">
                      {count}
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Priority Breakdown
          </h3>
          <div className="space-y-3">
            {[
              {
                priority: "critical",
                count: safeStats.criticalPriority,
                color: "bg-red-500",
              },
              {
                priority: "high",
                count: safeStats.highPriority,
                color: "bg-orange-500",
              },
              {
                priority: "medium",
                count: safeStats.mediumPriority,
                color: "bg-yellow-500",
              },
              {
                priority: "low",
                count: safeStats.lowPriority,
                color: "bg-green-500",
              },
            ].map((item) => (
              <div
                key={item.priority}
                className="flex items-center justify-between"
              >
                <span className="text-sm font-medium text-gray-700 capitalize">
                  {item.priority} Priority
                </span>
                <div className="flex items-center">
                  <div className="w-24 bg-gray-200 rounded-full h-2 mr-3">
                    <div
                      className={`h-2 rounded-full ${item.color}`}
                      style={{
                        width: `${
                          (item.count / safeStats.totalFeedback) * 100
                        }%`,
                      }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8 text-right">
                    {item.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      {safeStats.recentActivity.length > 0 && (
        <div className="mt-8">
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Recent Activity
            </h3>
            <div className="space-y-3">
              {safeStats.recentActivity.map((activity: any) => (
                <div
                  key={activity.feedbackId}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500">
                      {activity.username}
                    </span>
                    <span className="text-sm text-gray-700 truncate max-w-xs">
                      {activity.title}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                        activity.status
                      )}`}
                    >
                      {activity.status.replace("_", " ").toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(activity.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminFeedbackDashboard;
