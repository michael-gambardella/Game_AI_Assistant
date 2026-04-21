import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { getImageStorage } from '../../../utils/imageStorage';
import { moderateImage } from '../../../utils/imageModeration';
import { handleImageViolation } from '../../../utils/violationHandler';

export const config = {
  api: {
    bodyParser: false,
  },
};

const tempUploadDir = path.join(process.cwd(), 'tmp', 'uploads');
const AVATAR_SIZE = 256; // Square avatar size in pixels
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_AVATAR_HISTORY = 6; // Keep last 6 avatars

// Ensure temp upload directory exists
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const validateImageFile = async (filePath: string): Promise<boolean> => {
  try {
    const buffer = fs.readFileSync(filePath);
    const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8;
    const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const isGIF = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;
    const isWEBP = buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    return isJPEG || isPNG || isGIF || isWEBP;
  } catch (error) {
    console.error('Error validating image file:', error);
    return false;
  }
};

const safeUnlink = async (filePath: string, maxRetries: number = 5, delay: number = 200): Promise<void> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return;
      }
      return;
    } catch (error: any) {
      // Handle Windows file locking issues (EBUSY, EPERM)
      // These are common on Windows when files are still in use
      if ((error.code === 'EBUSY' || error.code === 'EPERM') && attempt < maxRetries - 1) {
        // Wait longer on each retry
        await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
        continue;
      }
      // Only log if it's not a file locking issue or if we've exhausted retries
      // These errors are non-critical - temp files will be cleaned up eventually
      if (error.code !== 'EBUSY' && error.code !== 'EPERM') {
        console.warn(`Error deleting temp file ${filePath}:`, error.message);
      }
      // Silently fail for file locking issues - they're expected on Windows
      return;
    }
  }
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

    const form = formidable({
      uploadDir: tempUploadDir,
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      maxFiles: 1,
      filename: (name, ext, part) => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 9);
        return `avatar-${timestamp}-${random}${ext}`;
      }
    });

    const [fields, files] = await form.parse(req);
    const uploadedFile = files.avatar?.[0];
    const username = Array.isArray(fields.username) ? fields.username[0] : fields.username;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }

    if (!uploadedFile) {
      return res.status(400).json({ error: 'No avatar file uploaded' });
    }

    // Validate file type
    const isValidImage = await validateImageFile(uploadedFile.filepath);
    if (!isValidImage) {
      await safeUnlink(uploadedFile.filepath);
      return res.status(400).json({ error: 'Invalid image file type' });
    }

    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(uploadedFile.mimetype || '')) {
      await safeUnlink(uploadedFile.filepath);
      return res.status(400).json({ error: 'Invalid image format' });
    }

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      await safeUnlink(uploadedFile.filepath);
      return res.status(404).json({ error: 'User not found' });
    }

    // Moderate image content
    const moderationResult = await moderateImage(uploadedFile.filepath);
    if (!moderationResult.isApproved || moderationResult.isInappropriate) {
      await safeUnlink(uploadedFile.filepath);
      const violationType = moderationResult.reasons.join(', ') || 'Inappropriate content';
      await handleImageViolation(username, violationType);
      return res.status(400).json({
        error: 'Image content violates community guidelines',
        details: moderationResult.reasons.join('; ')
      });
    }

    // Resize and process image to square avatar
    const processedPath = path.join(tempUploadDir, `processed-${Date.now()}.png`);
    await sharp(uploadedFile.filepath)
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: 'cover',
        position: 'center'
      })
      .toFormat('png')
      .toFile(processedPath);

    // Small delay to ensure file handles are released (Windows issue)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Clean up original file (non-blocking - will retry or fail silently)
    safeUnlink(uploadedFile.filepath).catch(() => {
      // Silently ignore - temp file cleanup is non-critical
    });

    // Upload to storage
    const storage = getImageStorage();
    const uploadResult = await storage.uploadImage(
      processedPath,
      `avatar-${username}-${Date.now()}.png`,
      'avatars'
    );

    // Small delay before cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    // Clean up processed file (non-blocking - will retry or fail silently)
    safeUnlink(processedPath).catch(() => {
      // Silently ignore - temp file cleanup is non-critical
    });

    // Update user's avatar
    const avatarHistory = user.avatarHistory || [];
    const newAvatarEntry = {
      url: uploadResult.url,
      uploadedAt: new Date()
    };

    // Add to history (keep last 6)
    const updatedHistory = [newAvatarEntry, ...avatarHistory].slice(0, MAX_AVATAR_HISTORY);

    user.avatarUrl = uploadResult.url;
    user.avatarHistory = updatedHistory;
    await user.save();

    return res.status(200).json({
      success: true,
      avatarUrl: uploadResult.url,
      avatarHistory: updatedHistory
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    return res.status(500).json({
      error: 'Failed to upload avatar',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
