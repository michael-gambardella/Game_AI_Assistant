import type { NextApiRequest, NextApiResponse } from 'next';
import Feedback from '../../../../models/Feedback';
import { requireAdminUser } from '../../../../middleware/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin identity comes from the session, never from the request
  const admin = await requireAdminUser(req, res);
  if (!admin) return;

  try {
    const { feedbackId, status, priority } = req.body;

    // Validate required fields
    if (!feedbackId) {
      return res.status(400).json({ 
        error: 'Feedback ID is required' 
      });
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ['new', 'under_review', 'in_progress', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Invalid status. Valid statuses are: ${validStatuses.join(', ')}` 
        });
      }
    }

    // Validate priority if provided
    if (priority) {
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      if (!validPriorities.includes(priority)) {
        return res.status(400).json({ 
          error: `Invalid priority. Valid priorities are: ${validPriorities.join(', ')}` 
        });
      }
    }

    // Find the feedback
    const feedback = await Feedback.findOne({ feedbackId });
    if (!feedback) {
      return res.status(404).json({ 
        error: 'Feedback not found' 
      });
    }

    // Build update object
    const updateData: any = {
      updatedAt: new Date()
    };

    if (status) {
      updateData.status = status;
    }

    if (priority) {
      updateData.priority = priority;
    }

    // If status is being updated to resolved or closed, mark as read
    if (status && ['resolved', 'closed'].includes(status)) {
      updateData['metadata.isRead'] = true;
    }

    // Update the feedback
    const updatedFeedback = await Feedback.findOneAndUpdate(
      { feedbackId },
      updateData,
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Status updated successfully',
      feedback: {
        feedbackId: updatedFeedback?.feedbackId,
        status: updatedFeedback?.status,
        priority: updatedFeedback?.priority,
        updatedAt: updatedFeedback?.updatedAt
      }
    });

  } catch (error: any) {
    console.error('Error updating feedback status:', error);
    
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
