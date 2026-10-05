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
  const username = admin.username; // recorded as adminResponseBy

  try {
    const { feedbackId, adminResponse } = req.body;

    // Validate required fields
    if (!feedbackId || !adminResponse) {
      return res.status(400).json({ 
        error: 'Feedback ID and admin response are required' 
      });
    }

    // Validate admin response length
    if (adminResponse.length > 2000) {
      return res.status(400).json({ 
        error: 'Admin response must be less than 2000 characters' 
      });
    }

    if (adminResponse.length < 1) {
      return res.status(400).json({ 
        error: 'Admin response cannot be empty' 
      });
    }

    // Find the feedback
    const feedback = await Feedback.findOne({ feedbackId });
    if (!feedback) {
      return res.status(404).json({ 
        error: 'Feedback not found' 
      });
    }

    // Update the feedback with admin response
    const updatedFeedback = await Feedback.findOneAndUpdate(
      { feedbackId },
      {
        adminResponse: adminResponse.trim(),
        adminResponseBy: username,
        adminResponseAt: new Date(),
        updatedAt: new Date(),
        'metadata.isRead': true
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Response added successfully',
      feedback: {
        feedbackId: updatedFeedback?.feedbackId,
        adminResponse: updatedFeedback?.adminResponse,
        adminResponseBy: updatedFeedback?.adminResponseBy,
        adminResponseAt: updatedFeedback?.adminResponseAt,
        status: updatedFeedback?.status
      }
    });

  } catch (error: any) {
    console.error('Error responding to feedback:', error);
    
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
