import type { NextApiRequest, NextApiResponse } from "next";
import { withDatabase } from '../../utils/withDatabase';
import Forum from "../../models/Forum";
import { HotTopicSummary } from "../../types";

const TRENDING_LIMIT = 3;
const NEW_THIS_WEEK_LIMIT = 5;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const username =
      (req.query.username as string) || (req.headers.username as string) || "test-user";

    const accessConditions: Record<string, any> = {
      $and: [
        {
          $or: [{ isPrivate: false }, { allowedUsers: username }],
        },
        { "metadata.status": "active" },
      ],
    };

    const forums = await Forum.aggregate([
      { $match: accessConditions },
      {
        $project: {
          forumId: 1,
          title: 1,
          gameTitle: 1,
          category: 1,
          createdAt: 1,
          updatedAt: 1,
          viewCount: { $ifNull: ["$metadata.viewCount", 0] },
          totalPosts: {
            $ifNull: [
              "$metadata.totalPosts",
              { $size: { $ifNull: ["$posts", []] } },
            ],
          },
          lastActivityAt: {
            $ifNull: ["$metadata.lastActivityAt", "$updatedAt"],
          },
        },
      },
    ]);

    const now = Date.now();

    const withScores: HotTopicSummary[] = forums.map((forum: any) => {
      const viewCount = forum.viewCount || 0;
      const totalPosts = forum.totalPosts || 0;
      const lastActivityAt = forum.lastActivityAt
        ? new Date(forum.lastActivityAt)
        : forum.updatedAt
        ? new Date(forum.updatedAt)
        : null;

      const hoursSinceActivity = lastActivityAt
        ? (now - lastActivityAt.getTime()) / (1000 * 60 * 60)
        : Number.MAX_VALUE;
      const recencyScore = Math.max(0, 168 - hoursSinceActivity); // Focus on last 7 days

      const score = viewCount * 0.35 + totalPosts * 1.8 + recencyScore * 2;

      return {
        forumId: forum.forumId,
        title: forum.title,
        gameTitle: forum.gameTitle,
        category: forum.category,
        viewCount,
        totalPosts,
        lastActivityAt,
        score,
      };
    });

    const trendingTopics = withScores
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, TRENDING_LIMIT);

    const newThisWeek = withScores
      .filter((forum) => {
        if (!forum.lastActivityAt) return false;
        return now - forum.lastActivityAt.getTime() <= ONE_WEEK_MS;
      })
      .sort((a, b) => {
        const aTime = a.lastActivityAt ? a.lastActivityAt.getTime() : 0;
        const bTime = b.lastActivityAt ? b.lastActivityAt.getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, NEW_THIS_WEEK_LIMIT);

    return res.status(200).json({
      trendingTopics,
      newThisWeek,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching hot topics:", error);
    return res.status(500).json({ error: "Failed to load hot topics" });
  }
}

export default withDatabase(handler);
