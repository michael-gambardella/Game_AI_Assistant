import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ImageMapping, ImageUsage } from '../types';
import { getImageStorage } from './imageStorage';

/**
 * Sanitize game title for use in file paths
 */
function sanitizeGameTitle(gameTitle: string): string {
  return gameTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Extract game title from image filename/path
 * Returns the sanitized game title that the image represents
 */
function extractGameTitleFromImage(imagePath: string): string {
  // Extract filename from path (handles both local paths and cloud URLs)
  let filename: string;
  if (imagePath.includes('/')) {
    filename = path.basename(imagePath);
  } else {
    filename = imagePath;
  }
  
  // Remove file extension
  const nameWithoutExt = path.parse(filename).name.toLowerCase();
  
  // Remove common suffixes like "-1", "-2", etc. and cloud storage suffixes
  // Also remove ImageKit suffixes like "_wmtk-nvDt"
  const cleaned = nameWithoutExt
    .replace(/-\d+$/, '') // Remove trailing numbers like "-1", "-2"
    .replace(/_[a-z0-9]+$/i, '') // Remove ImageKit-style suffixes like "_wmtk-nvDt"
    .trim();
  
  return cleaned;
}

/**
 * Verify that an image actually belongs to a specific game title
 * Uses strict matching to ensure images aren't incorrectly matched to similar game titles
 */
function verifyImageBelongsToGame(imagePath: string, gameTitle: string): boolean {
  const imageGameTitle = extractGameTitleFromImage(imagePath);
  const expectedGameTitle = sanitizeGameTitle(gameTitle);
  
  // Remove number suffixes from both for comparison
  const imageTitleClean = imageGameTitle.replace(/-\d+$/, '');
  const expectedTitleClean = expectedGameTitle.replace(/-\d+$/, '');
  
  // Must match exactly (not just start with or have keywords in common)
  // This prevents "super-mario-odyssey" from matching "super-mario-64"
  return imageTitleClean === expectedTitleClean;
}

/**
 * Load image mapping from JSON file
 */
function loadImageMapping(): ImageMapping {
  const mappingPath = path.join(process.cwd(), 'data', 'automated-users', 'image-mapping.json');
  
  try {
    if (fs.existsSync(mappingPath)) {
      const content = fs.readFileSync(mappingPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading image mapping:', error);
  }
  
  return { games: {} };
}

/**
 * Save image mapping to JSON file
 */
function saveImageMapping(mapping: ImageMapping): void {
  const mappingPath = path.join(process.cwd(), 'data', 'automated-users', 'image-mapping.json');
  
  try {
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving image mapping:', error);
    throw error;
  }
}

/**
 * Get image directory path for a game
 */
function getGameImageDirectory(gameTitle: string): string {
  const sanitizedTitle = sanitizeGameTitle(gameTitle);
  return path.join(process.cwd(), 'public', 'uploads', 'automated-images', sanitizedTitle);
}

/**
 * Find images for a game from the curated library
 * Returns the image path if found, null otherwise
 */
export function findGameImage(gameTitle: string): string | null {
  const mapping = loadImageMapping();
  
  // Check if game exists in mapping
  // IMPORTANT: Verify that each image actually belongs to this game
  if (mapping.games[gameTitle] && mapping.games[gameTitle].images.length > 0) {
    const images = mapping.games[gameTitle].images;
    
    // Use primary image if available and verified, otherwise pick random
    if (mapping.games[gameTitle].primary) {
      const primaryImage = mapping.games[gameTitle].primary!;
      // Verify the primary image belongs to this game
      if (verifyImageBelongsToGame(primaryImage, gameTitle)) {
        if (isCloudUrl(primaryImage)) {
          return primaryImage;
        }
        const primaryPath = path.join(process.cwd(), 'public', primaryImage);
        if (fs.existsSync(primaryPath)) {
          return primaryImage;
        }
      }
    }
    
    // Try to find any existing verified image
    for (const imagePath of images) {
      // Verify the image actually belongs to this game
      if (!verifyImageBelongsToGame(imagePath, gameTitle)) {
        continue;
      }
      
      if (isCloudUrl(imagePath)) {
        return imagePath;
      }
      const fullPath = path.join(process.cwd(), 'public', imagePath);
      if (fs.existsSync(fullPath)) {
        return imagePath;
      }
    }
  }
  
  // Fallback: Check if directory exists and has images
  const gameDir = getGameImageDirectory(gameTitle);
  if (fs.existsSync(gameDir)) {
    const files = fs.readdirSync(gameDir);
    const imageFiles = files.filter(file => 
      /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
    );
    
    if (imageFiles.length > 0) {
      // Return first image found (images in game-specific directories should belong to that game)
      const sanitizedTitle = sanitizeGameTitle(gameTitle);
      const imagePath = `/uploads/automated-images/${sanitizedTitle}/${imageFiles[0]}`;
      
      // Verify the image belongs to this game (safety check)
      if (verifyImageBelongsToGame(imagePath, gameTitle)) {
        // Update mapping for future use
        if (!mapping.games[gameTitle]) {
          mapping.games[gameTitle] = { images: [] };
        }
        if (!mapping.games[gameTitle].images.includes(imagePath)) {
          mapping.games[gameTitle].images.push(imagePath);
          mapping.games[gameTitle].primary = imagePath;
          saveImageMapping(mapping);
        }
        
        return imagePath;
      }
    }
  }
  
  // Also check if image is directly in automated-images directory (without subdirectory)
  const baseDir = path.join(process.cwd(), 'public', 'uploads', 'automated-images');
  if (fs.existsSync(baseDir)) {
    const files = fs.readdirSync(baseDir);
    const imageFiles = files.filter(file => {
      if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) return false;
      
      // Use strict verification instead of loose matching
      // This prevents "super-mario-odyssey" from matching "super-mario-64"
      const imagePath = `/uploads/automated-images/${file}`;
      return verifyImageBelongsToGame(imagePath, gameTitle);
    });
    
    if (imageFiles.length > 0) {
      // Return first matching verified image
      const imagePath = `/uploads/automated-images/${imageFiles[0]}`;
      
      // Verify again before adding to mapping (double-check)
      if (verifyImageBelongsToGame(imagePath, gameTitle)) {
        // Update mapping for future use
        if (!mapping.games[gameTitle]) {
          mapping.games[gameTitle] = { images: [] };
        }
        if (!mapping.games[gameTitle].images.includes(imagePath)) {
          mapping.games[gameTitle].images.push(imagePath);
          mapping.games[gameTitle].primary = imagePath;
          saveImageMapping(mapping);
        }
        
        return imagePath;
      }
    }
  }
  
  return null;
}

function loadImageUsage(): ImageUsage {
  const usagePath = path.join(process.cwd(), 'data', 'automated-users', 'image-usage.json');
  
  try {
    if (fs.existsSync(usagePath)) {
      const content = fs.readFileSync(usagePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading image usage:', error);
  }
  
  return { usage: {} };
}

/**
 * Save image usage tracking to JSON file
 */
function saveImageUsage(usage: ImageUsage): void {
  const usagePath = path.join(process.cwd(), 'data', 'automated-users', 'image-usage.json');
  
  try {
    fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving image usage:', error);
    throw error;
  }
}

/**
 * Check if an image path is a cloud URL (starts with http:// or https://)
 */
function isCloudUrl(imagePath: string): boolean {
  return imagePath.startsWith('http://') || imagePath.startsWith('https://');
}

/**
 * Upload a local image file to cloud storage (if configured)
 * @param localImagePath - Local file path (e.g., /uploads/automated-images/game.png)
 * @returns Cloud URL if uploaded, or local path if using local storage
 */
async function uploadImageToCloud(localImagePath: string): Promise<string> {
  const imageStorage = getImageStorage();
  
  // Check if we're using local storage by checking if the upload directory exists
  // and if the storage instance is LocalImageStorage
  // We can detect this by checking environment variables for cloud storage
  const hasCloudStorage = 
    (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT) ||
    (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) ||
    (process.env.AWS_S3_BUCKET_NAME && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  
  // If no cloud storage configured, return local path
  if (!hasCloudStorage) {
    return localImagePath;
  }
  
  // Check if image is already a cloud URL
  if (isCloudUrl(localImagePath)) {
    return localImagePath;
  }
  
  // Get full file path
  const fullPath = path.join(process.cwd(), 'public', localImagePath);
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    console.warn(`Image file not found: ${fullPath}`);
    return localImagePath; // Return original path if file doesn't exist
  }
  
  try {
    // Extract filename from path
    const filename = path.basename(localImagePath);
    const sanitizedGameTitle = path.dirname(localImagePath).split('/').pop() || 'automated-images';
    const folder = `automated-images/${sanitizedGameTitle}`;
    
    // Upload to cloud storage
    const result = await imageStorage.uploadImage(fullPath, filename, folder);
    
    console.log(`Uploaded automated image to cloud: ${result.url}`);
    return result.url;
  } catch (error) {
    console.error(`Error uploading image to cloud storage: ${error}`);
    // Fall back to local path if upload fails
    return localImagePath;
  }
}

/**
 * Get a random image for a game that hasn't been used by ANY automated user before
 * @param gameTitle - The game title
 * @param username - The automated user's username (to track usage)
 * @param uploadToCloud - Whether to upload to cloud storage if not already uploaded (default: true)
 * @returns Image URL (local path or cloud URL) or null if no unused image available
 */
export async function getRandomGameImage(
  gameTitle: string, 
  username?: string,
  uploadToCloud: boolean = true
): Promise<string | null> {
  const mapping = loadImageMapping();
  const usage = loadImageUsage();
  
  // Get all available images for this game
  let availableImages: string[] = [];
  
  // First, check mapping for registered images
  // IMPORTANT: Verify that each image actually belongs to this game
  if (mapping.games[gameTitle] && mapping.games[gameTitle].images.length > 0) {
    availableImages = mapping.games[gameTitle].images.filter(img => {
      // First verify the image actually belongs to this game
      if (!verifyImageBelongsToGame(img, gameTitle)) {
        console.warn(`Image ${img} in mapping for "${gameTitle}" does not actually belong to this game. Skipping.`);
        return false;
      }
      
      // If it's already a cloud URL, include it (after verification)
      if (isCloudUrl(img)) {
        return true;
      }
      // Otherwise, check if local file exists
      const fullPath = path.join(process.cwd(), 'public', img);
      return fs.existsSync(fullPath);
    });
  }
  
  // Also scan file system for additional images that might not be in mapping
  // This ensures we find all images even if mapping is incomplete
  const baseDir = path.join(process.cwd(), 'public', 'uploads', 'automated-images');
  if (fs.existsSync(baseDir)) {
    const files = fs.readdirSync(baseDir);
    const sanitizedTitle = sanitizeGameTitle(gameTitle);
    
    const fileSystemImages = files.filter(file => {
      if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) return false;
      
      const imagePath = `/uploads/automated-images/${file}`;
      
      // Use strict verification to ensure the image actually belongs to this game
      // This prevents "super-mario-odyssey" from matching "super-mario-64"
      return verifyImageBelongsToGame(imagePath, gameTitle);
    }).map(file => `/uploads/automated-images/${file}`);
    
    // Merge file system images with mapping images, removing duplicates
    const allImagesSet = new Set([...availableImages, ...fileSystemImages]);
    availableImages = Array.from(allImagesSet);
    
    // Update mapping if we found new verified images
    // Only add images that have been verified to belong to this game
    if (fileSystemImages.length > 0) {
      if (!mapping.games[gameTitle]) {
        mapping.games[gameTitle] = { images: [] };
      }
      let mappingUpdated = false;
      fileSystemImages.forEach(img => {
        // Double-check verification before adding to mapping
        if (verifyImageBelongsToGame(img, gameTitle) && !mapping.games[gameTitle].images.includes(img)) {
          mapping.games[gameTitle].images.push(img);
          mappingUpdated = true;
        }
      });
      if (!mapping.games[gameTitle].primary && fileSystemImages.length > 0) {
        mapping.games[gameTitle].primary = fileSystemImages[0];
        mappingUpdated = true;
      }
      if (mappingUpdated) {
        saveImageMapping(mapping);
      }
    }
  }
  
  if (availableImages.length === 0) {
    return null;
  }

  // List of all automated users
  const automatedUsers = ['MysteriousMrEnter', 'WaywardJammer', 'InterdimensionalHipster'];
  
  // Collect all images that have been used by ANY automated user for this game
  const allUsedImages = new Set<string>();
  for (const user of automatedUsers) {
    const userUsedImages = usage.usage[user]?.[gameTitle] || [];
    userUsedImages.forEach(img => allUsedImages.add(img));
  }
  
  // Filter out images that have been used by any automated user
  const unusedImages = availableImages.filter(img => !allUsedImages.has(img));
  
  // If all images have been used, return null (don't reuse images)
  if (unusedImages.length === 0) {
    console.log(`All images for ${gameTitle} have been used by automated users. No unused images available.`);
    return null;
  }
  
  // Return random unused image
  const randomIndex = Math.floor(Math.random() * unusedImages.length);
  const selectedImage = unusedImages[randomIndex];
  
  // If image is not already a cloud URL and we should upload to cloud, upload it
  if (selectedImage && uploadToCloud && !isCloudUrl(selectedImage)) {
    try {
      const cloudUrl = await uploadImageToCloud(selectedImage);
      
      // Update mapping with cloud URL if it changed
      if (cloudUrl !== selectedImage && isCloudUrl(cloudUrl)) {
        const gameMapping = mapping.games[gameTitle];
        if (gameMapping) {
          // Replace local path with cloud URL in mapping
          const index = gameMapping.images.indexOf(selectedImage);
          if (index !== -1) {
            gameMapping.images[index] = cloudUrl;
          }
          if (gameMapping.primary === selectedImage) {
            gameMapping.primary = cloudUrl;
          }
          saveImageMapping(mapping);
        }
      }
      
      return cloudUrl;
    } catch (error) {
      console.error(`Error uploading image to cloud: ${error}`);
      // Fall back to local path if upload fails
      return selectedImage;
    }
  }
  
  return selectedImage;
}

/**
 * Record that an image has been used by a user for a specific game
 * @param username - The automated user's username
 * @param gameTitle - The game title
 * @param imagePath - The image path that was used
 */
export function recordImageUsage(username: string, gameTitle: string, imagePath: string): void {
  const usage = loadImageUsage();
  
  if (!usage.usage[username]) {
    usage.usage[username] = {};
  }
  
  if (!usage.usage[username][gameTitle]) {
    usage.usage[username][gameTitle] = [];
  }
  
  // Add image to used list if not already present
  if (!usage.usage[username][gameTitle].includes(imagePath)) {
    usage.usage[username][gameTitle].push(imagePath);
    saveImageUsage(usage);
  }
}

/**
 * Register a new image for a game in the mapping
 */
export function registerGameImage(gameTitle: string, imagePath: string, setAsPrimary: boolean = false): void {
  const mapping = loadImageMapping();
  
  if (!mapping.games[gameTitle]) {
    mapping.games[gameTitle] = { images: [] };
  }
  
  // Add image if not already present
  if (!mapping.games[gameTitle].images.includes(imagePath)) {
    mapping.games[gameTitle].images.push(imagePath);
  }
  
  // Set as primary if requested
  if (setAsPrimary || !mapping.games[gameTitle].primary) {
    mapping.games[gameTitle].primary = imagePath;
  }
  
  saveImageMapping(mapping);
}

/**
 * Check if an image exists for a game
 */
export function hasGameImage(gameTitle: string): boolean {
  return findGameImage(gameTitle) !== null;
}

/**
 * Get all registered games with images
 */
export function getAllGamesWithImages(): string[] {
  const mapping = loadImageMapping();
  return Object.keys(mapping.games).filter(gameTitle => {
    const gameData = mapping.games[gameTitle];
    return gameData.images.length > 0 && gameData.images.some(img => {
      const fullPath = path.join(process.cwd(), 'public', img);
      return fs.existsSync(fullPath);
    });
  });
}

/**
 * Download image from URL and store locally
 * @param imageUrl - URL of the image to download
 * @param gameTitle - Game title for organizing files
 * @param keywords - Keywords for filename
 * @param uploadToCloud - Whether to upload to cloud storage after download
 * @returns Path to the stored image (local or cloud URL), or null if download fails
 */
export async function downloadAndStoreImage(
  imageUrl: string,
  gameTitle: string,
  keywords: string[],
  uploadToCloud: boolean = true
): Promise<string | null> {
  try {
    // Download image
    console.log(`[IMAGE SEARCH] Downloading image from: ${imageUrl}`);
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000, // 10 second timeout
      maxContentLength: 10 * 1024 * 1024, // 10MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const imageBuffer = Buffer.from(response.data);
    const contentType = String(response.headers['content-type'] || '');
    
    // Validate file format
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.some(type => contentType.includes(type))) {
      console.error(`[IMAGE SEARCH] Invalid image type: ${contentType}`);
      return null;
    }
    
    // Validate file size (max 10MB)
    if (imageBuffer.length > 10 * 1024 * 1024) {
      console.error(`[IMAGE SEARCH] Image too large: ${imageBuffer.length} bytes`);
      return null;
    }
    
    // Determine file extension from content type
    let extension = 'jpg';
    if (contentType.includes('png')) extension = 'png';
    else if (contentType.includes('webp')) extension = 'webp';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) extension = 'jpg';
    
    // Generate filename
    const sanitizedGame = sanitizeGameTitle(gameTitle);
    const sanitizedKeywords = keywords
      .map(k => k.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .filter(k => k.length > 0)
      .join('-');
    const timestamp = Date.now();
    const filename = sanitizedKeywords 
      ? `${sanitizedGame}-${sanitizedKeywords}-${timestamp}.${extension}`
      : `${sanitizedGame}-${timestamp}.${extension}`;
    
    // Create directory if it doesn't exist
    const gameDir = getGameImageDirectory(gameTitle);
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }
    
    // Save locally
    const localPath = path.join(gameDir, filename);
    fs.writeFileSync(localPath, imageBuffer);
    
    // Get relative path for public access
    const relativePath = `/uploads/automated-images/${sanitizedGame}/${filename}`;
    
    console.log(`[IMAGE SEARCH] Image saved locally: ${relativePath}`);
    
    // Upload to cloud storage if configured
    if (uploadToCloud) {
      try {
        const imageStorage = getImageStorage();
        const uploadResult = await imageStorage.uploadImage(
          localPath,
          filename,
          `automated-images/${sanitizedGame}`
        );
        
        if (uploadResult && uploadResult.url) {
          console.log(`[IMAGE SEARCH] Image uploaded to cloud: ${uploadResult.url}`);
          
          // Register the cloud URL in the image mapping
          registerGameImage(gameTitle, uploadResult.url, false);
          
          return uploadResult.url;
        }
      } catch (cloudError) {
        console.error(`[IMAGE SEARCH] Cloud upload failed, using local path:`, cloudError);
        // Fall back to local path if cloud upload fails
      }
    }
    
    // Register the local path in the image mapping
    registerGameImage(gameTitle, relativePath, false);
    
    return relativePath;
  } catch (error: any) {
    console.error(`[IMAGE SEARCH] Error downloading image:`, error.message);
    if (error.response) {
      console.error(`[IMAGE SEARCH] HTTP ${error.response.status}: ${error.response.statusText}`);
    }
    return null;
  }
}
