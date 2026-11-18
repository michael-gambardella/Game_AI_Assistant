"use client";

import { useState, useEffect } from "react";
import { useForum } from "../context/ForumContext";
import { Forum } from "../types";
import CreateForum from "./CreateForum";
import Link from "next/link";
import { authFetch } from "../utils/authFetch";

const categoryLabels: Record<string, string> = {
  speedruns: "Speedruns",
  gameplay: "Gameplay",
  mods: "Mods",
  general: "General Discussion",
  help: "Help & Support",
};

export default function ForumList() {
  const {
    forums,
    fetchForums,
    deleteForum,
    pagination,
    loading: contextLoading,
  } = useForum();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hasProAccess, setHasProAccess] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const forumsPerPage = 10;
  // Filter state: cleared = default list (newest / recently updated first)
  const [gameTitleFilter, setGameTitleFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "mostPosts">("newest");

  // Check Pro access on component mount
  useEffect(() => {
    const checkProAccess = async () => {
      try {
        const username = localStorage.getItem("username");

        // Only check Pro access if user is logged in
        if (!username) {
          setHasProAccess(false);
          return;
        }

        const response = await authFetch("/api/checkProAccess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          // If request fails, assume no Pro access
          setHasProAccess(false);
          return;
        }

        const data = await response.json();
        setHasProAccess(data.hasProAccess || false);
      } catch (error) {
        console.error("Error checking Pro access:", error);
        // On error, assume no Pro access
        setHasProAccess(false);
      }
    };

    checkProAccess();
  }, []);

  const getFilters = (): { gameTitle?: string; category?: string; sort: "newest" | "oldest" | "mostPosts" } => ({
    ...(gameTitleFilter.trim() && { gameTitle: gameTitleFilter.trim() }),
    ...(categoryFilter.trim() && { category: categoryFilter.trim() }),
    sort: sortBy,
  });

  const loadForums = async (page: number, filtersOverride?: { sort?: "newest" | "oldest" | "mostPosts" }) => {
    try {
      setLoading(true);
      setError("");
      const filters = { ...getFilters(), ...filtersOverride };
      await fetchForums(page, forumsPerPage, filters);
    } catch (err: any) {
      setError(err.message || "Failed to load forums");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleClearFilters = async () => {
    setGameTitleFilter("");
    setCategoryFilter("");
    setSortBy("newest");
    setCurrentPage(1);
    try {
      setLoading(true);
      setError("");
      await fetchForums(1, forumsPerPage, { sort: "newest" });
    } catch (err: any) {
      setError(err.message || "Failed to load forums");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const hasActiveFilters =
    gameTitleFilter.trim() !== "" ||
    categoryFilter.trim() !== "" ||
    sortBy !== "newest";

  useEffect(() => {
    loadForums(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Refresh forums when create form is closed (after successful creation)
  useEffect(() => {
    if (!showCreateForm) {
      // Small delay to ensure the forum was created in the database
      const timer = setTimeout(() => {
        loadForums(currentPage);
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreateForm]);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (pagination && currentPage < pagination.pages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleReload = () => {
    setIsRefreshing(true);
    loadForums(currentPage);
  };

  const handleDelete = async (forumId: string) => {
    if (!confirm("Are you sure you want to delete this forum?")) return;

    try {
      await deleteForum(forumId);
      // Refresh the current page after deletion
      // If we're on the last page and it becomes empty, go to previous page
      if (pagination && forums.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        loadForums(currentPage);
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete forum");
    }
  };

  const isLoading = loading || contextLoading || isRefreshing;
  // Only collapse to "Loading forums..." on initial load (no data yet). When
  // filtering/sorting/refreshing, keep the full layout so the page height
  // doesn't change and scroll position is preserved.
  const isInitialLoad = loading && !pagination && forums.length === 0;

  if (isInitialLoad) {
    return <div className="text-center">Loading forums...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Forums</h2>
        <div className="flex gap-2">
          <button
            onClick={handleReload}
            disabled={isLoading}
            className={`px-4 py-2 rounded flex items-center gap-2 ${
              isLoading
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-green-500 text-white hover:bg-green-600"
            }`}
            title="Reload forums"
          >
            {isRefreshing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Reloading...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
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
                Reload
              </>
            )}
          </button>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            disabled={!hasProAccess}
            className={`px-4 py-2 rounded ${
              hasProAccess
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "bg-gray-400 text-gray-600 cursor-not-allowed"
            }`}
            title={!hasProAccess ? "Pro access required to create forums" : ""}
          >
            {showCreateForm ? "Cancel" : "Create Forum"}
          </button>
        </div>
      </div>

      {!hasProAccess && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-800 text-sm">
            <strong>Pro Access Required:</strong> Upgrade to Wingman Pro to
            create and manage forums. Free users can still browse discussions,
            post, and reply.
          </p>
        </div>
      )}

      {/* Filter and sort controls */}
      <div className="bg-white p-4 rounded-lg shadow space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Filter & Sort Forums</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[160px]">
            <label htmlFor="forum-filter-game" className="block text-xs font-medium text-gray-500 mb-1">
              Game title
            </label>
            <input
              id="forum-filter-game"
              type="text"
              placeholder="e.g. Super Mario Galaxy"
              value={gameTitleFilter}
              onChange={(e) => {
                setGameTitleFilter(e.target.value);
                setCurrentPage(1);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadForums(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label htmlFor="forum-filter-category" className="block text-xs font-medium text-gray-500 mb-1">
              Category
            </label>
            <input
              id="forum-filter-category"
              type="text"
              placeholder="e.g. Speedruns, Gameplay"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setCurrentPage(1);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadForums(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>
          <div className="min-w-[180px]">
            <label htmlFor="forum-sort" className="block text-xs font-medium text-gray-500 mb-1">
              Sort by
            </label>
            <select
              id="forum-sort"
              value={sortBy}
              onChange={(e) => {
                const value = e.target.value as "newest" | "oldest" | "mostPosts";
                setSortBy(value);
                setCurrentPage(1);
                loadForums(1, { sort: value });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
            >
              <option value="newest" className="bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100">
                Newest / Recently updated
              </option>
              <option value="oldest" className="bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100">
                Oldest first
              </option>
              <option value="mostPosts" className="bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100">
                Most posts first
              </option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => loadForums(1)}
              disabled={isLoading}
              className="px-4 py-2 rounded bg-gray-300 text-gray-700 hover:bg-gray-200 disabled:opacity-50 text-sm font-medium"
            >
              Apply
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                disabled={isLoading}
                className="px-4 py-2 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50 text-sm font-medium"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {showCreateForm && <CreateForum />}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-500">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent" />
          <span>Updating list…</span>
        </div>
      )}

      <div className="grid gap-4">
        {forums.map((forum: Forum) => {
          // console.log("Forum object:", forum); // Commented out for production
          return (
            <div
              key={forum._id}
              className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/forum/${forum.forumId}`}
                      className="text-xl font-semibold text-blue-600 hover:text-blue-800"
                    >
                      {forum.title}
                    </Link>
                    {forum.isPrivate && (
                      <span className="px-2 py-1 bg-gray-500 text-white text-xs rounded-full">
                        Private
                      </span>
                    )}
                  </div>
                  <p className="text-gray-600 mt-1">
                    Game: {forum.gameTitle} | Category:{" "}
                    {categoryLabels[forum.category] ||
                      forum.category ||
                      "Uncategorized"}
                  </p>
                  <div className="mt-2 text-sm text-gray-500">
                    <span className="mr-4">
                      Posts: {forum.posts?.length || 0}
                    </span>
                    <span className="mr-4">
                      Views: {forum.metadata?.viewCount || 0}
                    </span>
                    <span
                      title={
                        (forum.metadata?.status || "active") === "inactive"
                          ? "No new posts in 7+ days; you can still post to reactivate"
                          : undefined
                      }
                    >
                      Status: {forum.metadata?.status || "active"}
                    </span>
                  </div>
                </div>
                {forum.createdBy === localStorage.getItem("username") && (
                  <button
                    onClick={() => handleDelete(forum._id)}
                    className="text-red-500 hover:text-red-700 ml-4"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {forums.length === 0 && !isLoading && (
          <div className="text-center text-gray-500 py-8">
            No forums found. Create one to get started!
            {!hasProAccess && (
              <div className="mt-2 text-sm">
                <p>Upgrade to Pro to create your own communities.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between bg-white p-4 rounded-lg shadow">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 1 || isLoading}
              className={`px-4 py-2 rounded flex items-center gap-2 ${
                currentPage === 1 || isLoading
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-blue-500 text-white hover:bg-blue-600"
              }`}
            >
              <svg
                className="w-4 h-4"
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
              Previous
            </button>
            <span className="px-4 py-2 text-gray-700">
              Page {currentPage} of {pagination.pages} ({pagination.total} total
              forums)
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage >= pagination.pages || isLoading}
              className={`px-4 py-2 rounded flex items-center gap-2 ${
                currentPage >= pagination.pages || isLoading
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-blue-500 text-white hover:bg-blue-600"
              }`}
            >
              Next
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Show pagination info even if only one page */}
      {pagination && pagination.pages === 1 && pagination.total > 0 && (
        <div className="text-center text-gray-600 text-sm py-2">
          Showing all {pagination.total} forum
          {pagination.total !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
