/**
 * Admin access control utilities for Video Game Wingman
 * Admin username is configured via environment variable ADMIN_USERNAME
 */

/**
 * Get the admin username from environment variables
 * @returns The admin username or default fallback
 */
const getAdminUsername = (): string => {
  return process.env.ADMIN_USERNAME || 'LegendaryRenegade';
};

/**
 * Get the admin username for logging/debugging purposes
 * @returns The admin username (safe to log)
 */
export const getAdminUsernameForLogging = (): string => {
  return getAdminUsername();
};

/**
 * Validates if a user has admin access
 * @param username - The username to check for admin access
 * @returns Object with access status and error message if denied
 */
export const validateAdminAccess = (username: string | null | undefined) => {
  if (!username) {
    return {
      hasAccess: false,
      error: 'Authentication required for admin access'
    };
  }

  // Exact, case-sensitive match against the admin's username. Whitespace is stripped from
  // the configured value only (usernames can't contain spaces, so "Legendary Renegade" in
  // the env still means "LegendaryRenegade"). Matching case-insensitively would make a
  // different account registered as e.g. "legendaryrenegade" an admin.
  const adminUsername = getAdminUsername().replace(/\s+/g, '');
  if (username !== adminUsername) {
    return {
      hasAccess: false,
      error: 'Access denied. Admin privileges required.'
    };
  }

  return {
    hasAccess: true,
    error: null
  };
};

/**
 * Middleware function to check admin access in API routes
 * @param username - The username to check
 * @returns Throws error if access denied, returns true if access granted
 */
export const requireAdminAccess = (username: string | null | undefined) => {
  const accessCheck = validateAdminAccess(username);
  
  if (!accessCheck.hasAccess) {
    const error = new Error(accessCheck.error || 'Access denied');
    (error as any).statusCode = 403;
    throw error;
  }
  
  return true;
};

/**
 * Admin access levels for different operations
 */
export const ADMIN_ACCESS_LEVELS = {
  VIEW_FEEDBACK: 'view_feedback',
  RESPOND_FEEDBACK: 'respond_feedback',
  UPDATE_STATUS: 'update_status',
  VIEW_STATS: 'view_stats',
  MANAGE_USERS: 'manage_users'
} as const;

/**
 * Check if admin has access to specific operation
 * @param username - The username to check
 * @param operation - The operation to check access for
 * @returns Boolean indicating if user has access
 */
export const hasAdminAccess = (username: string | null | undefined, operation?: string) => {
  const baseAccess = validateAdminAccess(username);
  
  if (!baseAccess.hasAccess) {
    return false;
  }

  // Admin user has access to all operations
  const adminUsername = getAdminUsername();
  if (username === adminUsername) {
    return true;
  }

  return false;
};
