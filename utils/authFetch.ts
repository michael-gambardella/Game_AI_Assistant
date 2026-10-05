import { refreshAccessToken } from './tokenRefresh';

/**
 * Drop-in replacement for fetch() for calls to our own cookie-authenticated API routes.
 *
 * Sends the auth cookies, and if the access token has expired (401), refreshes it once via
 * the refresh-token cookie and retries. If the refresh fails, tokenRefresh dispatches the
 * 'sessionExpired' event (the main page then asks the user to sign in again) and the
 * original 401 response is returned to the caller.
 *
 * Plain fetch() has no refresh logic, so it fails 15 minutes after sign-in once routes
 * require a session. The shared axios instance (utils/axiosConfig) does the same job for
 * axios callers.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const options: RequestInit = { ...init, credentials: 'include' };

  const response = await fetch(input, options);
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshAccessToken();
  return refreshed ? fetch(input, options) : response;
}
