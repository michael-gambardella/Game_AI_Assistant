"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "../utils/axiosConfig";
import Image from "next/image";
import { SavedGuide, MyGuidesProps } from "../types";

export default function MyGuides({ username, isOpen, onClose }: MyGuidesProps) {
  const [guides, setGuides] = useState<SavedGuide[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGuide, setSelectedGuide] = useState<SavedGuide | null>(null);

  const fetchGuides = useCallback(async () => {
    if (!username) return;

    setLoading(true);
    setError(null);

    try {
      const res = await axios.post("/api/guides/get", {});
      if (res.data.success) {
        setGuides(res.data.guides || []);
      } else {
        setError("Failed to load guides");
      }
    } catch (err: any) {
      console.error("Error fetching guides:", err);
      setError(err.response?.data?.message || "Failed to load guides");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    if (isOpen && username) {
      fetchGuides();
    }
  }, [isOpen, username, fetchGuides]);

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold">My Guides</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
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

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Guides List */}
          <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : error ? (
              <div className="p-4 text-center text-red-500">{error}</div>
            ) : guides.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No saved guides yet. Save guides from your conversations!
              </div>
            ) : (
              <div className="p-2">
                {guides.map((guide, index) => (
                  <div
                    key={index}
                    onClick={() => setSelectedGuide(guide)}
                    className={`p-3 mb-2 rounded-lg cursor-pointer transition-colors ${
                      selectedGuide === guide
                        ? "bg-blue-100 dark:bg-blue-900"
                        : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <h3 className="font-semibold text-sm mb-1 line-clamp-2">
                      {guide.title}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                      {guide.question}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {formatDate(guide.savedAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Guide Detail */}
          <div className="flex-1 overflow-y-auto p-6">
            {selectedGuide ? (
              <div>
                <h3 className="text-xl font-bold mb-2">
                  {selectedGuide.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Saved on {formatDate(selectedGuide.savedAt)}
                </p>

                {selectedGuide.imageUrl && (
                  <div className="mb-4 relative">
                    <Image
                      src={selectedGuide.imageUrl}
                      alt="Guide image"
                      width={800}
                      height={600}
                      className="max-w-full h-auto rounded border border-gray-300 dark:border-gray-600"
                      unoptimized={
                        selectedGuide.imageUrl.startsWith("http") ||
                        selectedGuide.imageUrl.startsWith("//")
                      }
                    />
                  </div>
                )}

                <div className="mb-4">
                  <h4 className="font-semibold mb-2">Question:</h4>
                  <p className="text-gray-700 dark:text-gray-300">
                    {selectedGuide.question}
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Guide:</h4>
                  <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                    {selectedGuide.response}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                Select a guide to view its contents
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            {guides.length} {guides.length === 1 ? "guide" : "guides"} saved
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
