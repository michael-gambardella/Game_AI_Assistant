import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { sendPasswordResetCode } from '../../../utils/passwordReset';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { email } = req.body;

  // Validate required fields
  if (!email) {
    return res.status(400).json({ 
      message: 'Email is required' 
    });
  }

  // Validate email format (string check also blocks MongoDB operator objects)
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ 
      message: 'Please enter a valid email address' 
    });
  }

  try {
    // Connect to database

    // Find user by email
    const user = await User.findOne({ email });

    // Always return success message for security (don't reveal if email exists)
    // But only process if user actually exists
    if (user) {
      const result = await sendPasswordResetCode(user);

      if (result.status === 'throttled') {
        return res.status(429).json({
          message: `Please wait ${result.timeRemaining} seconds before requesting another password reset.`,
          timeRemaining: result.timeRemaining
        });
      }
      // On 'failed', still return success to the user for security (logged in the helper)
    }

    // Always return success message (security best practice)
    return res.status(200).json({
      message: 'If an account with that email exists, we\'ve sent a verification code. Please check your email and enter the 6-digit code to proceed.'
    });

  } catch (error) {
    console.error('Error in forgot-password API:', error);
    
    // Still return success message for security
    return res.status(200).json({
      message: 'If an account with that email exists, we\'ve sent a password reset link.'
    });
  }
}

export default withWingmanDB(handler);
