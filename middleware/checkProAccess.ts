import type { NextApiRequest, NextApiResponse } from 'next';
import { checkProAccess } from '../utils/proAccessUtil';
import { requireUser } from './auth';

type AsyncApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

/**
 * HOC that enforces pro access on an API route.
 * Checks the signed-in user (session cookie / Bearer access token) - never a username from
 * the request, which would let a free user claim to be a Pro account. 401 if not signed in,
 * 403 if not Pro.
 * Usage: export default withDatabase(withProAccess(handler))
 */
export function withProAccess(
  handler: AsyncApiHandler,
  errorMessage = 'Pro access required. Upgrade to Wingman Pro.'
): AsyncApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const hasAccess = await checkProAccess(user.username, user.userId);
    if (!hasAccess) {
      return res.status(403).json({ error: errorMessage });
    }

    return handler(req, res);
  };
}
