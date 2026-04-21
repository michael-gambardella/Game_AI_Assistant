import type { NextApiRequest, NextApiResponse } from "next";
import { withDatabase } from '../../utils/withDatabase';
import Forum from "../../models/Forum";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { forumId, allowedUsers, username } = req.body;

    if (!forumId || !Array.isArray(allowedUsers) || !username) {
      return res.status(400).json({ error: "forumId, allowedUsers, and username are required" });
    }

    // Validate allowedUsers: must be array of non-empty strings
    for (const user of allowedUsers) {
      if (typeof user !== "string" || user.trim().length === 0) {
        return res.status(400).json({ error: "All allowed users must be valid usernames" });
      }
    }

    // Only the creator can update allowedUsers
    const forum = await Forum.findOne({ forumId });
    if (!forum) return res.status(404).json({ error: "Forum not found" });
    if (forum.createdBy !== username) return res.status(403).json({ error: "Not authorized" });

    forum.allowedUsers = allowedUsers;
    await forum.save();

    return res.status(200).json({ forum });
  } catch (error: any) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

export default withDatabase(handler);
