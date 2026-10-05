"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import Image from "next/image";

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [step, setStep] = useState<"email" | "verify">("email");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [cooldownTime, setCooldownTime] = useState(0);
  // Arrived from sign-in for an account without a password: the code was already emailed,
  // so start on the code step - and ask for the email there (it's never revealed to us)
  const [arrivedWithCode, setArrivedWithCode] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("codeSent") === "1") {
      setArrivedWithCode(true);
      setStep("verify");
      setTimeRemaining(60);
      setMessage(
        "Your account needs a password. We've emailed a 6-digit verification code to the address on file - enter that email and the code below."
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Countdown timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [timeRemaining]);

  const validateEmailForm = () => {
    const newErrors: { [key: string]: string } = {};

    // Email validation
    if (!email) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Please enter a valid email address";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateCodeForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (arrivedWithCode) {
      if (!email) {
        newErrors.email = "Email is required";
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        newErrors.email = "Please enter a valid email address";
      }
    }

    // Verification code validation
    if (!verificationCode) {
      newErrors.verificationCode = "Verification code is required";
    } else if (!/^\d{6}$/.test(verificationCode)) {
      newErrors.verificationCode = "Verification code must be 6 digits";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setErrors({});

    if (!validateEmailForm()) {
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post("/api/auth/forgot-password", {
        email,
      });

      if (response.status === 200) {
        setMessage(
          "If an account with that email exists, we've sent a verification code. Please check your email and enter the 6-digit code to proceed."
        );
        setStep("verify");
        setTimeRemaining(60); // Start countdown
      } else {
        setMessage(
          response.data.message || "An error occurred. Please try again."
        );
      }
    } catch (error: any) {
      console.error("Forgot password error:", error);

      if (error.response?.status === 429) {
        setCooldownTime(error.response.data.timeRemaining);
        setMessage(
          `Please wait ${error.response.data.timeRemaining} seconds before requesting another password reset.`
        );
      } else if (error.response?.data?.message) {
        setMessage(error.response.data.message);
      } else {
        setMessage("An error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setErrors({});

    if (!validateCodeForm()) {
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post("/api/auth/verify-reset-code", {
        email,
        verificationCode,
      });

      if (response.status === 200) {
        setMessage(
          "Verification successful! Redirecting you to reset your password..."
        );
        // Clear any stored session data to ensure fresh login after password reset
        localStorage.removeItem("username");
        localStorage.removeItem("userId");
        localStorage.removeItem("userEmail");
        // Redirect to reset password page after a short delay
        setTimeout(() => {
          if (response.data.resetToken) {
            router.push(`/reset-password?token=${response.data.resetToken}`);
          } else {
            router.push("/reset-password");
          }
        }, 1500);
      } else {
        setMessage(
          response.data.message || "An error occurred. Please try again."
        );
      }
    } catch (error: any) {
      console.error("Verify code error:", error);

      if (error.response?.data?.message) {
        setMessage(error.response.data.message);
      } else {
        setMessage("An error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      ></div>

      <div className="relative bg-white/95 backdrop-blur-sm p-10 rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-white/20">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/assets/video-game-wingman-logo.png"
            alt="Video Game Wingman Logo"
            width={120}
            height={120}
            className="mb-6 drop-shadow-lg"
            priority
          />
          <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
            Forgot Password
          </h1>
          <p className="text-gray-600 text-center text-sm">
            Enter your email address and we&apos;ll send you a link to reset
            your password
          </p>
        </div>

        {step === "email" ? (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-500 ${
                  errors.email ? "border-red-500" : "border-gray-300"
                }`}
                placeholder="Enter your email address"
                required
              />
              {errors.email && (
                <p className="text-red-500 text-sm mt-1">{errors.email}</p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || cooldownTime > 0}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Sending Verification Code...
                </div>
              ) : cooldownTime > 0 ? (
                `Wait ${cooldownTime}s`
              ) : (
                "Send Verification Code"
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            {/* Email (only when the code was sent from sign-in, so we never had it) */}
            {arrivedWithCode && (
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-500 ${
                    errors.email ? "border-red-500" : "border-gray-300"
                  }`}
                  placeholder="Enter your account's email address"
                  required
                />
                {errors.email && (
                  <p className="text-red-500 text-sm mt-1">{errors.email}</p>
                )}
              </div>
            )}

            {/* Verification Code Field */}
            <div>
              <label
                htmlFor="verificationCode"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Verification Code
              </label>
              <input
                type="text"
                id="verificationCode"
                value={verificationCode}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setVerificationCode(value);
                }}
                className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-500 text-center text-2xl tracking-widest ${
                  errors.verificationCode ? "border-red-500" : "border-gray-300"
                }`}
                placeholder="000000"
                maxLength={6}
                required
              />
              {errors.verificationCode && (
                <p className="text-red-500 text-sm mt-1">
                  {errors.verificationCode}
                </p>
              )}
              {timeRemaining > 0 && (
                <p className="text-sm text-gray-600 mt-2 text-center">
                  Code expires in {timeRemaining} seconds
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || timeRemaining === 0}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Verifying Code...
                </div>
              ) : timeRemaining === 0 ? (
                "Code Expired"
              ) : (
                "Verify Code"
              )}
            </button>

            {/* Back to Email Step */}
            <button
              type="button"
              onClick={() => {
                setArrivedWithCode(false);
                setStep("email");
                setVerificationCode("");
                setTimeRemaining(0);
                setMessage("");
                setErrors({});
              }}
              className="w-full text-indigo-600 hover:text-indigo-800 font-medium text-sm"
            >
              ← Back to email step
            </button>
          </form>
        )}

        {/* Message Display */}
        {message && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm ${
              message.includes("sent") ||
              message.includes("successful") ||
              message.includes("verification") ||
              message.includes("redirecting")
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {message}
          </div>
        )}

        {/* Back to Sign In Link */}
        <div className="mt-6 text-center">
          <p className="text-gray-600">
            Remember your password?{" "}
            <button
              onClick={() => router.push("/")}
              className="text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Sign In
            </button>
          </p>
        </div>

        {/* Help Text */}
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-xs text-blue-800 text-center">
            <strong>Note:</strong> For security reasons, we don&apos;t reveal
            whether an email address exists in our system. The verification code
            expires in 60 seconds. If you don&apos;t receive an email within a
            few minutes, check your spam folder.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
