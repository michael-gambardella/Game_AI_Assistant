import type { NextApiRequest, NextApiResponse } from 'next';
import { checkProAccess } from '../utils/proAccessUtil';

type AsyncApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

/**
 * HOC that enforces pro access on an API route.
 * Extracts username from req.body or req.query, returns 403 if not pro.
 * Usage: export default withDatabase(withProAccess(handler))
 */
export function withProAccess(
  handler: AsyncApiHandler,
  errorMessage = 'Pro access required. Upgrade to Wingman Pro.'
): AsyncApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const username =
      (typeof req.body?.username === 'string' && req.body.username) ||
      (typeof req.query?.username === 'string' && req.query.username) ||
      null;

    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const hasAccess = await checkProAccess(username);
    if (!hasAccess) {
      return res.status(403).json({ error: errorMessage });
    }

    return handler(req, res);
  };
}
