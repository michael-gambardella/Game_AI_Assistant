import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { generateResetToken } from '../../../utils/passwordUtils';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { email, verificationCode } = req.body;

  // Validate required fields
  if (!email || !verificationCode) {
    return res.status(400).json({ 
      message: 'Email and verification code are required' 
    });
  }

  // Validate email format
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ 
      message: 'Please enter a valid email address' 
    });
  }

  // Validate verification code format (6 digits)
  if (!/^\d{6}$/.test(verificationCode)) {
    return res.status(400).json({ 
      message: 'Verification code must be 6 digits' 
    });
  }

  try {
    // Connect to database

    // Find user by email and verify code
    const user = await User.findOne({
      email,
      passwordResetCode: verificationCode,
      passwordResetCodeExpires: { $gt: new Date() } // Code must not be expired
    });

    if (!user) {
      return res.status(400).json({ 
        message: 'Invalid or expired verification code' 
      });
    }

    // Generate reset token for the actual password reset
    const resetToken = generateResetToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Update user with reset token and clear verification code
    await User.findOneAndUpdate(
      { email },
      {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
        passwordResetCode: undefined,
        passwordResetCodeExpires: undefined
      }
    );

    return res.status(200).json({
      message: 'Verification successful! You can now reset your password.',
      resetToken // Include token for immediate redirect
    });

  } catch (error) {
    console.error('Error in verify-reset-code API:', error);
    
    return res.status(500).json({
      message: 'Error verifying code. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
