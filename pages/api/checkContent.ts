import type { NextApiRequest, NextApiResponse } from 'next';
import { containsOffensiveContent } from '../../utils/contentModeration';
import { requireUser } from '../../middleware/auth';

/**
 * Server-side moderation check for content typed in the browser.
 *
 * Offensive content records a warning (and eventually a ban) on the offender's violation
 * record, so the offender is the signed-in user - never a username from the request, which
 * would let anyone get any user banned.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const { content } = req.body;

    if (typeof content !== 'string' || !content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Records the violation itself (exactly once) when content is offensive
    const contentCheck = await containsOffensiveContent(content, user.username);

    if (contentCheck.isOffensive) {
      return res.status(403).json({
        error: 'Content violation detected',
        offendingWords: contentCheck.offendingWords,
        violationResult: contentCheck.violationResult
      });
    }

    return res.status(200).json({ isValid: true });
  } catch (error) {
    console.error('Error checking content:', error);
    return res.status(500).json({ error: 'Failed to check content' });
  }
}
