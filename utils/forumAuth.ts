/**
 * Shared authorization helpers for forum-related API routes.
 *
 * Each function returns a plain boolean so callers retain full control
 * over their own error responses — no behavior changes, just named logic
 * that can be read at a glance and updated in one place.
 */

import type { ForumLike, PostLike } from '../types';

/**
 * Returns true if the user is allowed to access the forum.
 * Public forums are always accessible.
 * Private forums require the user to be present in allowedUsers.
 */
export function hasForumAccess(forum: ForumLike, username: string): boolean {
  if (!forum.isPrivate) return true;
  const allowedUsers = Array.isArray(forum.allowedUsers) ? forum.allowedUsers : [];
  return allowedUsers.includes(username);
}

/**
 * Returns true if the user is the creator of the given post.
 */
export function isPostOwner(post: PostLike, username: string): boolean {
  return post.createdBy === username;
}

/**
 * Returns true if the user is the creator of the given forum.
 */
export function isForumOwner(forum: ForumLike, username: string): boolean {
  return forum.createdBy === username;
}
