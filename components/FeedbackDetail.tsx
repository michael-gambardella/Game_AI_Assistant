import React, { useState } from "react";
import toast from "react-hot-toast";
import { FeedbackDetailProps, Feedback } from "../types";
import { authFetch } from "../utils/authFetch";

const FeedbackDetail: React.FC<FeedbackDetailProps> = ({
  feedback,
  username,
  onClose,
  onStatusUpdate,
  onResponseSubmit,
}) => {
  const [adminResponse, setAdminResponse] = useState("");
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

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
        return "text-green-600 bg-green-100";
      case "medium":
        return "text-yellow-600 bg-yellow-100";
      case "high":
        return "text-orange-600 bg-orange-100";
      case "critical":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
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
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (!username) return;

    setIsUpdatingStatus(true);

    try {
      const response = await authFetch("/api/feedback/admin/update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feedbackId: feedback.feedbackId,
          status: newStatus,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success("Status updated successfully");
        onStatusUpdate?.();
      } else {
        toast.error(result.error || "Failed to update status");
      }
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleResponseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !adminResponse.trim()) return;

    setIsSubmittingResponse(true);

    try {
      const response = await authFetch("/api/feedback/admin/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feedbackId: feedback.feedbackId,
          adminResponse: adminResponse.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success("Response submitted successfully");
        setAdminResponse("");
        // Update the feedback prop with the new response
        feedback.adminResponse = adminResponse.trim();
        feedback.adminResponseBy = username;
        feedback.adminResponseAt = new Date();
        onResponseSubmit?.();
      } else {
        toast.error(result.error || "Failed to submit response");
      }
    } catch (error) {
      console.error("Error submitting response:", error);
      toast.error("Failed to submit response");
    } finally {
      setIsSubmittingResponse(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">
              {getCategoryIcon(feedback.category)}
            </span>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {feedback.title}
              </h2>
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
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg
              className="w-6 h-6"
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

        <div className="p-6">
          {/* Status and Priority */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-700">
                  Status:
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                    feedback.status
                  )}`}
                >
                  {feedback.status.replace("_", " ").toUpperCase()}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-700">
                  Priority:
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${getPriorityColor(
                    feedback.priority
                  )}`}
                >
                  {feedback.priority.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Status Update Dropdown */}
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">
                Update Status:
              </span>
              <select
                value={feedback.status}
                onChange={(e) => handleStatusUpdate(e.target.value)}
                disabled={isUpdatingStatus}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 bg-white text-gray-900"
                style={{ color: "#111827", backgroundColor: "#ffffff" }}
              >
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
          </div>

          {/* Feedback Content */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Feedback Message
            </h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-gray-700 whitespace-pre-wrap">
                {feedback.message}
              </p>
            </div>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                Submission Details
              </h4>
              <div className="space-y-2 text-sm text-gray-600">
                <div>Created: {formatDate(feedback.createdAt)}</div>
                <div>Updated: {formatDate(feedback.updatedAt)}</div>
                <div>
                  Category: {feedback.category.replace("_", " ").toUpperCase()}
                </div>
                <div>Email: {feedback.email}</div>
              </div>
            </div>
          </div>

          {/* Admin Response Section */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Admin Response
            </h3>

            {/* Existing Response */}
            {feedback.adminResponse ? (
              <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-md">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-900">
                    Previous Response
                    {feedback.adminResponseBy && (
                      <span className="text-blue-700 ml-1">
                        by {feedback.adminResponseBy}
                      </span>
                    )}
                  </span>
                  {feedback.adminResponseAt && (
                    <span className="text-xs text-blue-600">
                      {formatDate(feedback.adminResponseAt.toString())}
                    </span>
                  )}
                </div>
                <p className="text-blue-800 whitespace-pre-wrap">
                  {feedback.adminResponse}
                </p>
              </div>
            ) : (
              <div className="mb-6 p-4 bg-gray-50 rounded-md">
                <p className="text-gray-600 text-sm">No response yet</p>
              </div>
            )}

            {/* Response Form */}
            <form onSubmit={handleResponseSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="adminResponse"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  {feedback.adminResponse ? "Update Response" : "Add Response"}
                </label>
                <textarea
                  id="adminResponse"
                  value={adminResponse}
                  onChange={(e) => setAdminResponse(e.target.value)}
                  placeholder="Enter your response to this feedback..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingResponse || !adminResponse.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
                >
                  {isSubmittingResponse ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Submitting...
                    </div>
                  ) : feedback.adminResponse ? (
                    "Update Response"
                  ) : (
                    "Submit Response"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbackDetail;
