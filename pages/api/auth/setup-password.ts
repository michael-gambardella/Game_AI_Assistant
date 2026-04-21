import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { hashPassword, validatePassword } from '../../../utils/passwordUtils';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { userId, username, newPassword } = req.body;

  // Validate required fields
  if (!userId || !username || !newPassword) {
    return res.status(400).json({ 
      message: 'User ID, username, and new password are required' 
    });
  }

  // Validate password strength
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    return res.status(400).json({ 
      message: passwordValidation.message 
    });
  }

  try {
    // Connect to database

    // Find user by userId and username (double verification)
    const user = await User.findOne({
      userId: userId,
      username: username
    });

    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    // Check if user already has a password
    if (user.password) {
      return res.status(400).json({ 
        message: 'User already has a password set' 
      });
    }

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // Update user with new password
    await User.findOneAndUpdate(
      { _id: user._id },
      {
        password: hashedPassword,
        requiresPasswordSetup: false // Password is now set
      }
    );

    // Return success response (don't include password hash)
    const { password: _, ...userResponse } = user.toObject();

    return res.status(200).json({
      message: 'Password has been set successfully. Your account is now secured.',
      user: userResponse
    });

  } catch (error) {
    console.error('Error in setup-password API:', error);
    
    return res.status(500).json({
      message: 'Error setting up password. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
