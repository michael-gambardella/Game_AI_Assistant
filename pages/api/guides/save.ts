import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import User from '../../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username, question, response, title, imageUrl } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ message: 'Question is required' });
    }

    if (!response || typeof response !== 'string' || response.trim().length === 0) {
      return res.status(400).json({ message: 'Response is required' });
    }


    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize guides array if it doesn't exist
    if (!user.guides) {
      user.guides = [];
    }

    // Generate title if not provided (extract from question or use first part of response)
    let guideTitle = title?.trim();
    if (!guideTitle) {
      // Try to extract a meaningful title from the question
      const questionLower = question.toLowerCase();
      if (questionLower.includes('guide for')) {
        guideTitle = question.replace(/guide for/i, '').trim();
      } else if (questionLower.includes('how to')) {
        guideTitle = question.replace(/how to/i, '').trim();
      } else {
        // Use first 50 characters of the question as title
        guideTitle = question.length > 50 ? question.substring(0, 50) + '...' : question;
      }
    }

    // Check if this exact guide already exists (same question and response)
    const existingGuide = user.guides.find(
      (guide: any) => 
        guide.question.trim() === question.trim() && 
        guide.response.trim() === response.trim()
    );

    if (existingGuide) {
      return res.status(400).json({ 
        message: 'This guide has already been saved',
        guide: existingGuide
      });
    }

    // Add the new guide
    const newGuide = {
      title: guideTitle,
      question: question.trim(),
      response: response.trim(),
      savedAt: new Date(),
      imageUrl: imageUrl || undefined
    };

    user.guides.push(newGuide);
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Guide saved successfully',
      guide: newGuide,
      totalGuides: user.guides.length
    });
  } catch (error) {
    console.error('Error saving guide:', error);
    return res.status(500).json({
      message: 'Error saving guide',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
