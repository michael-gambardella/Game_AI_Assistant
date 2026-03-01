"use client";

import { useState, useEffect, useMemo, use } from "react";
import { useForum } from "../../../context/ForumContext";
import { ForumProvider } from "../../../context/ForumContext";
import axios from "axios";
import { useRouter } from "next/navigation";
import PrivateForumUserManagement from "../../../components/PrivateForumUserManagement";
import toast from "react-hot-toast";
import Image from "next/image";
import {
  trackForumPostCreated,
  trackForumView,
} from "../../../utils/analytics";

export default function ForumPageWrapper({
  params,
}: {
  params: Promise<{ forumId: string }>;
}) {
  const resolvedParams = use(params);
  return (
    <ForumProvider>
      <ForumPage params={resolvedParams} />
    </ForumProvider>
  );
}

function ForumPage({ params }: { params: { forumId: string } }) {
  const {
    currentForum,
    setCurrentForum,
    addPost,
    editPost,
    deletePost,
    likePost,
    reactToPost,
    updateForumStatus,
  } = useForum();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [statusActionLoading, setStatusActionLoading] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [editSelectedImages, setEditSelectedImages] = useState<File[]>([]);
  const [editImagePreviews, setEditImagePreviews] = useState<string[]>([]);
  const [editExistingAttachments, setEditExistingAttachments] = useState<any[]>(
    []
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [postToDelete, setPostToDelete] = useState<string | null>(null);
  const [replyingToPostId, setReplyingToPostId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [replySelectedImages, setReplySelectedImages] = useState<File[]>([]);
  const [replyImagePreviews, setReplyImagePreviews] = useState<string[]>([]);
  const router = useRouter();

  // Check if user is logged in
  useEffect(() => {
    const checkUser = () => {
      if (typeof window !== "undefined") {
        const storedUsername = localStorage.getItem("username");
        setUsername(storedUsername);
      }
    };
    checkUser();

    // Listen for storage changes to update username
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "username") {
        setUsername(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorageChange);

    // Listen for custom localStorage change events (same-tab)
    const handleCustomStorage = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.key === "username") {
        setUsername(customEvent.detail.newValue);
      }
    };
    window.addEventListener("localStorageChange", handleCustomStorage);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageChange", handleCustomStorage);
    };
  }, []);

  useEffect(() => {
    const fetchForum = async () => {
      try {
        const username = localStorage.getItem("username") || "test-user";
        const response = await axios.get(
          `/api/getForumTopic?forumId=${params.forumId}&username=${username}`
        );
        setCurrentForum(response.data);
        // Track forum view
        if (response.data) {
          trackForumView(
            params.forumId,
            response.data.title,
            response.data.gameTitle
          );
        }
        setLoading(false);
      } catch (err: any) {
        setError(err.message || "Failed to load forum");
        setLoading(false);
      }
    };

    fetchForum();
  }, [params.forumId, setCurrentForum]);

  // Check admin status for forum creator/admin actions (Archive / Restore)
  useEffect(() => {
    const checkAdmin = async () => {
      const u = localStorage.getItem("username");
      if (!u) {
        setIsAdmin(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/feedback/admin/check?username=${encodeURIComponent(u)}`
        );
        const data = await res.json();
        setIsAdmin(data.isAdmin === true);
      } catch {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, [username]);

  const isCreatorOrAdmin = Boolean(
    username && currentForum && (currentForum.createdBy === username || isAdmin)
  );
  const isReadOnly = currentForum?.metadata?.status === "archived";

  const handleForumStatusChange = async (newStatus: "active" | "archived") => {
    if (!currentForum?.forumId || !updateForumStatus) return;
    setStatusActionLoading(true);
    try {
      const updated = await updateForumStatus(currentForum.forumId, newStatus);
      if (updated) setCurrentForum(updated);
      toast.success(
        newStatus === "active"
          ? "Forum is now open for posts."
          : "Forum is archived. No one can post until you restore it."
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update status";
      toast.error(msg);
    } finally {
      setStatusActionLoading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    // Limit to 5 images
    if (files.length + selectedImages.length > 5) {
      setError("Maximum 5 images allowed per post");
      return;
    }

    // Validate file types and sizes
    const validFiles: File[] = [];
    const previews: string[] = [];

    files.forEach((file) => {
      // Check file type
      if (!file.type.startsWith("image/")) {
        setError(`${file.name} is not a valid image file`);
        return;
      }

      // Check file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} exceeds 10MB size limit`);
        return;
      }

      validFiles.push(file);
      previews.push(URL.createObjectURL(file));
    });

    setSelectedImages([...selectedImages, ...validFiles]);
    setImagePreviews([...imagePreviews, ...previews]);
  };

  const removeImage = (index: number) => {
    // Revoke object URL to free memory
    URL.revokeObjectURL(imagePreviews[index]);

    setSelectedImages(selectedImages.filter((_, i) => i !== index));
    setImagePreviews(imagePreviews.filter((_, i) => i !== index));
  };

  const [isPosting, setIsPosting] = useState(false);
  const [postStatus, setPostStatus] = useState<string | null>(null);
  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if user is logged in
    if (!username) {
      setError(
        "Please sign in to add a post. Click 'Sign In/Up' to get started."
      );
      return;
    }

    if (!message.trim() && selectedImages.length === 0) {
      setError("Please enter a message or attach an image");
      return;
    }

    try {
      setPostStatus(null);
      await addPost(
        params.forumId,
        message,
        selectedImages.length > 0 ? selectedImages : undefined,
        undefined,
        {
          onStatus: (status, msg) => {
            setIsPosting(status === "loading");
            if (status === "error" && msg) {
              toast.error(msg, {
                duration: 5000,
                style: {
                  background: "#fee2e2",
                  color: "#991b1b",
                  border: "1px solid #fca5a5",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              });
            }
            if (status === "success") {
              toast.success("Post published!", {
                duration: 3000,
                style: {
                  background: "#ecfccb",
                  color: "#3f6212",
                  border: "1px solid #bef264",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              });
              // Track forum post creation
              trackForumPostCreated(
                params.forumId,
                currentForum?.title,
                currentForum?.gameTitle,
                selectedImages.length > 0
              );
            }
          },
        }
      );
      setIsPosting(false);
      setMessage("");
      setSelectedImages([]);
      // Clean up preview URLs
      imagePreviews.forEach((url) => URL.revokeObjectURL(url));
      setImagePreviews([]);

      // Reset file input
      const fileInput = document.getElementById(
        "image-upload"
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      // Fetch updated forum data
      const username = localStorage.getItem("username") || "test-user";
      const response = await axios.get(
        `/api/getForumTopic?forumId=${params.forumId}&username=${username}`
      );
      setCurrentForum(response.data);
    } catch (err: any) {
      setIsPosting(false);
      // Handle image moderation errors with violation tracking
      if (
        err.response?.status === 400 &&
        err.response?.data?.error === "Duplicate post detected"
      ) {
        toast.error(
          err.response?.data?.message ||
            "You've already posted this message recently.",
          {
            duration: 4000,
            style: {
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fca5a5",
              padding: "16px",
              borderRadius: "8px",
              fontSize: "14px",
            },
          }
        );
      } else if (err.response?.status === 400 || err.response?.status === 403) {
        const errorData = err.response?.data;

        // Check if this is a content violation (warning/ban)
        if (errorData?.isContentViolation || errorData?.violationResult) {
          const violationResult = errorData.violationResult;

          if (violationResult?.action === "banned") {
            const message =
              errorData.message ||
              "Your account has been suspended due to content violations.";
            // Don't set error state - only show toast popup
            toast.error(message, {
              duration: 8000,
              style: {
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fca5a5",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "14px",
              },
            });
          } else if (violationResult?.action === "permanent_ban") {
            const message =
              errorData.message ||
              "Your account has been permanently suspended.";
            // Don't set error state - only show toast popup
            toast.error(message, {
              duration: 8000,
              style: {
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fca5a5",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "14px",
              },
            });
          } else {
            // Warning - show violation message
            const message =
              errorData.message ||
              `Your image contains inappropriate content. Warning (${
                violationResult?.count || 1
              }/3).`;
            const details =
              errorData.details ||
              "The image contains content that violates our community guidelines";
            // Don't set error state - only show toast popup
            toast.error(message, {
              duration: 6000,
              style: {
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fca5a5",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "14px",
              },
            });
          }
        } else if (
          errorData?.error === "Image contains inappropriate content"
        ) {
          // Image rejected but no violation (shouldn't happen, but handle gracefully)
          const details =
            errorData.details ||
            "The image contains content that violates our community guidelines";
          // Don't set error state - only show toast popup
          toast.error(
            `Image Rejected: ${details}. Please choose a different image.`,
            {
              duration: 6000,
              style: {
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fca5a5",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "14px",
              },
            }
          );
        } else {
          // Check if this is an image upload error
          if ((err as any).isUploadError) {
            const errorMessage =
              errorData?.message ||
              errorData?.error ||
              err.message ||
              "Failed to upload image to forum";
            console.error("Image upload failed:", errorMessage, errorData);
            toast.error(
              "Unable to upload image. Please try again or post without an image.",
              {
                duration: 5000,
                style: {
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fcd34d",
                },
              }
            );
          } else {
            // Other errors
            const errorMessage =
              errorData?.error ||
              errorData?.message ||
              err.message ||
              "Failed to add post";
            setError(errorMessage);
            toast.error(errorMessage);
          }
        }
      } else {
        // For other errors, show in error state
        const errorMessage =
          err.response?.data?.error || err.message || "Failed to add post";
        setError(errorMessage);
        toast.error(errorMessage);
      }
    }
  };

  const handleEditPost = (
    postId: string,
    currentMessage: string,
    existingAttachments?: any[]
  ) => {
    setEditingPostId(postId);
    setEditMessage(currentMessage);
    // Load existing attachments
    setEditExistingAttachments(existingAttachments || []);
    setEditSelectedImages([]);
    setEditImagePreviews([]);
  };

  const handleSaveEdit = async (postId: string) => {
    // Allow empty message if there are attachments (existing or new)
    const hasMessage = editMessage.trim().length > 0;
    const hasExistingAttachments = editExistingAttachments.length > 0;
    const hasNewImages = editSelectedImages.length > 0;

    if (!hasMessage && !hasExistingAttachments && !hasNewImages) {
      setError("Please enter a message or attach an image");
      return;
    }

    try {
      // Combine existing attachments with new images
      await editPost(
        params.forumId,
        postId,
        editMessage.trim() || "", // Allow empty message for image-only posts
        editSelectedImages.length > 0 ? editSelectedImages : undefined,
        editExistingAttachments
      );
      setEditingPostId(null);
      setEditMessage("");
      setEditSelectedImages([]);
      // Clean up preview URLs
      editImagePreviews.forEach((url) => URL.revokeObjectURL(url));
      setEditImagePreviews([]);
      setEditExistingAttachments([]);

      // Reset file input
      const fileInput = document.getElementById(
        "edit-image-upload"
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      // Fetch updated forum data
      const username = localStorage.getItem("username") || "test-user";
      const response = await axios.get(
        `/api/getForumTopic?forumId=${params.forumId}&username=${username}`
      );
      setCurrentForum(response.data);
    } catch (err: any) {
      // Handle image moderation errors
      if (err.response?.status === 400 || err.response?.status === 403) {
        const errorData = err.response?.data;
        if (errorData?.isContentViolation || errorData?.violationResult) {
          const violationResult = errorData.violationResult;
          if (
            violationResult?.action === "banned" ||
            violationResult?.action === "permanent_ban"
          ) {
            // Don't set error state - only show toast popup
            toast.error(
              errorData.message || "Your account has been suspended.",
              {
                duration: 8000,
                style: {
                  background: "#fee2e2",
                  color: "#991b1b",
                  border: "1px solid #fca5a5",
                  padding: "16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              }
            );
          } else {
            // Don't set error state - only show toast popup
            toast.error(
              errorData.message || "Image contains inappropriate content.",
              {
                duration: 6000,
                style: {
                  background: "#fee2e2",
                  color: "#991b1b",
                  border: "1px solid #fca5a5",
                  padding: "16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              }
            );
          }
        } else {
          // Check if this is an image upload error
          if ((err as any).isUploadError) {
            const errorMessage =
              errorData?.message ||
              errorData?.error ||
              err.message ||
              "Failed to upload image";
            console.error(
              "Image upload failed (edit):",
              errorMessage,
              errorData
            );
            toast.error(
              "Unable to upload image. Your message will be saved, but the image could not be added.",
              {
                duration: 5000,
                style: {
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fcd34d",
                },
              }
            );
            // Don't set error state for upload errors - allow post to be saved without image
          } else {
            // Don't set error state - only show toast popup
            const errorMessage =
              errorData?.error ||
              errorData?.message ||
              err.message ||
              "Failed to edit post";
            toast.error(errorMessage, {
              duration: 5000,
              style: {
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fca5a5",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "14px",
              },
            });
          }
        }
      } else {
        // Check if this is an image upload error
        if ((err as any).isUploadError) {
          console.error("Image upload failed (edit):", err.message);
          toast.error(
            "Unable to upload image. Your message will be saved, but the image could not be added.",
            {
              duration: 5000,
              style: {
                background: "#fef3c7",
                color: "#92400e",
                border: "1px solid #fcd34d",
              },
            }
          );
        } else {
          setError(err.message || "Failed to edit post");
          toast.error(err.message || "Failed to edit post");
        }
      }
    }
  };

  const handleCancelEdit = () => {
    setEditingPostId(null);
    setEditMessage("");
    setEditSelectedImages([]);
    // Clean up preview URLs
    editImagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setEditImagePreviews([]);
    setEditExistingAttachments([]);

    // Reset file input
    const fileInput = document.getElementById(
      "edit-image-upload"
    ) as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  const handleEditImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    // Limit to 5 images total (existing + new)
    if (
      files.length +
        editSelectedImages.length +
        editExistingAttachments.length >
      5
    ) {
      setError("Maximum 5 images allowed per post");
      return;
    }

    // Validate file types and sizes
    const validFiles: File[] = [];
    const previews: string[] = [];

    files.forEach((file) => {
      // Check file type
      if (!file.type.startsWith("image/")) {
        setError(`${file.name} is not a valid image file`);
        return;
      }

      // Check file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} exceeds 10MB size limit`);
        return;
      }

      validFiles.push(file);
      previews.push(URL.createObjectURL(file));
    });

    setEditSelectedImages([...editSelectedImages, ...validFiles]);
    setEditImagePreviews([...editImagePreviews, ...previews]);
  };

  const removeEditImage = (index: number, isNew: boolean) => {
    if (isNew) {
      // Remove new image
      URL.revokeObjectURL(editImagePreviews[index]);
      setEditSelectedImages(editSelectedImages.filter((_, i) => i !== index));
      setEditImagePreviews(editImagePreviews.filter((_, i) => i !== index));
    } else {
      // Remove existing attachment
      setEditExistingAttachments(
        editExistingAttachments.filter((_, i) => i !== index)
      );
    }
  };

  const handleDeletePost = (postId: string) => {
    setPostToDelete(postId);
    setShowDeleteConfirm(true);
  };

  const confirmDeletePost = async () => {
    if (!postToDelete) return;

    try {
      await deletePost(params.forumId, postToDelete);
      setShowDeleteConfirm(false);
      setPostToDelete(null);
      // Fetch updated forum data
      const username = localStorage.getItem("username") || "test-user";
      const response = await axios.get(
        `/api/getForumTopic?forumId=${params.forumId}&username=${username}`
      );
      setCurrentForum(response.data);
    } catch (err: any) {
      setError(
        err.response?.data?.error || err.message || "Failed to delete post"
      );
      setShowDeleteConfirm(false);
      setPostToDelete(null);
    }
  };

  const cancelDeletePost = () => {
    setShowDeleteConfirm(false);
    setPostToDelete(null);
  };

  const handleLikePost = async (postId: string) => {
    try {
      await likePost(params.forumId, postId);
      // Fetch updated forum data so the UI reflects the new like state/count
      const username = localStorage.getItem("username") || "test-user";
      const response = await axios.get(
        `/api/getForumTopic?forumId=${params.forumId}&username=${username}`
      );
      setCurrentForum(response.data);
    } catch (err: any) {
      setError(err.message || "Failed to like post");
    }
  };

  const handleReactToPost = async (postId: string, reactionType: string) => {
    try {
      await reactToPost(params.forumId, postId, reactionType);
      // The context already updates currentForum, so no need to fetch again
    } catch (err: any) {
      setError(err.message || "Failed to react to post");
    }
  };

  const handleStartReply = (postId: string) => {
    // Check if user is logged in
    if (!username) {
      toast.error(
        "Please sign in to reply to posts. Click 'Sign In/Up' to get started.",
        {
          duration: 4000,
          style: {
            background: "#fee2e2",
            color: "#991b1b",
            border: "1px solid #fca5a5",
            padding: "16px",
            borderRadius: "8px",
            fontSize: "14px",
          },
        }
      );
      return;
    }

    setReplyingToPostId(postId);
    setReplyMessage("");
    setReplySelectedImages([]);
    // Clean up preview URLs
    replyImagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setReplyImagePreviews([]);
  };

  const handleCancelReply = () => {
    setReplyingToPostId(null);
    setReplyMessage("");
    setReplySelectedImages([]);
    // Clean up preview URLs
    replyImagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setReplyImagePreviews([]);
  };

  const handleReplyImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    // Limit to 5 images
    if (files.length + replySelectedImages.length > 5) {
      setError("Maximum 5 images allowed per post");
      return;
    }

    // Validate file types and sizes
    const validFiles: File[] = [];
    const previews: string[] = [];

    files.forEach((file) => {
      // Check file type
      if (!file.type.startsWith("image/")) {
        setError(`${file.name} is not a valid image file`);
        return;
      }

      // Check file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} exceeds 10MB size limit`);
        return;
      }

      validFiles.push(file);
      previews.push(URL.createObjectURL(file));
    });

    setReplySelectedImages([...replySelectedImages, ...validFiles]);
    setReplyImagePreviews([...replyImagePreviews, ...previews]);
  };

  const removeReplyImage = (index: number) => {
    // Revoke object URL to free memory
    URL.revokeObjectURL(replyImagePreviews[index]);

    setReplySelectedImages(replySelectedImages.filter((_, i) => i !== index));
    setReplyImagePreviews(replyImagePreviews.filter((_, i) => i !== index));
  };

  const [isReplyPosting, setIsReplyPosting] = useState(false);
  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyingToPostId || !currentForum) return;

    // Check if user is logged in
    if (!username) {
      setError(
        "Please sign in to reply to posts. Click 'Sign In/Up' to get started."
      );
      return;
    }

    if (!replyMessage.trim() && replySelectedImages.length === 0) {
      setError("Please enter a message or attach an image");
      return;
    }

    // Find the post being replied to and get the username
    const postBeingRepliedTo = currentForum.posts?.find((p: any) => {
      if (!p._id) return false;
      const postId: string = String(p._id);
      return postId === replyingToPostId;
    });

    const repliedToUsername =
      postBeingRepliedTo?.createdBy ||
      postBeingRepliedTo?.username ||
      "Unknown";

    // Prepend @mention if not already present
    let finalMessage = replyMessage.trim();
    const mentionPattern = new RegExp(`^@${repliedToUsername}\\s+`, "i");
    if (!mentionPattern.test(finalMessage)) {
      finalMessage = `@${repliedToUsername} ${finalMessage}`;
    }

    try {
      await addPost(
        params.forumId,
        finalMessage,
        replySelectedImages.length > 0 ? replySelectedImages : undefined,
        replyingToPostId,
        {
          onStatus: (status, msg) => {
            setIsReplyPosting(status === "loading");
            if (status === "error" && msg) {
              toast.error(msg, {
                duration: 5000,
                style: {
                  background: "#fee2e2",
                  color: "#991b1b",
                  border: "1px solid #fca5a5",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              });
            }
            if (status === "success") {
              toast.success("Reply posted!", {
                duration: 3000,
                style: {
                  background: "#ecfccb",
                  color: "#3f6212",
                  border: "1px solid #bef264",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              });
            }
          },
        }
      );
      setIsReplyPosting(false);
      setReplyingToPostId(null);
      setReplyMessage("");
      setReplySelectedImages([]);
      // Clean up preview URLs
      replyImagePreviews.forEach((url) => URL.revokeObjectURL(url));
      setReplyImagePreviews([]);

      // Reset file input
      const fileInput = document.getElementById(
        "reply-image-upload"
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      // Fetch updated forum data
      const username = localStorage.getItem("username") || "test-user";
      const response = await axios.get(
        `/api/getForumTopic?forumId=${params.forumId}&username=${username}`
      );
      setCurrentForum(response.data);
    } catch (err: any) {
      setIsReplyPosting(false);
      // Handle errors similar to regular post submission
      if (
        err.response?.status === 400 &&
        err.response?.data?.error === "Duplicate post detected"
      ) {
        toast.error(
          err.response?.data?.message ||
            "You've already posted this message recently.",
          {
            duration: 4000,
            style: {
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fca5a5",
              padding: "16px",
              borderRadius: "8px",
              fontSize: "14px",
            },
          }
        );
      } else if (err.response?.status === 400 || err.response?.status === 403) {
        const errorData = err.response?.data;
        if (errorData?.isContentViolation || errorData?.violationResult) {
          const violationResult = errorData.violationResult;
          if (
            violationResult?.action === "banned" ||
            violationResult?.action === "permanent_ban"
          ) {
            toast.error(
              errorData.message || "Your account has been suspended.",
              {
                duration: 8000,
                style: {
                  background: "#fee2e2",
                  color: "#991b1b",
                  border: "1px solid #fca5a5",
                  padding: "16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              }
            );
          } else {
            toast.error(
              errorData.message || "Your reply contains inappropriate content.",
              {
                duration: 6000,
                style: {
                  background: "#fee2e2",
                  color: "#991b1b",
                  border: "1px solid #fca5a5",
                  padding: "16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                },
              }
            );
          }
        } else {
          setError(
            errorData?.error ||
              errorData?.message ||
              err.message ||
              "Failed to add reply"
          );
          toast.error(
            errorData?.error ||
              errorData?.message ||
              err.message ||
              "Failed to add reply"
          );
        }
      } else {
        setError(err.message || "Failed to add reply");
        toast.error(err.message || "Failed to add reply");
      }
    }
  };

  // Process and sort posts with reply depth calculation
  const processedPosts = useMemo(() => {
    if (!currentForum?.posts) return [];

    // Helper function to calculate reply depth (how many levels deep this reply is)
    const calculateReplyDepth = (
      post: any,
      posts: any[],
      visited: Set<string> = new Set()
    ): number => {
      if (!post.replyTo) return 0;

      const postId = post._id ? String(post._id) : null;
      const replyToId = String(post.replyTo);

      // Prevent infinite loops
      if (postId && visited.has(postId)) return 0;
      if (postId) visited.add(postId);

      const parentPost = posts.find((p: any) => {
        if (!p._id) return false;
        return String(p._id) === replyToId;
      });

      if (!parentPost) return 0;

      // If parent is also a reply, recursively calculate its depth and add 1
      if (parentPost.replyTo) {
        return calculateReplyDepth(parentPost, posts, visited) + 1;
      }

      // Parent is a top-level post, so this is depth 1
      return 1;
    };

    // Filter valid posts
    const validPosts = [...currentForum.posts].filter(
      (post) =>
        post &&
        post._id &&
        (post.message?.trim() ||
          (post.metadata?.attachments && post.metadata.attachments.length > 0))
    );

    // Build a map of post IDs to posts for quick lookup
    const postMap = new Map<string, any>();
    validPosts.forEach((post) => {
      if (post._id) {
        postMap.set(String(post._id), post);
      }
    });

    // Helper function to find post ID from @mention in message
    const findPostIdFromMention = (
      post: any,
      allPosts: any[]
    ): string | null => {
      if (!post.message) return null;

      // Extract @mention from message (format: @Username)
      const mentionMatch = post.message.match(/^@(\w+)/);
      if (!mentionMatch) return null;

      const mentionedUsername = mentionMatch[1];

      // Find the most recent post by that username before this post's timestamp
      const postTime = new Date(post.timestamp || 0).getTime();
      const candidatePosts = allPosts
        .filter((p: any) => {
          if (!p._id || p._id === post._id) return false;
          const pUsername = p.username || p.createdBy;
          if (!pUsername) return false;
          return pUsername.toLowerCase() === mentionedUsername.toLowerCase();
        })
        .filter((p: any) => {
          // Only consider posts that came before this one
          const pTime = new Date(p.timestamp || 0).getTime();
          return pTime < postTime;
        })
        .sort((a: any, b: any) => {
          // Sort by timestamp descending (most recent first)
          const aTime = new Date(a.timestamp || 0).getTime();
          const bTime = new Date(b.timestamp || 0).getTime();
          return bTime - aTime;
        });

      // Return the most recent post by that user (most likely the one being replied to)
      return candidatePosts.length > 0 ? String(candidatePosts[0]._id) : null;
    };

    // Helper function to get all replies to a post (recursively)
    // This includes posts with replyTo field AND posts with @mentions that match
    const getReplies = (parentId: string, parentUsername?: string): any[] => {
      const replies = validPosts.filter((post) => {
        // Check if post has replyTo field pointing to parent
        if (post.replyTo && String(post.replyTo) === parentId) {
          return true;
        }

        // If no replyTo field, check if it has @mention matching parent post's author
        if (!post.replyTo && parentUsername) {
          const mentionedPostId = findPostIdFromMention(post, validPosts);
          if (mentionedPostId === parentId) {
            return true;
          }
        }

        return false;
      });

      // Sort replies chronologically
      replies.sort((a, b) => {
        const aTime = new Date(a.timestamp || 0).getTime();
        const bTime = new Date(b.timestamp || 0).getTime();
        return aTime - bTime;
      });

      // For each reply, get its nested replies
      const result: any[] = [];
      replies.forEach((reply) => {
        result.push(reply);
        // Recursively get replies to this reply
        const replyUsername = reply.username || reply.createdBy;
        const nestedReplies = getReplies(String(reply._id), replyUsername);
        result.push(...nestedReplies);
      });

      return result;
    };

    // Get all top-level posts (posts without replyTo AND not detected as replies via @mention)
    const topLevelPosts = validPosts.filter((post) => {
      if (post.replyTo) return false; // Has replyTo field, so it's a reply

      // Check if it's a reply based on @mention
      // If message starts with @mention, try to find if it's replying to an existing post
      const mentionedPostId = findPostIdFromMention(post, validPosts);
      // If we found a post it's replying to, it's not a top-level post
      return !mentionedPostId;
    });

    // Sort top-level posts chronologically
    topLevelPosts.sort((a, b) => {
      const aTime = new Date(a.timestamp || 0).getTime();
      const bTime = new Date(b.timestamp || 0).getTime();
      return aTime - bTime;
    });

    // Build sorted list: for each top-level post, add it and all its replies
    const sortedPosts: any[] = [];
    const processedPostIds = new Set<string>();

    topLevelPosts.forEach((post) => {
      const postId = String(post._id);
      if (processedPostIds.has(postId)) return; // Skip if already processed as a reply

      sortedPosts.push(post);
      processedPostIds.add(postId);

      // Get all replies to this post (recursively)
      // Pass the post's username to help match @mentions
      const postUsername = post.username || post.createdBy;
      const replies = getReplies(postId, postUsername);

      replies.forEach((reply) => {
        const replyId = String(reply._id);
        if (!processedPostIds.has(replyId)) {
          sortedPosts.push(reply);
          processedPostIds.add(replyId);
        }
      });
    });

    return sortedPosts.map((post) => ({
      post,
      replyDepth: calculateReplyDepth(post, currentForum.posts || []),
    }));
  }, [currentForum?.posts]);

  if (loading) {
    return <div className="text-center">Loading forum...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!currentForum) {
    return <div>Forum not found</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-4 pt-2">
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Delete Post
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Are you sure you want to delete this post? This action cannot be
              undone.
            </p>
            <div className="flex space-x-4 justify-end">
              <button
                onClick={cancelDeletePost}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeletePost}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => router.push("/")}
        className="mb-4 px-4 py-2 rounded font-semibold transition
          bg-gray-200 text-gray-800 hover:bg-gray-300
          dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600
          border border-gray-300 dark:border-gray-600
          shadow"
      >
        ← Back to Main Page
      </button>

      {/* Forum Header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">{currentForum.title}</h1>
            <div className="mb-2 text-gray-800 dark:text-gray-200">
              <p>Game: {currentForum.gameTitle}</p>
              <p>Category: {currentForum.category}</p>
              <p>Status: {currentForum.metadata.status}</p>
              <p>Total Posts: {currentForum.posts?.length || 0}</p>
              <p>Views: {currentForum.metadata.viewCount}</p>
              {currentForum.isPrivate && (
                <p className="text-blue-600 font-semibold">🔒 Private Forum</p>
              )}
            </div>
          </div>
          {/* Archive / Restore — creator or admin only */}
          {isCreatorOrAdmin && (
            <div className="flex flex-wrap gap-2">
              {currentForum.metadata?.status === "archived" && (
                <button
                  type="button"
                  onClick={() => handleForumStatusChange("active")}
                  disabled={statusActionLoading}
                  className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                >
                  {statusActionLoading ? "Updating…" : "Restore forum"}
                </button>
              )}
              {(currentForum.metadata?.status === "active" ||
                currentForum.metadata?.status === "inactive") && (
                <button
                  type="button"
                  onClick={() => handleForumStatusChange("archived")}
                  disabled={statusActionLoading}
                  className="px-4 py-2 rounded bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50 text-sm font-medium"
                  title="Close forum to new posts. Anyone can still read; only you or an admin can restore it."
                >
                  {statusActionLoading ? "Updating…" : "Archive Forum"}
                </button>
              )}
            </div>
          )}
        </div>
        {/* Read-only banner when archived */}
        {isReadOnly && (
          <div
            className="mt-4 p-4 rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200"
            role="status"
          >
            <p className="font-medium">📁 This forum is archived.</p>
            <p className="text-sm mt-1 opacity-90">
              You can read all posts, but no one can add new posts or replies.
              {isCreatorOrAdmin &&
                " Only the forum creator or an admin can restore it to allow posting again — use the button above."}
            </p>
          </div>
        )}
      </div>

      {/* User Management for Private Forums */}
      {currentForum.isPrivate && (
        <PrivateForumUserManagement
          forumId={currentForum.forumId}
          allowedUsers={currentForum.allowedUsers}
          createdBy={currentForum.createdBy}
          currentUsername={localStorage.getItem("username") || "test-user"}
          onUsersUpdated={(newUsers) => {
            // Update the current forum state
            setCurrentForum({
              ...currentForum,
              allowedUsers: newUsers,
            });
          }}
        />
      )}

      <div className="mb-6">
        {isReadOnly ? (
          <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 text-center">
            This forum is archived. No new posts or replies.
          </div>
        ) : username ? (
          <form onSubmit={handlePostSubmit} className="space-y-4">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's new..?"
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              rows={4}
            />

            {/* Image Upload Section */}
            <div className="space-y-2">
              <label
                htmlFor="image-upload"
                className="cursor-pointer inline-flex items-center px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                Attach Images (max 5)
              </label>
              <input
                id="image-upload"
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageSelect}
                className="hidden"
              />

              {/* Image Previews */}
              {imagePreviews.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview}
                        alt={`Preview ${index + 1}`}
                        className="w-full h-32 object-cover rounded border border-gray-300 dark:border-gray-600"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove image"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
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
                  ))}
                </div>
              )}
            </div>

            {error && <div className="text-red-500 text-sm">{error}</div>}

            <button
              type="submit"
              disabled={isPosting}
              className={`px-4 py-2 rounded text-white transition-all duration-200 ${
                isPosting
                  ? "bg-gray-500 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600"
              }`}
            >
              {isPosting ? "Posting..." : "Post"}
            </button>
          </form>
        ) : (
          <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-700 text-center">
            <p className="text-gray-700 dark:text-gray-300 text-lg mb-2">
              Want to add a post?
            </p>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Sign in or sign up to join the conversation.
            </p>
            <button
              onClick={() => {
                window.location.href = "/signin";
              }}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors font-medium"
            >
              Sign In/Up
            </button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {processedPosts.map(({ post, replyDepth }) => {
          // Find the original post if this is a reply
          const replyToId: string | null = post.replyTo
            ? String(post.replyTo)
            : null;

          const originalPost = replyToId
            ? currentForum.posts?.find((p: any) => {
                if (!p._id) return false;
                const postId: string = String(p._id);
                return postId === replyToId;
              })
            : null;

          const postIdString: string = post._id
            ? String(post._id)
            : `post-${Math.random()}`;

          // Calculate indentation based on depth
          // Each level adds 3rem (48px) of indentation for better visual hierarchy (Reddit-style)
          // Check if this is a reply by looking at replyTo field OR @mention in message
          const hasReplyTo = !!post.replyTo;
          const hasMention = post.message?.trim().startsWith("@");
          const isReply = hasReplyTo || hasMention;
          const indentAmount = isReply ? Math.max(replyDepth, 1) * 3 : 0; // Ensure at least 1 level if it's a reply (3rem = 48px per level)

          // Debug logging (remove in production if needed)
          if (process.env.NODE_ENV === "development" && isReply) {
            console.log("Reply detected:", {
              postId: postIdString,
              replyTo: post.replyTo,
              hasMention,
              replyDepth,
              indentAmount,
              username: post.username || post.createdBy,
              messageStart: post.message?.substring(0, 50),
            });
          }

          return (
            <div
              key={postIdString}
              className="relative"
              style={
                isReply
                  ? {
                      marginLeft: `${indentAmount}rem`,
                    }
                  : undefined
              }
            >
              {/* Reddit-style vertical line indicator for replies */}
              {isReply && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-400 dark:bg-gray-500"
                  style={{
                    left: `-${Math.max(indentAmount - 0.5, 0.5)}rem`,
                  }}
                />
              )}
              <div
                id={`post-${postIdString}`}
                className={`p-4 rounded-lg shadow hover:shadow-md transition-shadow relative ${
                  isReply
                    ? "bg-blue-100 dark:bg-blue-950 border-l-4 border-blue-600 dark:border-blue-300 ring-2 ring-blue-200 dark:ring-blue-800"
                    : "bg-white dark:bg-gray-900"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    {post.replyTo && originalPost && (
                      <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border-l-4 border-blue-500 dark:border-blue-400">
                        <div className="flex items-center gap-2 mb-2">
                          <svg
                            className="w-5 h-5 text-blue-600 dark:text-blue-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                            />
                          </svg>
                          <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                            ↳ Replying to{" "}
                            <span className="underline">
                              {originalPost.createdBy ||
                                originalPost.username ||
                                "Unknown"}
                            </span>
                          </span>
                          <button
                            onClick={() => {
                              const originalPostElement =
                                document.getElementById(`post-${replyToId}`);
                              if (originalPostElement) {
                                originalPostElement.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                                originalPostElement.classList.add(
                                  "ring-4",
                                  "ring-blue-500",
                                  "ring-opacity-50"
                                );
                                setTimeout(() => {
                                  originalPostElement.classList.remove(
                                    "ring-4",
                                    "ring-blue-500",
                                    "ring-opacity-50"
                                  );
                                }, 2000);
                              }
                            }}
                            className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                          >
                            View original post
                          </button>
                        </div>
                        {originalPost.message && (
                          <div className="text-xs text-gray-700 dark:text-gray-300 italic pl-7 border-l-2 border-blue-300 dark:border-blue-600">
                            &quot;{originalPost.message.substring(0, 150)}
                            {originalPost.message.length > 150 ? "..." : ""}
                            &quot;
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                      {post.replyTo && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          <svg
                            className="w-3 h-3 mr-1"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                            />
                          </svg>
                          Reply
                        </span>
                      )}
                      <p className="text-gray-900 dark:text-gray-200">
                        Posted by {post.createdBy || post.username || "Unknown"}{" "}
                        on{" "}
                        {post.timestamp
                          ? new Date(post.timestamp).toLocaleString()
                          : "Unknown date"}
                        {post.metadata?.edited && (
                          <span className="text-blue-500 dark:text-blue-400 text-sm ml-2 italic">
                            (edited
                            {post.metadata.editedAt
                              ? ` on ${new Date(
                                  post.metadata.editedAt
                                ).toLocaleString()}`
                              : ""}
                            )
                          </span>
                        )}
                      </p>
                    </div>
                    {editingPostId === post._id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editMessage}
                          onChange={(e) => setEditMessage(e.target.value)}
                          placeholder="What's new..?"
                          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          rows={4}
                        />

                        {/* Image Upload Section for Editing */}
                        <div className="space-y-2">
                          <label
                            htmlFor="edit-image-upload"
                            className="cursor-pointer inline-flex items-center px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-5 w-5 mr-2"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                            Add Images (max 5 total)
                          </label>
                          <input
                            id="edit-image-upload"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleEditImageSelect}
                            className="hidden"
                          />

                          {/* Existing Attachments */}
                          {editExistingAttachments.length > 0 && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                              {editExistingAttachments.map(
                                (attachment, index) => (
                                  <div
                                    key={`existing-${index}`}
                                    className="relative group"
                                  >
                                    <Image
                                      src={attachment.url}
                                      alt={
                                        attachment.name || `Image ${index + 1}`
                                      }
                                      width={200}
                                      height={200}
                                      className="w-full h-32 object-cover rounded border border-gray-300 dark:border-gray-600"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeEditImage(index, false)
                                      }
                                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                      aria-label="Remove image"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
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
                                )
                              )}
                            </div>
                          )}

                          {/* New Image Previews */}
                          {editImagePreviews.length > 0 && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                              {editImagePreviews.map((preview, index) => (
                                <div
                                  key={`new-${index}`}
                                  className="relative group"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={preview}
                                    alt={`Preview ${index + 1}`}
                                    className="w-full h-32 object-cover rounded border border-gray-300 dark:border-gray-600"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeEditImage(index, true)}
                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    aria-label="Remove image"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 w-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
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
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleSaveEdit(post._id)}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Only show message if it exists (allow image-only posts) */}
                        {post.message && post.message.trim().length > 0 && (
                          <div className="whitespace-pre-wrap text-gray-900 dark:text-gray-100 mb-4">
                            {(() => {
                              // Parse @mentions and make them clickable
                              const message = post.message;
                              const mentionRegex = /@(\w+)/g;
                              const parts: (string | React.JSX.Element)[] = [];
                              let lastIndex = 0;
                              let match;

                              while (
                                (match = mentionRegex.exec(message)) !== null
                              ) {
                                // Add text before the mention
                                if (match.index > lastIndex) {
                                  parts.push(
                                    message.substring(lastIndex, match.index)
                                  );
                                }

                                // Add the mention as a clickable element
                                const mentionedUsername = match[1];
                                const mentionedPost = currentForum?.posts?.find(
                                  (p: any) => {
                                    const username =
                                      p.createdBy || p.username || "";
                                    return (
                                      username.toLowerCase() ===
                                      mentionedUsername.toLowerCase()
                                    );
                                  }
                                );

                                parts.push(
                                  <span
                                    key={match.index}
                                    className="inline-flex items-center px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-semibold cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                                    onClick={() => {
                                      if (mentionedPost?._id) {
                                        const postElement =
                                          document.getElementById(
                                            `post-${String(mentionedPost._id)}`
                                          );
                                        if (postElement) {
                                          postElement.scrollIntoView({
                                            behavior: "smooth",
                                            block: "center",
                                          });
                                          postElement.classList.add(
                                            "ring-4",
                                            "ring-blue-500",
                                            "ring-opacity-50"
                                          );
                                          setTimeout(() => {
                                            postElement.classList.remove(
                                              "ring-4",
                                              "ring-blue-500",
                                              "ring-opacity-50"
                                            );
                                          }, 2000);
                                        }
                                      }
                                    }}
                                    title={`Click to view @${mentionedUsername}'s posts`}
                                  >
                                    @{mentionedUsername}
                                  </span>
                                );

                                lastIndex = match.index + match[0].length;
                              }

                              // Add remaining text after the last mention
                              if (lastIndex < message.length) {
                                parts.push(message.substring(lastIndex));
                              }

                              // If no mentions found, just return the message as-is
                              if (parts.length === 0) {
                                return <span>{message}</span>;
                              }

                              return parts;
                            })()}
                          </div>
                        )}
                        {/* Display attached images */}
                        {post.metadata?.attachments &&
                          Array.isArray(post.metadata.attachments) &&
                          post.metadata.attachments.length > 0 && (
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                              {post.metadata.attachments.map(
                                (attachment: any, idx: number) =>
                                  attachment &&
                                  attachment.type === "image" &&
                                  attachment.url && (
                                    <div key={idx} className="relative">
                                      <Image
                                        src={attachment.url}
                                        alt={
                                          attachment.name || `Image ${idx + 1}`
                                        }
                                        width={800}
                                        height={600}
                                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() =>
                                          window.open(attachment.url, "_blank")
                                        }
                                        unoptimized={attachment.url.startsWith(
                                          "http"
                                        )}
                                        style={{
                                          width: "100%",
                                          height: "auto",
                                        }}
                                      />
                                    </div>
                                  )
                              )}
                            </div>
                          )}
                      </>
                    )}
                    {editingPostId !== post._id && (
                      <div className="mt-2 flex items-center space-x-4 flex-wrap">
                        {/* Emoji Reactions */}
                        <div className="flex items-center space-x-2">
                          {["🔥", "💡", "❓", "❤️"].map((emoji) => {
                            const currentUsername =
                              localStorage.getItem("username") || "test-user";
                            const reactions = post.metadata?.reactions || {};
                            const reactionUsers = reactions[emoji] || [];
                            const hasReacted =
                              reactionUsers.includes(currentUsername);
                            const count = reactionUsers.length;

                            return (
                              <button
                                key={emoji}
                                onClick={() =>
                                  handleReactToPost(post._id, emoji)
                                }
                                className={`flex items-center space-x-1 px-2 py-1 rounded-md transition-colors ${
                                  hasReacted
                                    ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                                }`}
                                title={
                                  hasReacted
                                    ? `Remove ${emoji} reaction`
                                    : `Add ${emoji} reaction`
                                }
                              >
                                <span className="text-lg">{emoji}</span>
                                {count > 0 && (
                                  <span className="text-sm font-medium">
                                    {count}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {!isReadOnly && (
                          <button
                            onClick={() => handleStartReply(post._id)}
                            className="text-green-500 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                          >
                            Reply
                          </button>
                        )}
                        {post.createdBy ===
                          (localStorage.getItem("username") || "test-user") && (
                          <>
                            <button
                              onClick={() =>
                                handleEditPost(
                                  post._id,
                                  post.message,
                                  post.metadata?.attachments || []
                                )
                              }
                              className="text-blue-500 hover:text-blue-700"
                            >
                              Edit Post
                            </button>
                            <button
                              onClick={() => handleDeletePost(post._id)}
                              className="text-red-500 hover:text-red-700"
                            >
                              Delete Post
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Reply Form */}
                    {replyingToPostId === post._id && (
                      <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-700">
                        {username ? (
                          <form
                            onSubmit={handleReplySubmit}
                            className="space-y-4"
                          >
                            <textarea
                              value={replyMessage}
                              onChange={(e) => setReplyMessage(e.target.value)}
                              placeholder="Write a reply..."
                              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                              rows={3}
                            />

                            {/* Image Upload Section for Reply */}
                            <div className="space-y-2">
                              <label
                                htmlFor="reply-image-upload"
                                className="cursor-pointer inline-flex items-center px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-5 w-5 mr-2"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                  />
                                </svg>
                                Attach Images (max 5)
                              </label>
                              <input
                                id="reply-image-upload"
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleReplyImageSelect}
                                className="hidden"
                              />

                              {/* Image Previews */}
                              {replyImagePreviews.length > 0 && (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                                  {replyImagePreviews.map((preview, index) => (
                                    <div key={index} className="relative group">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={preview}
                                        alt={`Preview ${index + 1}`}
                                        className="w-full h-32 object-cover rounded border border-gray-300 dark:border-gray-600"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => removeReplyImage(index)}
                                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        aria-label="Remove image"
                                      >
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          className="h-4 w-4"
                                          fill="none"
                                          viewBox="0 0 24 24"
                                          stroke="currentColor"
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
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex space-x-2">
                              <button
                                type="submit"
                                disabled={isReplyPosting}
                                className={`px-4 py-2 rounded text-white transition-all duration-200 ${
                                  isReplyPosting
                                    ? "bg-gray-500 cursor-not-allowed"
                                    : "bg-green-500 hover:bg-green-600"
                                }`}
                              >
                                {isReplyPosting ? "Posting..." : "Post Reply"}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelReply}
                                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-700 text-center">
                            <p className="text-gray-700 dark:text-gray-300 mb-2">
                              Want to add a reply?
                            </p>
                            <p className="text-gray-600 dark:text-gray-400 mb-4">
                              Sign in or sign up to join the conversation.
                            </p>
                            <button
                              onClick={() => {
                                window.location.href = "/signin";
                              }}
                              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors font-medium"
                            >
                              Sign In/Up
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {currentForum.posts?.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No posts yet. Be the first to add a post!
          </div>
        )}
      </div>
    </div>
  );
}
