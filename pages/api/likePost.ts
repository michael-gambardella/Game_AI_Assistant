import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from '../../middleware/auth';
import { withDatabase } from '../../utils/withDatabase';
import Forum from "../../models/Forum";
import { hasForumAccess } from "../../utils/forumAuth";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Identity comes from the signed-in session, never the request (middleware/auth.ts)
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const { username } = authUser;
    const { forumId, postId } = req.body;

    if (!forumId || !postId || !username) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const forum = await Forum.findOne({ forumId });
    if (!forum) {
      return res.status(404).json({ error: "Forum not found" });
    }

    // Private forums: only members can like/react (same rule as reading and posting)
    if (!hasForumAccess(forum, username)) {
      return res.status(403).json({ error: "Not authorized to access this forum" });
    }

    const post = forum.posts.id(postId);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Ensure likes is an array of usernames in post.metadata
    if (!post.metadata.likes) post.metadata.likes = 0;
    if (!post.metadata.likedBy) post.metadata.likedBy = [];

    const userIndex = post.metadata.likedBy.indexOf(username);
    if (userIndex === -1) {
      // User has not liked yet, so like
      post.metadata.likedBy.push(username);
    } else {
      // User has already liked, so unlike
      post.metadata.likedBy.splice(userIndex, 1);
    }
    post.metadata.likes = post.metadata.likedBy.length;

    await forum.save();

    return res.status(200).json({ post });
  } catch (error) {
    console.error("Error liking post:", error);
    return res.status(500).json({ error: "Failed to like post" });
  }
}

export default withDatabase(handler);
