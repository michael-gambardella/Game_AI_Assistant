"use client";

import React, { useState, useEffect } from "react";
import axios from "../utils/axiosConfig";
import { GameTrackerProps, GameEntry } from "../types";

const GameTracker: React.FC<GameTrackerProps> = ({
  gameTracking,
  onUpdate,
}) => {
  const [wishlist, setWishlist] = useState<GameEntry[]>(
    gameTracking?.wishlist || []
  );
  const [currentlyPlaying, setCurrentlyPlaying] = useState<GameEntry[]>(
    gameTracking?.currentlyPlaying || []
  );
  const [newGameName, setNewGameName] = useState("");
  const [newGameNotes, setNewGameNotes] = useState("");
  const [selectedLists, setSelectedLists] = useState<{
    wishlist: boolean;
    currentlyPlaying: boolean;
  }>({
    wishlist: true,
    currentlyPlaying: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Spoiler-safe progress editing (one currently-playing game at a time)
  const [editingProgressFor, setEditingProgressFor] = useState<string | null>(null);
  const [progressDraft, setProgressDraft] = useState("");

  useEffect(() => {
    if (gameTracking) {
      setWishlist(gameTracking.wishlist || []);
      setCurrentlyPlaying(gameTracking.currentlyPlaying || []);
    }
  }, [gameTracking]);

  const fetchGameTracking = async () => {
    try {
      // Shared axios instance: sends the auth cookie and refreshes an expired token on 401
      const { data } = await axios.post("/api/game-tracking-get");
      if (data.gameTracking) {
        setWishlist(data.gameTracking.wishlist || []);
        setCurrentlyPlaying(data.gameTracking.currentlyPlaying || []);
      }
    } catch (err) {
      console.error("Error fetching game tracking:", err);
    }
  };

  const handleAddGame = async () => {
    if (!newGameName.trim()) {
      setError("Please enter a game name");
      return;
    }

    // Check if at least one list is selected
    if (!selectedLists.wishlist && !selectedLists.currentlyPlaying) {
      setError("Please select at least one list (Wishlist or Currently Playing)");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Build array of selected list types
      const listTypes: string[] = [];
      if (selectedLists.wishlist) listTypes.push("wishlist");
      if (selectedLists.currentlyPlaying) listTypes.push("currentlyPlaying");

      const { data } = await axios.post("/api/game-tracking", {
        action: "add",
        gameName: newGameName.trim(),
        listType: listTypes,
        notes: newGameNotes.trim() || undefined,
      });

      // Update local state with all lists
      setWishlist(data.gameTracking.wishlist || []);
      setCurrentlyPlaying(data.gameTracking.currentlyPlaying || []);

      setNewGameName("");
      setNewGameNotes("");
      
      // Create success message based on which lists were added to
      const addedToListNames = listTypes.map(lt => 
        lt === "wishlist" ? "wishlist" : "currently playing"
      ).join(" and ");
      setSuccess(`Game added to ${addedToListNames}!`);

      // Call onUpdate callback if provided
      if (onUpdate) {
        onUpdate();
      }

      // Refresh data to ensure consistency
      await fetchGameTracking();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to add game");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveGame = async (gameName: string, listType: "wishlist" | "currentlyPlaying") => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data } = await axios.post("/api/game-tracking", {
        action: "remove",
        gameName,
        listType,
      });

      // Update local state
      if (listType === "wishlist") {
        setWishlist(data.gameTracking.wishlist || []);
      } else {
        setCurrentlyPlaying(data.gameTracking.currentlyPlaying || []);
      }

      setSuccess("Game removed successfully!");

      if (onUpdate) {
        onUpdate();
      }

      await fetchGameTracking();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to remove game");
    } finally {
      setLoading(false);
    }
  };

  const handleMoveGame = async (
    gameName: string,
    fromList: "wishlist" | "currentlyPlaying",
    toList: "wishlist" | "currentlyPlaying"
  ) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data } = await axios.post("/api/game-tracking", {
        action: "move",
        gameName,
        fromList,
        toList,
      });

      // Update local state
      setWishlist(data.gameTracking.wishlist || []);
      setCurrentlyPlaying(data.gameTracking.currentlyPlaying || []);

      setSuccess("Game moved successfully!");

      if (onUpdate) {
        onUpdate();
      }

      await fetchGameTracking();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to move game");
    } finally {
      setLoading(false);
    }
  };

  const startEditingProgress = (game: GameEntry) => {
    setEditingProgressFor(game.gameName);
    setProgressDraft(game.progress || "");
    setError(null);
    setSuccess(null);
  };

  const cancelEditingProgress = () => {
    setEditingProgressFor(null);
    setProgressDraft("");
  };

  const handleSaveProgress = async (gameName: string, progress: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data } = await axios.post("/api/game-tracking", {
        action: "setProgress",
        gameName,
        progress: progress.trim(),
      });

      setCurrentlyPlaying(data.gameTracking.currentlyPlaying || []);
      cancelEditingProgress();
      setSuccess(
        progress.trim()
          ? "Progress saved! Wingman will avoid spoilers past this point."
          : "Progress cleared - spoiler-safe mode is off for this game."
      );

      if (onUpdate) {
        onUpdate();
      }

      await fetchGameTracking();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to save progress");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return "";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Add Game Form */}
      <div className="bg-[#1a1b2e]/50 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold text-[#00ffff] mb-4">Add Game</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Game Name</label>
            <input
              type="text"
              value={newGameName}
              onChange={(e) => setNewGameName(e.target.value)}
              placeholder="Enter game name"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#00ffff] focus:border-transparent"
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  handleAddGame();
                }
              }}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Notes (Optional)</label>
            <input
              type="text"
              value={newGameNotes}
              onChange={(e) => setNewGameNotes(e.target.value)}
              placeholder="Add notes about this game"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-[#00ffff] focus:border-transparent"
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  handleAddGame();
                }
              }}
            />
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="wishlist-checkbox"
                checked={selectedLists.wishlist}
                onChange={(e) =>
                  setSelectedLists((prev) => ({
                    ...prev,
                    wishlist: e.target.checked,
                  }))
                }
                className="w-4 h-4 text-[#00ffff] bg-gray-800 border-gray-600 rounded focus:ring-[#00ffff] focus:ring-2"
              />
              <label htmlFor="wishlist-checkbox" className="text-sm text-gray-300">
                Wishlist
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="playing-checkbox"
                checked={selectedLists.currentlyPlaying}
                onChange={(e) =>
                  setSelectedLists((prev) => ({
                    ...prev,
                    currentlyPlaying: e.target.checked,
                  }))
                }
                className="w-4 h-4 text-[#00ffff] bg-gray-800 border-gray-600 rounded focus:ring-[#00ffff] focus:ring-2"
              />
              <label htmlFor="playing-checkbox" className="text-sm text-gray-300">
                Currently Playing
              </label>
            </div>
          </div>
          {!selectedLists.wishlist && !selectedLists.currentlyPlaying && (
            <p className="text-xs text-yellow-400">
              Please select at least one list to add the game to
            </p>
          )}
          <button
            onClick={handleAddGame}
            disabled={loading || !newGameName.trim() || (!selectedLists.wishlist && !selectedLists.currentlyPlaying)}
            className="w-full px-4 py-2 bg-gradient-to-r from-[#00ffff] to-[#ff69b4] text-white rounded-lg hover:opacity-90 transition-all duration-200 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Adding..." : "Add Game"}
          </button>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-lg">
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/40 rounded-lg">
          <p className="text-green-200 text-sm">{success}</p>
        </div>
      )}

      {/* Currently Playing List */}
      <div className="bg-[#1a1b2e]/50 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold text-[#00ffff] mb-4 flex items-center gap-2">
          <span>🎮</span>
          Currently Playing ({currentlyPlaying.length})
        </h3>
        <p className="text-gray-400 text-xs mb-3">
          🛡️ Set your progress on a game and Wingman will avoid spoilers past that point.
        </p>
        {currentlyPlaying.length === 0 ? (
          <p className="text-gray-400 text-sm">No games in your currently playing list</p>
        ) : (
          <div className="space-y-2">
            {currentlyPlaying.map((game, index) => (
              <div
                key={index}
                className="bg-gray-800/50 rounded-lg p-3 flex items-start justify-between hover:bg-gray-800/70 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="text-white font-semibold truncate">{game.gameName}</h4>
                  {game.notes && (
                    <p className="text-gray-400 text-sm mt-1">{game.notes}</p>
                  )}
                  {editingProgressFor === game.gameName ? (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={progressDraft}
                        onChange={(e) => setProgressDraft(e.target.value)}
                        maxLength={150}
                        autoFocus
                        placeholder='e.g. "Chapter 4" or "just beat the first boss"'
                        className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-400 focus:ring-2 focus:ring-[#00ffff] focus:border-transparent"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleSaveProgress(game.gameName, progressDraft);
                          } else if (e.key === "Escape") {
                            cancelEditingProgress();
                          }
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveProgress(game.gameName, progressDraft)}
                          disabled={loading}
                          className="px-3 py-1 bg-[#00ffff]/80 hover:bg-[#00ffff] disabled:bg-gray-600 disabled:cursor-not-allowed text-gray-900 text-xs font-semibold rounded transition-colors"
                        >
                          Save
                        </button>
                        {game.progress && (
                          <button
                            onClick={() => handleSaveProgress(game.gameName, "")}
                            disabled={loading}
                            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                          >
                            Clear
                          </button>
                        )}
                        <button
                          onClick={cancelEditingProgress}
                          disabled={loading}
                          className="px-3 py-1 text-gray-400 hover:text-white text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      {game.progress ? (
                        <p className="text-[#00ffff]/90 text-sm">
                          🛡️ Progress: {game.progress}
                        </p>
                      ) : null}
                      <button
                        onClick={() => startEditingProgress(game)}
                        disabled={loading}
                        className="text-xs text-gray-400 hover:text-[#00ffff] underline disabled:cursor-not-allowed transition-colors"
                        title="Wingman will avoid spoilers past this point"
                      >
                        {game.progress ? "Edit" : "Set progress (spoiler-safe)"}
                      </button>
                    </div>
                  )}
                  {game.startedAt && (
                    <p className="text-gray-500 text-xs mt-1">
                      Started: {formatDate(game.startedAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => handleMoveGame(game.gameName, "currentlyPlaying", "wishlist")}
                    disabled={loading}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                    title="Move to wishlist"
                  >
                    Move to Wishlist
                  </button>
                  <button
                    onClick={() => handleRemoveGame(game.gameName, "currentlyPlaying")}
                    disabled={loading}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                    title="Remove"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wishlist */}
      <div className="bg-[#1a1b2e]/50 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold text-[#00ffff] mb-4 flex items-center gap-2">
          <span>⭐</span>
          Wishlist ({wishlist.length})
        </h3>
        {wishlist.length === 0 ? (
          <p className="text-gray-400 text-sm">No games in your wishlist</p>
        ) : (
          <div className="space-y-2">
            {wishlist.map((game, index) => (
              <div
                key={index}
                className="bg-gray-800/50 rounded-lg p-3 flex items-start justify-between hover:bg-gray-800/70 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="text-white font-semibold truncate">{game.gameName}</h4>
                  {game.notes && (
                    <p className="text-gray-400 text-sm mt-1">{game.notes}</p>
                  )}
                  {game.addedAt && (
                    <p className="text-gray-500 text-xs mt-1">
                      Added: {formatDate(game.addedAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => handleMoveGame(game.gameName, "wishlist", "currentlyPlaying")}
                    disabled={loading}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                    title="Move to currently playing"
                  >
                    Start Playing
                  </button>
                  <button
                    onClick={() => handleRemoveGame(game.gameName, "wishlist")}
                    disabled={loading}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                    title="Remove"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GameTracker;

