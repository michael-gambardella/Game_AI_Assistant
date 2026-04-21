import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../utils/withDatabase';
import Feedback from '../../../models/Feedback';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    
    const { username, page = 1, limit = 10, status, category } = req.query;

    // Validate username
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ 
        error: 'Username is required' 
      });
    }

    // Validate pagination parameters
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ 
        error: 'Page must be a positive integer' 
      });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      return res.status(400).json({ 
        error: 'Limit must be between 1 and 50' 
      });
    }

    // Build query filter
    const filter: any = { username };
    
    // Add status filter if provided
    if (status && typeof status === 'string') {
      const validStatuses = ['new', 'under_review', 'in_progress', 'resolved', 'closed'];
      if (validStatuses.includes(status)) {
        filter.status = status;
      }
    }
    
    // Add category filter if provided
    if (category && typeof category === 'string') {
      const validCategories = ['bug_report', 'feature_request', 'improvement', 'general', 'complaint', 'praise', 'privacy_inquiry', 'data_request', 'legal_matter', 'account_issue', 'subscription_issue'];
      if (validCategories.includes(category)) {
        filter.category = category;
      }
    }

    // Calculate pagination
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalCount = await Feedback.countDocuments(filter);

    // Get feedback with pagination, sorted by newest first
    const feedback = await Feedback.find(filter)
      .select('-metadata.violationResult') // Exclude violation results from user view
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    return res.status(200).json({
      success: true,
      feedback,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNextPage,
        hasPrevPage,
        limit: limitNum
      },
      filters: {
        status: status || null,
        category: category || null
      }
    });

  } catch (error: any) {
    console.error('Error fetching user feedback:', error);
    return res.status(500).json({ 
      error: 'Internal server error. Please try again later.' 
    });
  }
}

export default withDatabase(handler);
