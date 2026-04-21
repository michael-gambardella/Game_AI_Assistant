import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';
import { hashPassword, validatePassword } from '../../../utils/passwordUtils';
import { sendWelcomeEmail } from '../../../utils/emailService';
import { containsOffensiveContent } from '../../../utils/contentModeration';
import { handleContentViolation } from '../../../utils/violationHandler';
import { withRequestSizeLimit } from '../../../middleware/requestSizeLimit';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { email, username, password } = req.body;

  // Validate required fields
  if (!email || !username || !password) {
    return res.status(400).json({ 
      message: 'Email, username, and password are required' 
    });
  }

  // Validate email format
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ 
      message: 'Please enter a valid email address' 
    });
  }

  // Validate password strength
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    return res.status(400).json({ 
      message: passwordValidation.message 
    });
  }

  // Basic username validation
  if (username.length < 3) {
    return res.status(400).json({ 
      message: 'Username must be at least 3 characters long.' 
    });
  }
  
  if (username.length > 32) {
    return res.status(400).json({ 
      message: 'Username must be 32 characters or less.' 
    });
  }
  
  // Check for valid characters (alphanumeric, underscore, hyphen)
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ 
      message: 'Username can only contain letters, numbers, underscores, and hyphens.' 
    });
  }

  try {
    // Connect to database

    // Check if email already exists
    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail) {
      return res.status(409).json({ 
        message: 'An account with this email address already exists' 
      });
    }

    // Check if username already exists
    const existingUserByUsername = await User.findOne({ username });
    if (existingUserByUsername) {
      return res.status(409).json({ 
        message: 'Username is already taken' 
      });
    }

    // Check for offensive content in username
    const contentCheck = await containsOffensiveContent(username, email);
    if (contentCheck.isOffensive) {
      // Add a warning to the user's violation record
      const violationResult = await handleContentViolation(username, contentCheck.offendingWords);
      
      // Create a more detailed error message
      let errorMessage = 'Username contains offensive content. Please try a different username.';
      
      if (violationResult.action === 'warning') {
        errorMessage = `Username contains inappropriate content: "${contentCheck.offendingWords.join(', ')}". Warning ${violationResult.count}/3. Please choose a different username.`;
      } else if (violationResult.action === 'banned') {
        const banDate = new Date(violationResult.expiresAt).toLocaleDateString();
        errorMessage = `Username contains inappropriate content. You are temporarily banned until ${banDate}. Please try again later.`;
      } else if (violationResult.action === 'permanent_ban') {
        errorMessage = `Username contains inappropriate content. You are permanently banned from using this application.`;
      }
      
      return res.status(400).json({ 
        message: errorMessage,
        offendingWords: contentCheck.offendingWords,
        violationResult
      });
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Generate a unique userId for new users
    const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Create new user
    const newUser = new User({
      userId,
      email,
      username,
      password: hashedPassword,
      conversationCount: 0,
      hasProAccess: false, // New signups start as free users
      requiresPasswordSetup: false, // They just set their password
      achievements: [],
      progress: {
        firstQuestion: 0,
        frequentAsker: 0,
        rpgEnthusiast: 0,
        bossBuster: 0,
        platformerPro: 0,
        survivalSpecialist: 0,
        strategySpecialist: 0,
        actionAficionado: 0,
        fightingFanatic: 0,
        simulationSpecialist: 0,
        battleRoyaleMaster: 0,
        sportsChampion: 0,
        adventureAddict: 0,
        shooterSpecialist: 0,
        puzzlePro: 0,
        racingRenegade: 0,
        stealthExpert: 0,
        horrorHero: 0,
        triviaMaster: 0,
        storySeeker: 0,
        beatEmUpBrawler: 0,
        rhythmMaster: 0,
        sandboxBuilder: 0,
        shootemUpSniper: 0,
        rogueRenegade: 0,
        totalQuestions: 0,
        dailyExplorer: 0,
        speedrunner: 0,
        collectorPro: 0,
        dataDiver: 0,
        performanceTweaker: 0,
        conversationalist: 0,
        proAchievements: {
          gameMaster: 0,
          speedDemon: 0,
          communityLeader: 0,
          achievementHunter: 0,
          proStreak: 0,
          expertAdvisor: 0,
          genreSpecialist: 0,
          proContributor: 0
        }
      }
    });

    // Save user to database
    await newUser.save();

    // Send welcome email (don't wait for it to complete)
    sendWelcomeEmail(email, username).catch(error => {
      console.error('Failed to send welcome email:', error);
    });

    // Return success response (don't include password hash)
    const { password: _, ...userResponse } = newUser.toObject();

    return res.status(201).json({
      message: 'Account created successfully!',
      user: userResponse
    });

  } catch (error) {
    console.error('Error in signup API:', error);
    
    // Handle MongoDB duplicate key errors
    if (error instanceof Error && error.message.includes('duplicate key')) {
      if (error.message.includes('email')) {
        return res.status(409).json({ 
          message: 'An account with this email address already exists' 
        });
      }
      if (error.message.includes('username')) {
        return res.status(409).json({ 
          message: 'Username is already taken' 
        });
      }
    }

    return res.status(500).json({
      message: 'Error creating account. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Apply request size limiting middleware to prevent DoS attacks
export default withRequestSizeLimit(withWingmanDB(handler));
