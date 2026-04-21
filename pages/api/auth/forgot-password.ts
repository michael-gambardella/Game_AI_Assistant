import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { generateVerificationCode, checkPasswordResetRateLimit } from '../../../utils/passwordUtils';
import { sendPasswordResetVerificationCode } from '../../../utils/emailService';

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

  // Validate email format
  if (!EMAIL_REGEX.test(email)) {
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
      // Check rate limiting
      const rateLimitCheck = checkPasswordResetRateLimit(user.lastPasswordResetRequest, 60);
      
      if (!rateLimitCheck.canRequest) {
        return res.status(429).json({
          message: `Please wait ${rateLimitCheck.timeRemaining} seconds before requesting another password reset.`,
          timeRemaining: rateLimitCheck.timeRemaining
        });
      }

      // Generate verification code
      const verificationCode = generateVerificationCode();
      const codeExpires = new Date(Date.now() + 60 * 1000); // 60 seconds from now

      // Update user with verification code and rate limiting
      await User.findOneAndUpdate(
        { email },
        {
          passwordResetCode: verificationCode,
          passwordResetCodeExpires: codeExpires,
          lastPasswordResetRequest: new Date()
        }
      );

      // Send verification code email
      const emailSent = await sendPasswordResetVerificationCode(email, verificationCode, user.username);
      
      if (!emailSent) {
        console.error(`Failed to send password reset verification code to ${email}`);
        // Still return success to user for security
      }
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
