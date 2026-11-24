import type { NextApiRequest, NextApiResponse } from "next";
import { withDatabase } from '../../utils/withDatabase';
import { withProAccess } from '../../middleware/checkProAccess';
import Forum from "../../models/Forum";
import { validateForumData } from "@/utils/validation";
import { requireUser } from "../../middleware/auth";
import { containsOffensiveContent } from "@/utils/contentModeration";
import { normalizeForumCategory } from "../../utils/forumCategory";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // console.log("HEADERS:", req.headers); // Commented out for production

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

    // Creator is the signed-in user (withProAccess has already confirmed they're Pro)
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const { username } = authUser;

    const { title, gameTitle, category, isPrivate } = req.body;
    const normalizedCategory = normalizeForumCategory(category);

    // Validate forum data
    const forumData = {
      title,
      gameTitle,
      category: normalizedCategory,
      isPrivate,
      allowedUsers: isPrivate ? [username] : [],
    };
    const validationErrors = validateForumData(forumData);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors[0] });
    }

    // Check both fields in one call: containsOffensiveContent records a violation itself,
    // so separate checks would count one forum as two offenses
    const contentCheck = await containsOffensiveContent(`${title}\n${gameTitle}`, username);

    if (contentCheck.isOffensive) {
      return res.status(400).json({ error: 'Content contains offensive language' });
    }

    // Check if a public forum with the same game, category, AND title already exists
    // This prevents duplicate forums like "Story of Seasons - General Discussion" being created multiple times,
    // while still allowing multiple forums per game/category as long as titles are unique.
    // Note: Private forums are allowed to have duplicates since they're user-specific
    if (!isPrivate && gameTitle && normalizedCategory && title) {
      const existingForum = await Forum.findOne({
        gameTitle: { $regex: new RegExp(`^${gameTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, // Case-insensitive exact match (escaped)
        category: normalizedCategory,
        title: { $regex: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, // Case-insensitive exact title
        isPrivate: false,
        'metadata.status': 'active'
      }).lean() as any;

      if (existingForum) {
        return res.status(409).json({ 
          error: `A public forum titled "${title}" for "${gameTitle}" (category "${normalizedCategory}") already exists. Please post in the existing forum or choose a different title.`,
          existingForum: {
            forumId: existingForum.forumId,
            title: existingForum.title,
            createdBy: existingForum.createdBy
          }
        });
      }
    }

    // Generate a unique forum ID
    const forumId = `forum_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create forum
    const forum = await Forum.create({
      forumId,
      title,
      gameTitle,
      category: normalizedCategory,
      isPrivate: !!isPrivate,
      allowedUsers: isPrivate ? [username] : [],
      createdBy: username,
      posts: [],
      metadata: {
        totalPosts: 0,
        lastActivityAt: new Date(),
        viewCount: 0,
        viewedBy: [],
        status: "active",
        gameTitle,
        category: normalizedCategory
      },
    });

    return res.status(201).json({ forum });
  } catch (error: any) {
    console.error("Error creating forum:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

const PRO_ERROR = 'Pro access required to create forums. Upgrade to Wingman Pro to create forums.';
export default withDatabase(withProAccess(handler, PRO_ERROR));
