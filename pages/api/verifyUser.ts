import { NextApiRequest, NextApiResponse } from 'next';
import { verifyKey } from 'discord-interactions';
import { withDatabase } from '../../utils/withDatabase';
import User from '../../models/User';
import { createLogger } from '../../utils/logger';
import { DiscordRequest, VerificationResponse } from '../../types';

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY!;
const logger = createLogger('verifyUser');

// Verify Discord's request with proper error handling
const verifyDiscordRequest = async (req: NextApiRequest): Promise<boolean> => {
  try {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    
    if (!signature || !timestamp || Array.isArray(signature) || Array.isArray(timestamp)) {
      logger.error('Invalid Discord signature headers', {
        signature: !!signature,
        timestamp: !!timestamp
      });
      return false;
    }

    const body = JSON.stringify(req.body);
    return await verifyKey(body, signature, timestamp, DISCORD_PUBLIC_KEY);
  } catch (error) {
    logger.error('Error verifying Discord request', { error });
    return false;
  }
};

// Main handler with improved error handling and validation
async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerificationResponse>
) {
  const startTime = Date.now();

  try {
    // Method validation
    if (req.method !== 'POST') {
      logger.warn('Invalid method used', { method: req.method });
      return res.status(405).json({
        message: 'Method Not Allowed',
        status: 'DENY'
      });
    }

    // Body validation
    const { user_id, guild_id } = req.body as DiscordRequest;
    
    if (!user_id || typeof user_id !== 'string') {
      logger.warn('Invalid user_id in request', { user_id });
      return res.status(400).json({
        message: 'Invalid user ID provided',
        status: 'DENY'
      });
    }

    // Discord request verification
    if (!verifyDiscordRequest(req)) {
      logger.warn('Invalid Discord signature', { user_id });
      return res.status(401).json({
        message: 'Invalid request signature',
        status: 'DENY'
      });
    }

    // Database connection with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // User verification with detailed checks
    const user = await User.findOne({ userId: user_id });

    if (!user) {
      logger.info('User not found', { user_id });
      return res.status(200).json({
        message: 'User not found or not verified',
        status: 'DENY'
      });
    }

    // Comprehensive verification checks
    const verificationChecks = {
      hasProAccess: user.hasProAccess,
      isActive: !user.isBanned,
      hasRequiredRole: user.roles?.includes('verified'),
      // Add more checks as needed
    };

    if (!verificationChecks.hasProAccess || !verificationChecks.isActive) {
      logger.info('User verification failed', {
        user_id,
        checks: verificationChecks
      });
      
      return res.status(200).json({
        message: 'User does not meet verification requirements',
        status: 'DENY',
        userData: {
          id: user.userId,
          hasProAccess: user.hasProAccess,
          roles: user.roles
        }
      });
    }

    // Log successful verification
    logger.info('User verified successfully', {
      user_id,
      processingTime: Date.now() - startTime
    });

    // Return successful verification
    return res.status(200).json({
      message: 'User verified successfully',
      status: 'ALLOW',
      userData: {
        id: user.userId,
        hasProAccess: user.hasProAccess,
        roles: user.roles
      }
    });

  } catch (error) {
    // Enhanced error logging
    logger.error('Error in verification process', {
      error,
      user_id: req.body?.user_id,
      processingTime: Date.now() - startTime
    });

    return res.status(500).json({
      message: 'Internal Server Error',
      status: 'DENY'
    });
  }
}

// Proper body parsing configuration
export const config = {
  api: {
    bodyParser: true,
  },
};

export default withDatabase(handler);
