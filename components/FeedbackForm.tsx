import React, { useState } from "react";
import toast from "react-hot-toast";
import axios from "../utils/axiosConfig";
import { trackFeedbackSubmitted } from "../utils/analytics";
import { FeedbackFormProps, FeedbackFormData } from "../types";

const FeedbackForm: React.FC<FeedbackFormProps> = ({
  username,
  userType,
  onFeedbackSubmitted,
}) => {
  const [formData, setFormData] = useState<FeedbackFormData>({
    category: "general",
    title: "",
    message: "",
    priority: "medium",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username) {
      toast.error("Please log in to submit feedback");
      return;
    }

    if (!formData.title.trim() || !formData.message.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (formData.message.length < 10) {
      toast.error("Message must be at least 10 characters long");
      return;
    }

    setIsSubmitting(true);

    try {
      // Fetch user's email from account data
      // Identified by auth cookie; shared axios instance refreshes an expired token
      let userEmail: string;
      try {
        const { data: accountData } = await axios.post("/api/accountData");
        userEmail = accountData.user.email;
      } catch {
        throw new Error("Failed to fetch user email");
      }

      const response = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email: userEmail,
          userType,
          category: formData.category,
          title: formData.title.trim(),
          message: formData.message.trim(),
          priority: formData.priority,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success(
          "Feedback submitted successfully! Thank you for your input."
        );
        // Track feedback submission
        trackFeedbackSubmitted(formData.category, formData.priority);
        setFormData({
          category: "general",
          title: "",
          message: "",
          priority: "medium",
        });
        onFeedbackSubmitted?.();
      } else {
        toast.error(result.error || "Failed to submit feedback");
      }
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast.error("Failed to submit feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoryOptions = [
    {
      value: "bug_report",
      label: "🐛 Bug Report",
      description: "Report a bug or issue",
    },
    {
      value: "feature_request",
      label: "💡 Feature Request",
      description: "Suggest a new feature",
    },
    {
      value: "improvement",
      label: "⚡ Improvement",
      description: "Suggest an improvement",
    },
    {
      value: "general",
      label: "💬 General Feedback",
      description: "General comments or suggestions",
    },
    {
      value: "privacy_inquiry",
      label: "🔒 Privacy Inquiry",
      description: "Questions about privacy policy or data practices",
    },
    {
      value: "data_request",
      label: "📋 Data Request",
      description: "Request data deletion, access, or modification",
    },
    {
      value: "legal_matter",
      label: "⚖️ Legal Matter",
      description: "Legal questions or formal notices",
    },
    {
      value: "account_issue",
      label: "👤 Account Issue",
      description: "Problems with account access or settings",
    },
    {
      value: "subscription_issue",
      label: "💳 Subscription Issue",
      description: "Billing, subscription, or payment problems",
    },
    {
      value: "complaint",
      label: "😞 Complaint",
      description: "Report a problem or concern",
    },
    {
      value: "praise",
      label: "⭐ Praise",
      description: "Share positive feedback",
    },
  ];

  const priorityOptions = [
    { value: "low", label: "Low", color: "text-green-600" },
    { value: "medium", label: "Medium", color: "text-yellow-600" },
    { value: "high", label: "High", color: "text-orange-600" },
    { value: "critical", label: "Critical", color: "text-red-600" },
  ];

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Submit Feedback
        </h2>
        <p className="text-gray-600">
          Help us improve Video Game Wingman by sharing your thoughts, reporting
          bugs, or suggesting new features.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Category Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Category *
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {categoryOptions.map((option) => (
              <label
                key={option.value}
                className={`relative flex items-center p-4 border rounded-lg cursor-pointer transition-all ${
                  formData.category === option.value
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="radio"
                  name="category"
                  value={option.value}
                  checked={formData.category === option.value}
                  onChange={handleInputChange}
                  className="sr-only"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">
                    {option.label}
                  </div>
                  <div className="text-sm text-gray-500">
                    {option.description}
                  </div>
                </div>
                {formData.category === option.value && (
                  <div className="absolute top-2 right-2">
                    <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  </div>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Title *
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleInputChange}
            placeholder="Brief description of your feedback"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            maxLength={200}
            required
          />
          <div className="text-xs text-gray-500 mt-1">
            {formData.title.length}/200 characters
          </div>
        </div>

        {/* Message */}
        <div>
          <label
            htmlFor="message"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Message *
          </label>
          <textarea
            id="message"
            name="message"
            value={formData.message}
            onChange={handleInputChange}
            placeholder="Please provide detailed feedback..."
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            minLength={10}
            maxLength={2000}
            required
          />
          <div className="text-xs text-gray-500 mt-1">
            {formData.message.length}/2000 characters (minimum 10)
          </div>
        </div>

        {/* Priority */}
        <div>
          <label
            htmlFor="priority"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Priority
          </label>
          <select
            id="priority"
            name="priority"
            value={formData.priority}
            onChange={handleInputChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 appearance-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
              backgroundPosition: "right 0.5rem center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "1.5em 1.5em",
              paddingRight: "2.5rem",
            }}
          >
            {priorityOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className="text-gray-900 bg-white"
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={
              isSubmitting || !formData.title.trim() || !formData.message.trim()
            }
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Submitting...
              </div>
            ) : (
              "Submit Feedback"
            )}
          </button>
        </div>
      </form>

      {/* User Type Indicator */}
      <div className="mt-4 p-3 bg-gray-50 rounded-md">
        <div className="flex items-center text-sm text-gray-600">
          <span className="font-medium">Account Type:</span>
          <span
            className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
              userType === "pro"
                ? "bg-green-100 text-green-800"
                : "bg-blue-100 text-blue-800"
            }`}
          >
            {userType === "pro" ? "Pro User" : "Free User"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default FeedbackForm;
