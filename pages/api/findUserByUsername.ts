import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';
import { getSession } from '../../utils/session';

/**
 * Resolves the signed-in user's identity (userId, username, email).
 *
 * Despite the name, this never looks up an arbitrary user: it used to return the entire
 * user document (password hash, email, userId...) for any username, unauthenticated -
 * and userId + email is enough to sign in via /api/auth/exchange-token's fallback.
 * The `username` query param is accepted for backward compatibility but ignored; identity
 * comes from the auth cookie, and callers should adopt the returned username.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session?.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    // Look up by the token's stable userId (usernames can change after the token was issued)
    const user = await User.findOne({ userId: session.userId })
      .select('userId username email')
      .lean() as { userId: string; username: string; email?: string } | null;

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error finding user' });
  }
}

export default withWingmanDB(handler);
