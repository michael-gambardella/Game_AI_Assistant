import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import Feedback from '../../../models/Feedback';
import { containsOffensiveContent } from '../../../utils/contentModeration';
import { checkUserBanStatus } from '../../../utils/violationHandler';
import { checkProAccess } from '../../../utils/proAccessUtil';
import { validateFeedbackData } from '../../../utils/validation';
import { requireUser } from '../../../middleware/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Submitter identity (and whose violation record a bad word lands on) comes from the
  // session - a username/email in the body would let anyone submit as, or get banned, anyone
  const user = await requireUser(req, res);
  if (!user) return;
  const { username } = user;
  const email = user.email || '';

  try {
    
    const { 
      category, 
      title, 
      message, 
      priority = 'medium',
      attachments = []
    } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({ error: 'Your account has no email address on file' });
    }

    if (!category || !title || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: category, title, and message are required' 
      });
    }

    // Validate feedback data
    const validationErrors = validateFeedbackData({
      username,
      email,
      category,
      title,
      message,
      priority
    });

    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors[0] });
    }

    // Check if user has Pro access to determine userType
    const hasProAccess = await checkProAccess(username);
    const userType = hasProAccess ? 'pro' : 'free';

    // Check if user is currently banned (before processing feedback)
    const banStatus = await checkUserBanStatus(username);
    if (banStatus.isBanned) {
      return res.status(403).json({ 
        error: `You are banned until ${banStatus.expiresAt}. Reason: Previous content violations.`,
        banStatus
      });
    }

    // Check title and message together: containsOffensiveContent records the violation
    // itself, so one check = one warning (separate checks plus handleContentViolation used
    // to count a single submission up to three times - an instant ban)
    const contentCheck = await containsOffensiveContent(`${title}
${message}`, username);

    if (contentCheck.isOffensive) {
      const allOffendingWords = contentCheck.offendingWords || [];
      const violationResult = contentCheck.violationResult;
      
      // Check if user is banned
      if (violationResult?.action === 'banned') {
        return res.status(403).json({ 
          error: `You are banned until ${violationResult?.expiresAt}. Reason: Content violation.`,
          violationResult
        });
      }
      
      if (violationResult?.action === 'permanent_ban') {
        return res.status(403).json({ 
          error: 'You are permanently banned due to repeated content violations.',
          violationResult
        });
      }
      
      // If it's just a warning, still reject the feedback but show warning
      return res.status(400).json({ 
        error: `The following words violate our policy: ${allOffendingWords.join(', ')}. This is warning ${violationResult?.count} of 3.`,
        violationResult: {
          userViolation: violationResult
        }
      });
    }

    // Generate unique feedback ID
    const feedbackId = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create new feedback
    const feedback = await Feedback.create({
      feedbackId,
      username,
      email,
      userType,
      category,
      title,
      message,
      priority,
      metadata: {
        isRead: false,
        isArchived: false,
        tags: [],
        attachments,
        violationResult: {
          title: { isOffensive: false, offendingWords: [] },
          message: { isOffensive: false, offendingWords: [] },
          checkedAt: new Date(),
          isClean: true // This feedback passed moderation
        }
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback: {
        feedbackId: feedback.feedbackId,
        category: feedback.category,
        title: feedback.title,
        status: feedback.status,
        createdAt: feedback.createdAt
      }
    });

  } catch (error: any) {
    console.error('Error submitting feedback:', error);
    
    // Handle duplicate feedback ID error
    if (error.code === 11000) {
      return res.status(409).json({ 
        error: 'Feedback ID already exists. Please try again.' 
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map((err: any) => err.message);
      return res.status(400).json({ 
        error: `Validation error: ${validationErrors.join(', ')}` 
      });
    }

    return res.status(500).json({ 
      error: 'Internal server error. Please try again later.' 
    });
  }
}

export default withDatabase(handler);
