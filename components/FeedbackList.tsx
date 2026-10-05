import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { FeedbackListProps, Feedback } from "../types";
import { authFetch } from "../utils/authFetch";

const FeedbackList: React.FC<FeedbackListProps> = ({
  username,
  onFeedbackSelect,
}) => {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: "all",
    category: "all",
    priority: "all",
    userType: "all",
    search: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<
    "createdAt" | "updatedAt" | "priority" | "status"
  >("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const itemsPerPage = 10;

  // Handle search button click
  const handleSearch = () => {
    setFilters((prev) => ({ ...prev, search: searchQuery }));
    setCurrentPage(1); // Reset to first page when searching
  };

  const handleClearAllFilters = () => {
    setSearchQuery("");
    setFilters({
      status: "all",
      category: "all",
      priority: "all",
      userType: "all",
      search: "",
    });
    setCurrentPage(1);
    // The fetchFeedbacks will be triggered by the useEffect when filters change
  };

  const fetchFeedbacks = useCallback(async () => {
    if (!username) return;

    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        sortBy,
        sortOrder,
      });

      // Only add filter parameters if they have meaningful values
      if (filters.status && filters.status !== "all") {
        queryParams.append("status", filters.status);
      }
      if (filters.category && filters.category !== "all") {
        queryParams.append("category", filters.category);
      }
      if (filters.priority && filters.priority !== "all") {
        queryParams.append("priority", filters.priority);
      }
      if (filters.userType && filters.userType !== "all") {
        queryParams.append("userType", filters.userType);
      }
      if (filters.search && filters.search.trim() !== "") {
        queryParams.append("search", filters.search.trim());
      }

      const response = await authFetch(`/api/feedback/admin/all?${queryParams}`);
      const result = await response.json();

      if (response.ok) {
        setFeedbacks(result.feedbacks || []);
        setTotalPages(Math.ceil((result.total || 0) / itemsPerPage));
      } else {
        setError(result.error || "Failed to fetch feedback");
        // Don't show toast for admin access errors - these are expected for non-admin users
        if (result.error === "Access denied. Admin privileges required.") {
          // console.log(
          //   "Admin access check failed (expected for non-admins):",
          //   result.error
          // ); // Commented out for production
        } else {
          toast.error(result.error || "Failed to fetch feedback");
        }
      }
    } catch (error) {
      console.error("Error fetching feedback:", error);
      setError("Failed to fetch feedback");
      // Don't show toast for network errors during admin checks
      // console.log(
      //   "Network error during admin access check (expected for non-admins)"
      // ); // Commented out for production
    } finally {
      setLoading(false);
    }
  }, [
    username,
    currentPage,
    sortBy,
    sortOrder,
    filters.status,
    filters.category,
    filters.priority,
    filters.userType,
    filters.search,
  ]);

  useEffect(() => {
    if (username) {
      fetchFeedbacks();
    }
  }, [username, fetchFeedbacks]);

  // Trigger fetch when filters change
  useEffect(() => {
    if (username) {
      fetchFeedbacks();
    }
  }, [username, filters, currentPage, sortBy, sortOrder, fetchFeedbacks]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleSortChange = (newSortBy: typeof sortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(newSortBy);
      setSortOrder("desc");
    }
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
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleStatusUpdate = async (feedbackId: string, newStatus: string) => {
    try {
      const response = await authFetch("/api/feedback/admin/update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feedbackId,
          status: newStatus,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success("Status updated successfully");
        fetchFeedbacks(); // Refresh the list
      } else {
        toast.error(result.error || "Failed to update status");
      }
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    }
  };

  if (!username) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">🔒</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            Authentication Required
          </h3>
          <p className="text-gray-300">
            Please log in to access the feedback list.
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
          <p className="text-gray-300">Loading feedback...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            Error Loading Feedback
          </h3>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={fetchFeedbacks}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">All Feedback</h2>
        <p className="text-gray-300">
          Manage and review all feedback submissions
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange("status", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
              style={{ color: "#111827", backgroundColor: "#ffffff" }}
            >
              <option value="all" className="text-gray-900 bg-white">
                All Status
              </option>
              <option value="new" className="text-gray-900 bg-white">
                New
              </option>
              <option value="under_review" className="text-gray-900 bg-white">
                Under Review
              </option>
              <option value="in_progress" className="text-gray-900 bg-white">
                In Progress
              </option>
              <option value="resolved" className="text-gray-900 bg-white">
                Resolved
              </option>
              <option value="closed" className="text-gray-900 bg-white">
                Closed
              </option>
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category
            </label>
            <select
              value={filters.category}
              onChange={(e) => handleFilterChange("category", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
              style={{ color: "#111827", backgroundColor: "#ffffff" }}
            >
              <option value="all" className="text-gray-900 bg-white">
                All Categories
              </option>
              <option value="bug_report" className="text-gray-900 bg-white">
                🐛 Bug Report
              </option>
              <option
                value="feature_request"
                className="text-gray-900 bg-white"
              >
                💡 Feature Request
              </option>
              <option value="improvement" className="text-gray-900 bg-white">
                ⚡ Improvement
              </option>
              <option value="general" className="text-gray-900 bg-white">
                💬 General
              </option>
              <option value="privacy_inquiry" className="text-gray-900 bg-white">
                🔒 Privacy Inquiry
              </option>
              <option value="data_request" className="text-gray-900 bg-white">
                📋 Data Request
              </option>
              <option value="legal_matter" className="text-gray-900 bg-white">
                ⚖️ Legal Matter
              </option>
              <option value="account_issue" className="text-gray-900 bg-white">
                👤 Account Issue
              </option>
              <option value="subscription_issue" className="text-gray-900 bg-white">
                💳 Subscription Issue
              </option>
              <option value="complaint" className="text-gray-900 bg-white">
                😞 Complaint
              </option>
              <option value="praise" className="text-gray-900 bg-white">
                ⭐ Praise
              </option>
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Priority
            </label>
            <select
              value={filters.priority}
              onChange={(e) => handleFilterChange("priority", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
              style={{ color: "#111827", backgroundColor: "#ffffff" }}
            >
              <option value="all" className="text-gray-900 bg-white">
                All Priorities
              </option>
              <option value="critical" className="text-gray-900 bg-white">
                Critical
              </option>
              <option value="high" className="text-gray-900 bg-white">
                High
              </option>
              <option value="medium" className="text-gray-900 bg-white">
                Medium
              </option>
              <option value="low" className="text-gray-900 bg-white">
                Low
              </option>
            </select>
          </div>

          {/* User Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              User Type
            </label>
            <select
              value={filters.userType}
              onChange={(e) => handleFilterChange("userType", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
              style={{ color: "#111827", backgroundColor: "#ffffff" }}
            >
              <option value="all" className="text-gray-900 bg-white">
                All Users
              </option>
              <option value="pro" className="text-gray-900 bg-white">
                Pro Users
              </option>
              <option value="free" className="text-gray-900 bg-white">
                Free Users
              </option>
            </select>
          </div>

          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder-gray-500"
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
        </div>

        {/* Search Button Row */}
        <div className="flex justify-end mt-4">
          <div className="flex space-x-2">
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Search
            </button>
            <button
              onClick={handleClearAllFilters}
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors text-sm font-medium"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-300">Sort by:</span>
          {[
            { key: "createdAt", label: "Date Created" },
            { key: "updatedAt", label: "Last Updated" },
            { key: "priority", label: "Priority" },
            { key: "status", label: "Status" },
          ].map((option) => (
            <button
              key={option.key}
              onClick={() => handleSortChange(option.key as typeof sortBy)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                sortBy === option.key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {option.label}
              {sortBy === option.key && (
                <span className="ml-1">{sortOrder === "asc" ? "↑" : "↓"}</span>
              )}
            </button>
          ))}
        </div>
        <div className="text-sm text-gray-300">
          {feedbacks.length} feedback{" "}
          {feedbacks.length === 1 ? "item" : "items"}
        </div>
      </div>

      {/* Feedback List */}
      {feedbacks.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            No Feedback Found
          </h3>
          <p className="text-gray-300">
            No feedback matches your current filters. Try adjusting your search
            criteria.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {feedbacks.map((feedback) => (
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
                      <span className="text-sm text-gray-600">
                        by {feedback.username}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          feedback.userType === "pro"
                            ? "bg-green-100 text-green-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {feedback.userType.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
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
                    {feedback.priority.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-gray-700 line-clamp-3">{feedback.message}</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <span>Created: {formatDate(feedback.createdAt)}</span>
                  {feedback.updatedAt !== feedback.createdAt && (
                    <span>Updated: {formatDate(feedback.updatedAt)}</span>
                  )}
                  {!feedback.metadata.isRead && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                      NEW
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <select
                    value={feedback.status}
                    onChange={(e) =>
                      handleStatusUpdate(feedback.feedbackId, e.target.value)
                    }
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                    style={{ color: "#111827", backgroundColor: "#ffffff" }}
                  >
                    <option value="new" className="text-gray-900 bg-white">
                      New
                    </option>
                    <option
                      value="under_review"
                      className="text-gray-900 bg-white"
                    >
                      Under Review
                    </option>
                    <option
                      value="in_progress"
                      className="text-gray-900 bg-white"
                    >
                      In Progress
                    </option>
                    <option value="resolved" className="text-gray-900 bg-white">
                      Resolved
                    </option>
                    <option value="closed" className="text-gray-900 bg-white">
                      Closed
                    </option>
                  </select>
                  <button
                    onClick={() => onFeedbackSelect?.(feedback)}
                    className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
                  >
                    View Details
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center mt-8">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = i + 1;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-2 border rounded-md text-sm font-medium ${
                    currentPage === page
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {page}
                </button>
              );
            })}

            <button
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={currentPage === totalPages}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedbackList;
