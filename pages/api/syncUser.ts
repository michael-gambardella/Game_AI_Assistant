import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';
import { containsOffensiveContent } from '../../utils/contentModeration';
import { handleContentViolation } from '../../utils/violationHandler';
import { getSession, setAuthCookiesWithSession } from '../../utils/session';
import { hasOrphanedUsernameData, renameUsernameEverywhere } from '../../utils/renameUser';

/**
 * Changes the signed-in user's username (with content moderation).
 *
 * This route used to be an unauthenticated "sync" endpoint keyed by a userId/email in the
 * request: it could return any user's full record (including the password hash), overwrite
 * their email, rename them, create passwordless accounts, and grant early access / Pro as a
 * side effect. The account page's username change is its only caller, so that is all it
 * does now: identity comes from the auth cookie, and only the username changes.
 * Pro/early-access status is synced from the splash DB at sign-in (exchange-token).
 *
 * Data keyed by username (chat history, forum posts, feedback, ...) moves with the rename;
 * see utils/renameUser.ts.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session?.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const { username } = req.body;

  // Strict type: a non-string would be treated as a MongoDB query operator in the lookups below
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ message: 'Username is required.' });
  }
  const newUsername = username.trim();

  if (newUsername.length < 3) {
    return res.status(400).json({
      message: 'Username must be at least 3 characters long.'
    });
  }

  if (newUsername.length > 32) {
    return res.status(400).json({
      message: 'Username must be 32 characters or less.'
    });
  }

  // Check for valid characters (alphanumeric, underscore, hyphen)
  if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
    return res.status(400).json({
      message: 'Username can only contain letters, numbers, underscores, and hyphens.'
    });
  }

  try {
    // Look up by the token's stable userId (usernames can change after the token was issued)
    const user = await User.findOne({ userId: session.userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const publicUser = () => ({ userId: user.userId, username: user.username, email: user.email });

    if (user.username === newUsername) {
      return res.status(200).json({ message: 'Username unchanged', user: publicUser() });
    }

    const contentCheck = await containsOffensiveContent(newUsername, user.userId);
    if (contentCheck.isOffensive) {
      // Record the warning against the requesting user (violations are keyed by username),
      // not the rejected name nobody holds
      const violationResult = await handleContentViolation(user.username, contentCheck.offendingWords);

      // Create a more detailed error message
      let errorMessage = 'Username contains offensive content. Please try a different username.';

      if (violationResult.action === 'warning') {
        errorMessage = `Username contains inappropriate content: "${contentCheck.offendingWords.join(', ')}". Warning ${violationResult.count}/3. Please choose a different username.`;
      } else if (violationResult.action === 'banned') {
        const banDate = new Date(violationResult.expiresAt).toLocaleDateString();
        errorMessage = `Username contains inappropriate content. You are temporarily banned until ${banDate}. Please try again later.`;
      } else if (violationResult.action === 'permanent_ban') {
        errorMessage = `Username contains inappropriate content. You are permanently banned from using this application.`;
      }

      return res.status(400).json({
        message: errorMessage,
        offendingWords: contentCheck.offendingWords,
        violationResult
      });
    }

    const usernameTaken = await User.findOne({ username: newUsername, userId: { $ne: user.userId } });
    if (usernameTaken) {
      return res.status(409).json({ message: 'Username is already taken' });
    }

    // A name with leftover data from a former holder would hand this user their history
    if (await hasOrphanedUsernameData(newUsername)) {
      return res.status(409).json({ message: 'That username is unavailable. Please choose another.' });
    }

    const oldUsername = user.username;
    const renamed = await renameUsernameEverywhere(user.userId, oldUsername, newUsername);
    if (!renamed) {
      // Username changed concurrently (e.g. another tab) - nothing was modified
      return res.status(409).json({ message: 'Your username was changed elsewhere. Please refresh and try again.' });
    }
    user.username = newUsername;

    // Re-issue the session so the token carries the new username
    await setAuthCookiesWithSession(req, res, user.userId, user.username, user.email);

    return res.status(200).json({ message: 'Username updated', user: publicUser() });
  } catch (error: any) {
    if (error?.code === 11000) {
      // Unique index race: someone took the name between our check and the save
      return res.status(409).json({ message: 'Username is already taken' });
    }
    console.error('Error in syncUser API:', error);
    return res.status(500).json({ message: 'Error updating username' });
  }
}

export default withWingmanDB(handler);
