"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import axios from "../utils/axiosConfig";
import { Forum, ForumContextType, ForumFilters } from "../types";
import { trackForumCreated } from "../utils/analytics";

const ForumContext = createContext<ForumContextType | undefined>(undefined);

export function ForumProvider({ children }: { children: React.ReactNode }) {
  const [forums, setForums] = useState<Forum[]>([]);
  const [currentForum, setCurrentForum] = useState<Forum | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{
    total: number;
    page: number;
    limit: number;
    pages: number;
  } | null>(null);

  const fetchForums = useCallback(async (page: number, limit: number, filters?: ForumFilters) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filters?.gameTitle?.trim()) params.set("gameTitle", filters.gameTitle.trim());
      if (filters?.category?.trim()) params.set("category", filters.category.trim());
      if (filters?.sort) params.set("sort", filters.sort);
      const response = await axios.get(
        `/api/getAllForums?${params.toString()}`,
        {
          headers: {
            username: localStorage.getItem("username") || "test-user",
          },
        }
      );
      setForums(response.data.forums);
      setPagination(response.data.pagination || null);
      return {
        forums: response.data.forums,
        pagination: response.data.pagination || {
          total: 0,
          page: 1,
          limit: 10,
          pages: 0,
        },
      };
    } catch (err: any) {
      setError(
        err.response?.data?.error || err.message || "Failed to fetch forums"
      );
      return {
        forums: [],
        pagination: {
          total: 0,
          page: 1,
          limit: 10,
          pages: 0,
        },
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const createForum = useCallback(async (forumData: Partial<Forum>) => {
    try {
      setLoading(true);
      const response = await axios.post(
        "/api/createForum",
        {
          ...forumData,
          username: localStorage.getItem("username"),
        },
        {
          headers: {
            Authorization: `Bearer ${
              localStorage.getItem("userId") || "test-user"
            }`,
          },
        }
      );
      const newForum = response.data.forum;
      setForums((prevForums) => [...prevForums, newForum]);
      // Track forum creation
      trackForumCreated(
        newForum.forumId,
        newForum.title,
        newForum.gameTitle,
        newForum.category
      );
      return newForum;
    } catch (err: any) {
      setError(
        err.response?.data?.error || err.message || "Failed to create forum"
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteForum = useCallback(
    async (forumId: string) => {
      try {
        setLoading(true);
        await axios.delete(`/api/deleteForum?forumId=${forumId}`, {
          headers: {
            Authorization: `Bearer ${
              localStorage.getItem("userId") || "test-user"
            }`,
          },
        });
        setForums((prevForums) => prevForums.filter((f) => f._id !== forumId));
        if (currentForum?._id === forumId) {
          setCurrentForum(null);
        }
      } catch (err: any) {
        setError(
          err.response?.data?.error || err.message || "Failed to delete forum"
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const addPost = useCallback(
    async (
      forumId: string,
      message: string,
      imageFiles?: File[],
      replyTo?: string,
      options?: { onStatus?: (status: "loading" | "error" | "success", message?: string) => void }
    ) => {
      try {
        setLoading(true);
        options?.onStatus?.("loading");

        // Upload images first if provided
        let attachments: any[] = [];
        if (imageFiles && imageFiles.length > 0) {
          const formData = new FormData();
          imageFiles.forEach((file) => {
            formData.append("image", file);
          });
          // Add username for violation tracking
          const username = localStorage.getItem("username");
          if (username) {
            formData.append("username", username);
          }

          try {
            const uploadResponse = await axios.post(
              "/api/uploadForumImage",
              formData
            );

            if (uploadResponse.data.success && uploadResponse.data.images) {
              attachments = uploadResponse.data.images.map((img: any) => ({
                type: "image",
                url: img.url,
                name: img.name,
              }));
            }
          } catch (uploadError: any) {
            // Log detailed error to console for debugging
            console.error("Image upload error:", {
              status: uploadError.response?.status,
              error: uploadError.response?.data?.error,
              message: uploadError.response?.data?.message,
              details: uploadError.response?.data?.details,
              violationResult: uploadError.response?.data?.violationResult,
              moderationResult: uploadError.response?.data?.moderationResult,
              fullError: uploadError,
            });

            // Handle image moderation errors with violation tracking
            if (
              uploadError.response?.status === 400 ||
              uploadError.response?.status === 403
            ) {
              const errorData = uploadError.response?.data;

              // Log violation details if present
              if (errorData?.violationResult) {
                console.warn("Image violation detected:", {
                  action: errorData.violationResult.action,
                  warningCount: errorData.violationResult.count,
                  details: errorData.details,
                });
              } else if (
                errorData?.error === "Image contains inappropriate content"
              ) {
                console.warn(
                  "Image rejected by moderation:",
                  errorData.details
                );
              }
            }
            // Re-throw with a user-friendly error message attached
            const userFriendlyError = new Error(
              uploadError.response?.data?.message ||
                uploadError.response?.data?.error ||
                "Failed to upload image. Please try again."
            );
            (userFriendlyError as any).response = uploadError.response;
            (userFriendlyError as any).isUploadError = true;
            throw userFriendlyError;
          }
        }

        const response = await axios.post(
          "/api/addPostToForum",
          {
            forumId,
            message,
            username: localStorage.getItem("username"),
            attachments,
            replyTo,
          },
          {
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem("userId") || "test-user"
              }`,
            },
          }
        );

        const updatedForum = response.data.forum;
        setForums((prevForums) =>
          prevForums.map((f) => (f._id === forumId ? updatedForum : f))
        );
        if (currentForum?._id === forumId) {
          setCurrentForum(updatedForum);
        }
        options?.onStatus?.("success");
      } catch (err: any) {
        // Check for content policy violation - show user-friendly message
        const duplicate =
          err.response?.status === 400 &&
          err.response?.data?.error === "Duplicate post detected";

        if (
          err.response?.status === 400 &&
          err.response?.data?.isContentViolation
        ) {
          console.warn("Content policy violation (400):", {
            status: err.response.status,
            username: localStorage.getItem("username"),
            message: err.response.data.message,
            warningCount: err.response.data.warningCount,
          });
          const msg =
            err.response.data.message ||
            "Your message contains inappropriate content.";
          setError(msg);
          options?.onStatus?.("error", msg);
        } else if (duplicate) {
          console.warn("Duplicate post detected:", {
            username: localStorage.getItem("username"),
            forumId,
          });
          const msg =
            err.response?.data?.message ||
            "You've already posted this message recently.";
          setError(msg);
          options?.onStatus?.("error", msg);
        } else {
          if (err.response?.status === 400) {
            console.error("Request failed with status code 400:", {
              error: err.response?.data?.error,
              details: err.response?.data?.details,
            });
          }
          const msg =
            err.response?.data?.error ||
            err.response?.data?.message ||
            err.message ||
            "Failed to add post";
          setError(msg);
          options?.onStatus?.("error", msg);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const editPost = useCallback(
    async (
      forumId: string,
      postId: string,
      message: string,
      imageFiles?: File[],
      existingAttachments?: any[]
    ) => {
      try {
        setLoading(true);

        // Upload new images first if provided
        let attachments: any[] = existingAttachments || [];
        if (imageFiles && imageFiles.length > 0) {
          const formData = new FormData();
          imageFiles.forEach((file) => {
            formData.append("image", file);
          });
          // Add username for violation tracking
          const username = localStorage.getItem("username");
          if (username) {
            formData.append("username", username);
          }

          try {
            const uploadResponse = await axios.post(
              "/api/uploadForumImage",
              formData
            );

            if (uploadResponse.data.success && uploadResponse.data.images) {
              const newAttachments = uploadResponse.data.images.map(
                (img: any) => ({
                  type: "image",
                  url: img.url,
                  name: img.name,
                })
              );
              // Combine existing attachments with new ones
              attachments = [...attachments, ...newAttachments];
            }
          } catch (uploadError: any) {
            // Log detailed error to console for debugging
            console.error("Image upload error (edit post):", {
              status: uploadError.response?.status,
              error: uploadError.response?.data?.error,
              message: uploadError.response?.data?.message,
              details: uploadError.response?.data?.details,
              violationResult: uploadError.response?.data?.violationResult,
              moderationResult: uploadError.response?.data?.moderationResult,
              fullError: uploadError,
            });

            // Handle image moderation errors with violation tracking
            if (
              uploadError.response?.status === 400 ||
              uploadError.response?.status === 403
            ) {
              const errorData = uploadError.response?.data;

              // Log violation details if present
              if (errorData?.violationResult) {
                console.warn("Image violation detected:", {
                  action: errorData.violationResult.action,
                  warningCount: errorData.violationResult.count,
                  details: errorData.details,
                });
              } else if (
                errorData?.error === "Image contains inappropriate content"
              ) {
                console.warn(
                  "Image rejected by moderation:",
                  errorData.details
                );
              }
            }
            // Re-throw with a user-friendly error message attached
            const userFriendlyError = new Error(
              uploadError.response?.data?.message ||
                uploadError.response?.data?.error ||
                "Failed to upload image. Please try again."
            );
            (userFriendlyError as any).response = uploadError.response;
            (userFriendlyError as any).isUploadError = true;
            throw userFriendlyError;
          }
        }

        const response = await axios.put(
          `/api/editPost?forumId=${forumId}&postId=${postId}`,
          {
            message,
            username: localStorage.getItem("username"),
            attachments: attachments.length > 0 ? attachments : undefined,
          },
          {
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem("userId") || "test-user"
              }`,
            },
          }
        );

        const updatedForum = response.data.forum;
        setForums((prevForums) =>
          prevForums.map((f) => (f._id === forumId ? updatedForum : f))
        );
        if (currentForum?._id === forumId) {
          setCurrentForum(updatedForum);
        }
      } catch (err: any) {
        setError(
          err.response?.data?.error || err.message || "Failed to edit post"
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const deletePost = useCallback(
    async (forumId: string, postId: string) => {
      try {
        setLoading(true);
        const response = await axios.delete(
          `/api/deletePost?forumId=${forumId}&postId=${postId}`,
          {
            data: {
              username: localStorage.getItem("username"),
            },
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem("userId") || "test-user"
              }`,
            },
          }
        );

        const updatedForum = response.data.forum;
        setForums((prevForums) =>
          prevForums.map((f) => (f._id === forumId ? updatedForum : f))
        );
        if (currentForum?._id === forumId) {
          setCurrentForum(updatedForum);
        }
      } catch (err: any) {
        setError(err.message || "Failed to delete post");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const likePost = useCallback(
    async (forumId: string, postId: string) => {
      try {
        setLoading(true);
        const response = await axios.post(
          "/api/likePost",
          {
            forumId,
            postId,
            username: localStorage.getItem("username"),
          },
          {
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem("userId") || "test-user"
              }`,
            },
          }
        );

        const updatedForum = response.data.forum;
        setForums((prevForums) =>
          prevForums.map((f) => (f._id === forumId ? updatedForum : f))
        );
        if (currentForum?._id === forumId) {
          setCurrentForum(updatedForum);
        }
      } catch (err: any) {
        setError(err.message || "Failed to like post");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const reactToPost = useCallback(
    async (forumId: string, postId: string, reactionType: string) => {
      try {
        setLoading(true);
        const response = await axios.post(
          "/api/reactToPost",
          {
            forumId,
            postId,
            username: localStorage.getItem("username"),
            reactionType,
          },
          {
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem("userId") || "test-user"
              }`,
            },
          }
        );

        const updatedForum = response.data.forum;
        if (updatedForum) {
          setForums((prevForums) =>
            prevForums.map((f) => (f.forumId === forumId ? updatedForum : f))
          );
          if (currentForum?.forumId === forumId) {
            setCurrentForum(updatedForum);
          }
        }
      } catch (err: any) {
        setError(err.message || "Failed to react to post");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const updateForumUsers = useCallback(
    async (forumId: string, allowedUsers: string[]) => {
      try {
        setLoading(true);
        const response = await axios.post(
          "/api/updateForumsAllowedUsers",
          {
            forumId,
            allowedUsers,
            username: localStorage.getItem("username"),
          },
          {
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem("userId") || "test-user"
              }`,
            },
          }
        );

        const updatedForum = response.data.forum;
        setForums((prevForums) =>
          prevForums.map((f) => (f.forumId === forumId ? updatedForum : f))
        );
        if (currentForum?.forumId === forumId) {
          setCurrentForum(updatedForum);
        }
        return true;
      } catch (err: any) {
        setError(
          err.response?.data?.error ||
            err.message ||
            "Failed to update forum users"
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const updateForumStatus = useCallback(
    async (forumId: string, status: 'active' | 'archived') => {
      try {
        setLoading(true);
        const response = await axios.post(
          "/api/updateForumStatus",
          // Identified by the auth cookie (creator or admin check is server-side)
          { forumId, status }
        );
        const updatedForum = response.data.forum;
        if (updatedForum) {
          setForums((prevForums) =>
            prevForums.map((f) => (f.forumId === forumId ? updatedForum : f))
          );
          if (currentForum?.forumId === forumId) {
            setCurrentForum(updatedForum);
          }
        }
        return updatedForum ?? null;
      } catch (err: any) {
        setError(
          err.response?.data?.error ||
            err.message ||
            "Failed to update forum status"
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentForum]
  );

  const value = {
    forums,
    currentForum,
    loading,
    error,
    pagination,
    fetchForums,
    createForum,
    deleteForum,
    addPost,
    editPost,
    deletePost,
    likePost,
    reactToPost,
    updateForumUsers,
    updateForumStatus,
    setCurrentForum,
    setError,
  };

  return (
    <ForumContext.Provider value={value}>{children}</ForumContext.Provider>
  );
}

export function useForum() {
  const context = useContext(ForumContext);
  if (context === undefined) {
    throw new Error("useForum must be used within a ForumProvider");
  }
  return context;
}
