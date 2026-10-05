import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { FeedbackStatsProps, StatsData } from "../types";
import { authFetch } from "../utils/authFetch";

const FeedbackStats: React.FC<FeedbackStatsProps> = ({ username }) => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<"daily" | "weekly" | "monthly">(
    "daily"
  );
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
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
        // API returns data in 'overall' property, map it to expected structure
        const overallStats = result.overall || {};
        const mappedStats = {
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
          categoryBreakdown: result.categories || {},
          userTypeBreakdown: {
            pro: overallStats.proUsers || 0,
            free: overallStats.freeUsers || 0,
          },
          timeRangeStats: {
            last24Hours: overallStats.last24Hours || 0,
            last7Days: overallStats.last7Days || 0,
            last30Days: overallStats.last30Days || 0,
          },
          responseStats: {
            totalResponses: overallStats.withResponses || 0,
            averageResponseTime: overallStats.avgResponseTime || 0,
            responseRate: overallStats.responseRate || 0,
          },
          trends: {
            daily: result.dailyTrends || [],
            weekly: result.weeklyTrends || [],
            monthly: result.monthlyTrends || [],
          },
        };
        setStats(mappedStats);
      } else {
        setError(result.error || "Failed to fetch statistics");
        toast.error(result.error || "Failed to fetch statistics");
      }
    } catch (error) {
      console.error("Error fetching statistics:", error);
      setError("Failed to fetch statistics");
      toast.error("Failed to fetch statistics");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    if (username) {
      fetchStats();
    }
  }, [username, fetchStats]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
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

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k";
    }
    return num.toString();
  };

  const formatTime = (hours: number) => {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
      return `${Math.round(hours)}h`;
    } else {
      return `${Math.round(hours / 24)}d`;
    }
  };

  if (!username) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">🔒</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Authentication Required
          </h3>
          <p className="text-gray-600">Please log in to access statistics.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading statistics...</p>
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
            Error Loading Statistics
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
          <p className="text-gray-300">No statistics data found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Feedback Statistics
            </h1>
            <p className="text-gray-300 mt-1">
              Detailed analytics and insights
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

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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
                {formatNumber(stats.totalFeedback)}
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
                {formatNumber(stats.resolved)}
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
                {formatTime(stats.responseStats.averageResponseTime)}
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
                {stats.responseStats.responseRate.toFixed(1)}%
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
                {stats.timeRangeStats.last24Hours}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Last 7 Days</span>
              <span className="font-semibold text-gray-900">
                {stats.timeRangeStats.last7Days}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Last 30 Days</span>
              <span className="font-semibold text-gray-900">
                {stats.timeRangeStats.last30Days}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Priority Distribution
          </h3>
          <div className="space-y-3">
            {[
              {
                priority: "Critical",
                count: stats.criticalPriority,
                color: "bg-red-500",
              },
              {
                priority: "High",
                count: stats.highPriority,
                color: "bg-orange-500",
              },
              {
                priority: "Medium",
                count: stats.mediumPriority,
                color: "bg-yellow-500",
              },
              {
                priority: "Low",
                count: stats.lowPriority,
                color: "bg-green-500",
              },
            ].map((item) => (
              <div
                key={item.priority}
                className="flex items-center justify-between"
              >
                <span className="text-sm text-gray-700">{item.priority}</span>
                <div className="flex items-center">
                  <div className="w-20 bg-gray-200 rounded-full h-2 mr-3">
                    <div
                      className={`h-2 rounded-full ${item.color}`}
                      style={{
                        width: `${(item.count / stats.totalFeedback) * 100}%`,
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

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            User Type Distribution
          </h3>
          <div className="space-y-3">
            {Object.entries(stats.userTypeBreakdown).map(
              ([userType, count]) => (
                <div
                  key={userType}
                  className="flex items-center justify-between"
                >
                  <span className="text-sm text-gray-700 capitalize">
                    {userType} Users
                  </span>
                  <div className="flex items-center">
                    <div className="w-20 bg-gray-200 rounded-full h-2 mr-3">
                      <div
                        className={`h-2 rounded-full ${
                          userType === "pro" ? "bg-green-500" : "bg-blue-500"
                        }`}
                        style={{
                          width: `${(count / stats.totalFeedback) * 100}%`,
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
      </div>

      {/* Category Breakdown */}
      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Category Breakdown
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(stats.categoryBreakdown).map(([category, count]) => (
            <div
              key={category}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{getCategoryIcon(category)}</span>
                <span className="text-sm font-medium text-gray-700 capitalize">
                  {category.replace("_", " ")}
                </span>
              </div>
              <div className="flex items-center">
                <div className="w-16 bg-gray-200 rounded-full h-2 mr-3">
                  <div
                    className="h-2 rounded-full bg-blue-500"
                    style={{ width: `${(count / stats.totalFeedback) * 100}%` }}
                  ></div>
                </div>
                <span className="text-sm font-medium text-gray-900 w-8 text-right">
                  {count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trends Chart */}
      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Feedback Trends
          </h3>
          <div className="flex space-x-2">
            {[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value as any)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  timeRange === option.value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-64 flex items-end justify-between space-x-2">
          {stats.trends[timeRange].map((item, index) => {
            const maxCount = Math.max(
              ...stats.trends[timeRange].map((t) => t.count)
            );
            const height = (item.count / maxCount) * 100;

            return (
              <div key={index} className="flex flex-col items-center flex-1">
                <div
                  className="w-full bg-blue-500 rounded-t-md transition-all duration-300 hover:bg-blue-600"
                  style={{ height: `${height}%` }}
                  title={`${item.count} feedback`}
                ></div>
                <div className="text-xs text-gray-500 mt-2 text-center">
                  {timeRange === "daily"
                    ? (item as any).date.split("-")[2]
                    : timeRange === "weekly"
                    ? (item as any).week
                    : (item as any).month}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 text-center">
          <span className="text-sm text-gray-600">
            Showing {stats.trends[timeRange].length} {timeRange} periods
          </span>
        </div>
      </div>
    </div>
  );
};

export default FeedbackStats;
