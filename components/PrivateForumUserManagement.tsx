"use client";

import { useState } from "react";
import { PrivateForumUserManagementProps } from "../types";
import { authFetch } from "../utils/authFetch";

export default function PrivateForumUserManagement({
  forumId,
  allowedUsers,
  createdBy,
  currentUsername,
  onUsersUpdated,
}: PrivateForumUserManagementProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Only show management interface if user is the forum creator
  if (createdBy !== currentUsername) {
    return null;
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Check if user already exists in allowed users
      if (allowedUsers.includes(newUsername.trim())) {
        setError("User is already added to this forum");
        setLoading(false);
        return;
      }

      // First, verify the username exists
      const verifyResponse = await fetch("/api/validateUsername", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim() }),
      });

      if (!verifyResponse.ok) {
        setError("Username does not exist or is invalid");
        setLoading(false);
        return;
      }

      // Add user to allowed users
      const updatedUsers = [...allowedUsers, newUsername.trim()];
      const response = await authFetch("/api/updateForumsAllowedUsers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forumId,
          allowedUsers: updatedUsers,
        }),
      });

      if (response.ok) {
        onUsersUpdated(updatedUsers);
        setNewUsername("");
        setSuccess(`User ${newUsername.trim()} added successfully`);
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to add user");
      }
    } catch (err: any) {
      setError(err.message || "Failed to add user");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveUser = async (usernameToRemove: string) => {
    if (usernameToRemove === createdBy) {
      setError("Cannot remove the forum creator");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const updatedUsers = allowedUsers.filter(
        (user) => user !== usernameToRemove
      );
      const response = await authFetch("/api/updateForumsAllowedUsers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forumId,
          allowedUsers: updatedUsers,
        }),
      });

      if (response.ok) {
        onUsersUpdated(updatedUsers);
        setSuccess(`User ${usernameToRemove} removed successfully`);
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to remove user");
      }
    } catch (err: any) {
      setError(err.message || "Failed to remove user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Manage Forum Access
        </h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {isOpen ? "Hide" : "Manage Users"}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-4">
          {/* Add User Form */}
          <form onSubmit={handleAddUser} className="flex gap-2">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Enter username to add"
              className="flex-3 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !newUsername.trim()}
              className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Adding..." : "Add User"}
            </button>
          </form>

          {/* Current Users List */}
          <div>
            <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
              Current Users ({allowedUsers.length})
            </h4>
            <div className="space-y-2">
              {allowedUsers.map((user, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-white dark:bg-gray-700 rounded border"
                >
                  <span className="text-gray-900 dark:text-gray-100">
                    {user}
                    {user === createdBy && (
                      <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                        Creator
                      </span>
                    )}
                  </span>
                  {user !== createdBy && (
                    <button
                      onClick={() => handleRemoveUser(user)}
                      disabled={loading}
                      className="px-2 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Status Messages */}
          {error && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded">
              {success}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
