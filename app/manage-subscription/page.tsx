"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SubscriptionData } from "../../types";
import { authFetch } from "../../utils/authFetch";

export default function ManageSubscriptionPage() {
  const router = useRouter();
  const [subscriptionData, setSubscriptionData] =
    useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);

  useEffect(() => {
    const fetchSubscriptionData = async () => {
      try {
        setLoading(true);
        const username = localStorage.getItem("username");

        if (!username) {
          setError("No user found. Please sign in.");
          return;
        }

        // Fetch subscription status
        const response = await authFetch("/api/checkProAccess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch subscription data");
        }

        const data = await response.json();
        setSubscriptionData(data);
      } catch (err) {
        console.error("Error fetching subscription data:", err);
        setError("Failed to load subscription data");
      } finally {
        setLoading(false);
      }
    };

    fetchSubscriptionData();
  }, []);

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCancelModal) {
        setShowCancelModal(false);
      }
    };

    if (showCancelModal) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showCancelModal]);

  const handleCancelSubscription = async () => {
    setShowCancelModal(true);
  };

  const confirmCancelSubscription = async () => {
    setShowCancelModal(false);

    try {
      setCanceling(true);
      setError(null);
      setSuccess(null);

      const username = localStorage.getItem("username");

      if (!username) {
        setError("No user found. Please sign in again.");
        return;
      }

      // Call the cancellation API
      const response = await authFetch("/api/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to cancel subscription");
      }

      // Stripe subscriptions keep Pro until the paid period ends; legacy Pro (no Stripe
      // subscription) is removed immediately - so the message depends on the outcome
      const result = await response.json();
      setSuccess(
        result.subscriptionStatus === "canceled_at_period_end" && result.accessUntil
          ? `Your subscription has been canceled. You will retain Pro access until ${formatDate(result.accessUntil)}.`
          : result.message ||
              "Your subscription has been canceled and Pro access has been removed."
      );

      // Refresh subscription data
      const refreshResponse = await authFetch("/api/checkProAccess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setSubscriptionData(data);
      }
    } catch (err) {
      console.error("Error canceling subscription:", err);
      setError(
        "Failed to cancel subscription. Please try again or contact support."
      );
    } finally {
      setCanceling(false);
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center">
        <div className="text-red-400 text-xl">{error}</div>
      </div>
    );
  }

  if (!subscriptionData?.hasProAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-white text-xl mb-4">No Active Subscription</div>
          <button
            onClick={() => router.push("/upgrade")}
            className="px-6 py-3 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white font-bold rounded-lg hover:opacity-90 transition-all duration-200"
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="flex items-center text-gray-400 hover:text-white transition-colors mb-4"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>
          <h1 className="text-4xl font-bold text-white mb-2">
            Manage Subscription
          </h1>
          <p className="text-gray-400">Manage your Wingman Pro subscription</p>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="bg-green-500/20 border border-green-500/40 rounded-lg p-4 mb-6">
            <p className="text-green-200">{success}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-4 mb-6">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Subscription Details */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Current Subscription */}
          <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
            <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
              Current Subscription
            </h2>

            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span
                  className={`font-semibold ${
                    subscriptionData.subscriptionStatus?.type ===
                    "canceled_active"
                      ? "text-yellow-400"
                      : "text-green-400"
                  }`}
                >
                  {subscriptionData.subscriptionStatus?.type ===
                  "canceled_active"
                    ? "Canceled (Active Until Period End)"
                    : "Active"}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-400">Plan:</span>
                <span className="text-white font-semibold">Wingman Pro</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-400">Price:</span>
                <span className="text-white font-semibold">$0.99/month</span>
              </div>

              {subscriptionData.subscriptionStatus?.expiresAt && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Next Billing:</span>
                  <span className="text-white font-semibold">
                    {formatDate(subscriptionData.subscriptionStatus.expiresAt)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Pro Features */}
          <div className="bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
            <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
              Pro Features
            </h2>

            <div className="space-y-3">
              <div className="flex items-center">
                <svg
                  className="w-5 h-5 text-green-400 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-white">Advanced analytics</span>
              </div>

              <div className="flex items-center">
                <svg
                  className="w-5 h-5 text-green-400 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-white">Priority support</span>
              </div>

              <div className="flex items-center">
                <svg
                  className="w-5 h-5 text-green-400 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-white">Exclusive forums</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pro Access Expiration Tracker */}
        {subscriptionData.subscriptionStatus?.expiresAt && (
          <div className="mt-8 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(255,193,7,0.2)] border border-yellow-500/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-yellow-500/20 mr-4">
                  <svg
                    className="h-6 w-6 text-yellow-400"
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
                <div>
                  <h3 className="text-xl font-bold text-yellow-200 mb-1">
                    Pro Access Expires
                  </h3>
                  <p className="text-yellow-200/80 text-sm">
                    You&apos;ll lose access to Pro features on this date
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-yellow-200">
                  {formatDate(subscriptionData.subscriptionStatus.expiresAt)}
                </div>
                <div className="text-yellow-200/80 text-sm">
                  {(() => {
                    const now = new Date();
                    const expiresAt = new Date(
                      subscriptionData.subscriptionStatus.expiresAt!
                    );
                    const diffTime = expiresAt.getTime() - now.getTime();
                    const diffDays = Math.ceil(
                      diffTime / (1000 * 60 * 60 * 24)
                    );

                    if (diffDays > 0) {
                      return `${diffDays} day${
                        diffDays !== 1 ? "s" : ""
                      } remaining`;
                    } else if (diffDays === 0) {
                      return "Expires today";
                    } else {
                      return "Expired";
                    }
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-8 bg-[#252642]/50 backdrop-blur-sm rounded-2xl p-6 shadow-[0_0_15px_rgba(0,255,255,0.1)] border border-[#00ffff]/20">
          <h2 className="text-2xl font-bold mb-6 text-[#00ffff]">
            Subscription Actions
          </h2>

          <div className="space-y-4">
            {subscriptionData.subscriptionStatus?.type === "canceled_active" ? (
              <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-4">
                <h3 className="text-yellow-200 font-semibold mb-2">
                  Subscription Canceled
                </h3>
                <p className="text-yellow-200 text-sm mb-4">
                  Your subscription has been canceled and will not renew. You
                  will retain access to Pro features until the end of your
                  current billing period.
                </p>
                {subscriptionData.subscriptionStatus?.expiresAt && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-yellow-200 text-sm font-medium">
                        Access ends:
                      </span>
                      <span className="text-yellow-200 font-bold">
                        {formatDate(
                          subscriptionData.subscriptionStatus.expiresAt
                        )}
                      </span>
                    </div>
                    <div className="text-yellow-200/80 text-xs mt-1">
                      {(() => {
                        const now = new Date();
                        const expiresAt = new Date(
                          subscriptionData.subscriptionStatus.expiresAt!
                        );
                        const diffTime = expiresAt.getTime() - now.getTime();
                        const diffDays = Math.ceil(
                          diffTime / (1000 * 60 * 60 * 24)
                        );

                        if (diffDays > 0) {
                          return `${diffDays} day${
                            diffDays !== 1 ? "s" : ""
                          } remaining`;
                        } else if (diffDays === 0) {
                          return "Expires today";
                        } else {
                          return "Expired";
                        }
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-4">
                <h3 className="text-yellow-200 font-semibold mb-2">
                  Cancel Subscription
                </h3>
                <p className="text-yellow-200 text-sm mb-4">
                  You will retain access to Pro features until the end of your
                  current billing period. After that, you&apos;ll be moved to
                  the free plan and will not be charged again.
                </p>
                <button
                  onClick={handleCancelSubscription}
                  disabled={canceling}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all duration-200"
                >
                  {canceling ? "Canceling..." : "Cancel Subscription"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom Cancel Confirmation Modal */}
      {showCancelModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCancelModal(false);
            }
          }}
        >
          <div className="bg-[#252642] rounded-2xl p-8 max-w-md mx-4 shadow-2xl border border-[#00ffff]/20 relative">
            {/* Close Button */}
            <button
              onClick={() => setShowCancelModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <svg
                className="h-6 w-6"
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

            <div className="text-center">
              {/* Warning Icon */}
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-500/20 mb-6">
                <svg
                  className="h-8 w-8 text-red-400"
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

              {/* Modal Title */}
              <h3 className="text-2xl font-bold text-white mb-4">
                Cancel Subscription?
              </h3>

              {/* Modal Message */}
              <p className="text-gray-300 mb-8 leading-relaxed">
                Are you sure you want to cancel your subscription? You will lose
                access to Pro features at the end of your current billing
                period.
              </p>

              {/* Action Buttons */}
              <div className="flex space-x-4">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-all duration-200"
                >
                  Keep Subscription
                </button>
                <button
                  onClick={confirmCancelSubscription}
                  className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-all duration-200"
                >
                  Yes, Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
