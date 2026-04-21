import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../../../utils/withDatabase';
import Feedback from '../../../../models/Feedback';
import { requireAdminAccess } from '../../../../utils/adminAccess';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    
    const { username, timeframe = '30' } = req.query;
    // console.log('Admin stats API called with username:', username); // Commented out for production

    // Validate admin access
    requireAdminAccess(username as string);
    // console.log('Admin access validated successfully'); // Commented out for production

    // Validate timeframe
    const timeframeDays = parseInt(timeframe as string);
    if (isNaN(timeframeDays) || timeframeDays < 1 || timeframeDays > 365) {
      return res.status(400).json({ 
        error: 'Timeframe must be between 1 and 365 days' 
      });
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframeDays);

    // Get overall statistics - simplified approach
    // console.log('Starting overall stats aggregation...'); // Commented out for production
    
    // First, let's try a simple count to see if the model works
    const totalFeedback = await Feedback.countDocuments();
    // console.log('Total feedback count:', totalFeedback); // Commented out for production
    
    // Get basic stats using simple queries instead of complex aggregation
    const newFeedback = await Feedback.countDocuments({ status: 'new' });
    const underReview = await Feedback.countDocuments({ status: 'under_review' });
    const inProgress = await Feedback.countDocuments({ status: 'in_progress' });
    const resolved = await Feedback.countDocuments({ status: 'resolved' });
    const closed = await Feedback.countDocuments({ status: 'closed' });
    const critical = await Feedback.countDocuments({ priority: 'critical' });
    const high = await Feedback.countDocuments({ priority: 'high' });
    const medium = await Feedback.countDocuments({ priority: 'medium' });
    const low = await Feedback.countDocuments({ priority: 'low' });
    const proUsers = await Feedback.countDocuments({ userType: 'pro' });
    const freeUsers = await Feedback.countDocuments({ userType: 'free' });
    const withResponses = await Feedback.countDocuments({ adminResponse: { $ne: null } });
    
    const overallStats = [{
      totalFeedback,
      newFeedback,
      underReview,
      inProgress,
      resolved,
      closed,
      critical,
      high,
      medium,
      low,
      proUsers,
      freeUsers,
      withResponses
    }];
    
    // console.log('Overall stats completed:', overallStats); // Commented out for production

    // Get timeframe-specific statistics - simplified
    // console.log('Getting timeframe stats...'); // Commented out for production
    const timeframeTotal = await Feedback.countDocuments({ 
      createdAt: { $gte: startDate, $lte: endDate } 
    });
    // console.log('Timeframe total:', timeframeTotal); // Commented out for production
    
    const timeframeStats = [{
      totalFeedback: timeframeTotal,
      newFeedback: 0,
      underReview: 0,
      inProgress: 0,
      resolved: 0,
      closed: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      proUsers: 0,
      freeUsers: 0,
      withResponses: 0
    }];

    // Get category breakdown - simplified
    // console.log('Getting category breakdown...'); // Commented out for production
    const categoryStats: { [key: string]: number } = {};
    const categories = ['bug_report', 'feature_request', 'improvement', 'general', 'complaint', 'praise', 'privacy_inquiry', 'data_request', 'legal_matter', 'account_issue', 'subscription_issue'];
    for (const category of categories) {
      const count = await Feedback.countDocuments({ category });
      if (count > 0) {
        categoryStats[category] = count;
      }
    }
    // console.log('Category stats:', categoryStats); // Commented out for production

    // Get daily feedback count for the timeframe - simplified
    // console.log('Getting daily stats...'); // Commented out for production
    const dailyStats: any[] = [];
    // console.log('Daily stats:', dailyStats); // Commented out for production

    // Get top users by feedback count - simplified
    // console.log('Getting top users...'); // Commented out for production
    const topUsers: any[] = [];
    // console.log('Top users:', topUsers); // Commented out for production

    return res.status(200).json({
      success: true,
      timeframe: {
        days: timeframeDays,
        startDate,
        endDate
      },
      overall: overallStats[0] || {
        totalFeedback: 0,
        newFeedback: 0,
        underReview: 0,
        inProgress: 0,
        resolved: 0,
        closed: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        proUsers: 0,
        freeUsers: 0,
        withResponses: 0
      },
      timeframeStats: timeframeStats[0] || {
        totalFeedback: 0,
        newFeedback: 0,
        underReview: 0,
        inProgress: 0,
        resolved: 0,
        closed: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        proUsers: 0,
        freeUsers: 0,
        withResponses: 0
      },
      categories: categoryStats,
      dailyStats,
      topUsers
    });

  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    
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
