"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import toast from "react-hot-toast";
import { AvatarSelectorProps, RecentAvatar } from "../types";
import { authFetch } from "../utils/authFetch";

const AvatarSelector: React.FC<AvatarSelectorProps> = ({
  isOpen,
  onClose,
  username,
  onAvatarChange,
}) => {
  const [currentAvatar, setCurrentAvatar] = useState<string | null>(null);
  const [recentAvatars, setRecentAvatars] = useState<RecentAvatar[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRecentAvatars = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await authFetch("/api/avatar/recent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch avatars");
      }

      const data = await response.json();
      setCurrentAvatar(data.currentAvatar);
      setRecentAvatars(data.recentAvatars || []);
    } catch (error) {
      console.error("Error fetching avatars:", error);
      toast.error("Failed to load avatars");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Re-fetch when the signed-in user changes (the API identifies them by cookie)
  useEffect(() => {
    if (isOpen) {
      fetchRecentAvatars();
    }
  }, [isOpen, fetchRecentAvatars, username]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be smaller than 5MB");
      return;
    }

    uploadAvatar(file);
  };

  const uploadAvatar = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      formData.append("username", username);

      const response = await fetch("/api/avatar/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload avatar");
      }

      const data = await response.json();
      setCurrentAvatar(data.avatarUrl);
      setRecentAvatars(data.avatarHistory || []);

      if (onAvatarChange) {
        onAvatarChange(data.avatarUrl);
      }

      toast.success("Avatar uploaded and set as your profile picture!", {
        duration: 4000,
      });
    } catch (error: any) {
      console.error("Error uploading avatar:", error);
      toast.error(error.message || "Failed to upload avatar");
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSetAvatar = async (avatarUrl: string) => {
    try {
      const response = await authFetch("/api/avatar/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });

      if (!response.ok) {
        throw new Error("Failed to set avatar");
      }

      setCurrentAvatar(avatarUrl);
      if (onAvatarChange) {
        onAvatarChange(avatarUrl);
      }

      toast.success("Profile avatar updated!", {
        duration: 3000,
      });
    } catch (error) {
      console.error("Error setting avatar:", error);
      toast.error("Failed to set avatar");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4">
      <div className="bg-[#252642] rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] border border-[#00ffff]/20 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-2xl font-bold text-[#00ffff]">Select an Image</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
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

        {/* Content - Scrollable */}
        <div className="p-6 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner"></div>
              <span className="ml-3 text-gray-400">Loading avatars...</span>
            </div>
          ) : (
            <>
              {/* Upload Section */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">
                  Upload New Avatar
                </h3>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-[#00ffff] transition-colors bg-gray-800/50"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={isUploading}
                  />
                  {isUploading ? (
                    <div className="flex flex-col items-center">
                      <div className="spinner mb-2"></div>
                      <span className="text-gray-400">Uploading...</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-4xl mb-2">📷</div>
                      <p className="text-gray-300 font-medium">Upload Image</p>
                      <p className="text-sm text-gray-500 mt-1">
                        PNG, JPG, GIF up to 5MB
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Recent Avatars Section */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">
                  Recent Avatars
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Access your {Math.max(6, recentAvatars.length)} most recent
                  avatar uploads
                </p>
                <div className="grid grid-cols-3 gap-4">
                  {/* Current Avatar (if exists) */}
                  {currentAvatar && (
                    <div className="relative group">
                      <div className="relative aspect-square rounded-full overflow-hidden border-2 border-[#00ffff]">
                        <Image
                          src={currentAvatar}
                          alt="Current avatar"
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full flex items-center justify-center">
                        <span className="text-xs text-white font-semibold">
                          Active
                        </span>
                      </div>
                      <div className="absolute -top-1 -right-1 bg-[#00ffff] text-[#1a1b2e] text-xs font-bold px-1.5 py-0.5 rounded-full">
                        ✓
                      </div>
                    </div>
                  )}

                  {/* Recent Avatars */}
                  {recentAvatars
                    .filter((avatar) => avatar.url !== currentAvatar)
                    .slice(0, 5)
                    .map((avatar, index) => (
                      <button
                        key={index}
                        onClick={() => handleSetAvatar(avatar.url)}
                        className="relative aspect-square rounded-full overflow-hidden border-2 border-gray-600 hover:border-[#00ffff] transition-colors group cursor-pointer"
                        title="Click to set as profile avatar"
                      >
                        <Image
                          src={avatar.url}
                          alt={`Recent avatar ${index + 1}`}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full flex items-center justify-center">
                          <span className="text-xs text-white font-semibold">
                            Set as Active
                          </span>
                        </div>
                      </button>
                    ))}

                  {/* Placeholder slots if less than 6 */}
                  {Array.from({
                    length: Math.max(
                      0,
                      6 -
                        (currentAvatar ? 1 : 0) -
                        recentAvatars.filter((a) => a.url !== currentAvatar)
                          .length
                    ),
                  }).map((_, index) => (
                    <div
                      key={`placeholder-${index}`}
                      className="aspect-square rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center"
                    >
                      <span className="text-gray-600 text-2xl">?</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AvatarSelector;
