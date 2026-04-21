import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../../utils/withDatabase';
import Feedback from '../../../../models/Feedback';
import { requireAdminAccess, getAdminUsernameForLogging } from '../../../../utils/adminAccess';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    
    const { username, page = 1, limit = 20, status, category, priority, userType, search } = req.query;
    
    // Log only the meaningful parameters (not undefined ones)
    const logParams: any = { username, page, limit };
    if (status && status !== 'undefined') logParams.status = status;
    if (category && category !== 'undefined') logParams.category = category;
    if (priority && priority !== 'undefined') logParams.priority = priority;
    if (userType && userType !== 'undefined') logParams.userType = userType;
    if (search && search !== 'undefined') logParams.search = search;
    
    // console.log('Admin all feedback API called with:', logParams); // Commented out for production

    // Validate admin access (checks against ADMIN_USERNAME environment variable)
    requireAdminAccess(username as string);
    // console.log('Admin access validated for all feedback API'); // Commented out for production

    // Validate pagination parameters
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ 
        error: 'Page must be a positive integer' 
      });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ 
        error: 'Limit must be between 1 and 100' 
      });
    }

    // Build query filter
    const filter: any = {};
    
    // Add status filter
    if (status && typeof status === 'string') {
      const validStatuses = ['new', 'under_review', 'in_progress', 'resolved', 'closed'];
      if (validStatuses.includes(status)) {
        filter.status = status;
      }
    }
    
    // Add category filter
    if (category && typeof category === 'string') {
      const validCategories = ['bug_report', 'feature_request', 'improvement', 'general', 'complaint', 'praise', 'privacy_inquiry', 'data_request', 'legal_matter', 'account_issue', 'subscription_issue'];
      if (validCategories.includes(category)) {
        filter.category = category;
      }
    }
    
    // Add priority filter
    if (priority && typeof priority === 'string') {
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      if (validPriorities.includes(priority)) {
        filter.priority = priority;
      }
    }
    
    // Add user type filter
    if (userType && typeof userType === 'string') {
      const validUserTypes = ['free', 'pro'];
      if (validUserTypes.includes(userType)) {
        filter.userType = userType;
      }
    }
    
    // Add search filter (searches title, message, and username)
    if (search && typeof search === 'string') {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { title: searchRegex },
        { message: searchRegex },
        { username: searchRegex }
      ];
    }

    // Calculate pagination
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalCount = await Feedback.countDocuments(filter);

    // Get feedback with pagination, sorted by newest first
    const feedback = await Feedback.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();
    
    // console.log('Found feedback:', feedback.length, 'items'); // Commented out for production
    // console.log('Filter used:', filter); // Commented out for production

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    // Get summary statistics
    const stats = await Feedback.aggregate([
      { $group: {
        _id: null,
        total: { $sum: 1 },
        new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
        underReview: { $sum: { $cond: [{ $eq: ['$status', 'under_review'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
        resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
        closed: { $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] } },
        critical: { $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] } },
        high: { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } },
        proUsers: { $sum: { $cond: [{ $eq: ['$userType', 'pro'] }, 1, 0] } },
        freeUsers: { $sum: { $cond: [{ $eq: ['$userType', 'free'] }, 1, 0] } }
      }}
    ]);

    return res.status(200).json({
      success: true,
      feedbacks: feedback,
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
        category: category || null,
        priority: priority || null,
        userType: userType || null,
        search: search || null
      },
      stats: stats[0] || {
        total: 0,
        new: 0,
        underReview: 0,
        inProgress: 0,
        resolved: 0,
        closed: 0,
        critical: 0,
        high: 0,
        proUsers: 0,
        freeUsers: 0
      }
    });

  } catch (error: any) {
    console.error('Error fetching admin feedback:', error);
    
    // Handle admin access errors
    if (error.statusCode === 403) {
      return res.status(403).json({ 
        error: error.message || 'Access denied' 
      });
    }
    
    return res.status(500).json({ 
      error: 'Internal server error. Please try again later.' 
    });
  }
}

export default withDatabase(handler);
