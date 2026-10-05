import User from '../models/User';
import { generateVerificationCode, checkPasswordResetRateLimit } from './passwordUtils';
import { sendPasswordResetVerificationCode } from './emailService';

export const RESET_CODE_COOLDOWN_SECONDS = 60;
const RESET_CODE_TTL_MS = 60 * 1000;

export type ResetCodeResult =
  | { status: 'sent' }
  | { status: 'throttled'; timeRemaining: number }
  | { status: 'failed' };

/**
 * Emails a user a 6-digit password reset code (redeemed via /api/auth/verify-reset-code).
 * Shared by forgot-password and by sign-in for accounts that have no password yet - those
 * can only get in by proving they own the account's email.
 */
export async function sendPasswordResetCode(user: {
  _id: unknown;
  email?: string;
  username?: string;
  lastPasswordResetRequest?: Date;
}): Promise<ResetCodeResult> {
  if (!user.email) {
    return { status: 'failed' };
  }

  const rateLimitCheck = checkPasswordResetRateLimit(user.lastPasswordResetRequest, RESET_CODE_COOLDOWN_SECONDS);
  if (!rateLimitCheck.canRequest) {
    return { status: 'throttled', timeRemaining: rateLimitCheck.timeRemaining };
  }

  const verificationCode = generateVerificationCode();
  await User.findOneAndUpdate(
    { _id: user._id },
    {
      passwordResetCode: verificationCode,
      passwordResetCodeExpires: new Date(Date.now() + RESET_CODE_TTL_MS),
      lastPasswordResetRequest: new Date(),
    }
  );

  const emailSent = await sendPasswordResetVerificationCode(user.email, verificationCode, user.username || '');
  if (!emailSent) {
    console.error(`Failed to send password reset verification code to ${user.email}`);
    return { status: 'failed' };
  }
  return { status: 'sent' };
}
