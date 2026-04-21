import type { NextApiRequest, NextApiResponse } from "next";
import { withDatabase } from '../../utils/withDatabase';
import Forum from "../../models/Forum";

// Valid reaction types
const VALID_REACTIONS = ["🔥", "💡", "❓", "❤️"];

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { forumId, postId, username, reactionType } = req.body;

    if (!forumId || !postId || !username || !reactionType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate reaction type
    if (!VALID_REACTIONS.includes(reactionType)) {
      return res.status(400).json({
        error: `Invalid reaction type. Must be one of: ${VALID_REACTIONS.join(", ")}`,
      });
    }

    const forum = await Forum.findOne({ forumId });
    if (!forum) {
      return res.status(404).json({ error: "Forum not found" });
    }

    const post = forum.posts.id(postId);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Initialize reactions if it doesn't exist
    if (!post.metadata.reactions) {
      post.metadata.reactions = {};
    }

    // Ensure the reaction type array exists
    if (!post.metadata.reactions[reactionType]) {
      post.metadata.reactions[reactionType] = [];
    }

    // Toggle reaction: add if not present, remove if present
    const reactionArray = post.metadata.reactions[reactionType] as string[];
    const userIndex = reactionArray.indexOf(username);

    let updatedReactions: any;
    if (userIndex === -1) {
      // User has not reacted with this emoji yet, so add it
      reactionArray.push(username);
      updatedReactions = { ...post.metadata.reactions };
      updatedReactions[reactionType] = [...reactionArray];
    } else {
      // User has already reacted, so remove it
      reactionArray.splice(userIndex, 1);
      updatedReactions = { ...post.metadata.reactions };
      if (reactionArray.length === 0) {
        // Remove the reaction type if array is empty
        delete updatedReactions[reactionType];
      } else {
        updatedReactions[reactionType] = [...reactionArray];
      }
    }

    // Use findOneAndUpdate with positional operator to update only the specific post
    // This avoids validating all posts in the array
    const updatedForum = await Forum.findOneAndUpdate(
      {
        forumId,
        "posts._id": postId,
      },
      {
        $set: {
          "posts.$.metadata.reactions": updatedReactions,
        },
      },
      {
        new: true, // Return the updated document
        runValidators: false, // Skip validation to avoid issues with other posts
      }
    );

    if (!updatedForum) {
      return res.status(404).json({ error: "Forum or post not found after update" });
    }

    // Get the updated post for the response
    const updatedPost = updatedForum.posts.id(postId);

    return res.status(200).json({
      forum: updatedForum,
      post: updatedPost,
      reactions: updatedPost?.metadata?.reactions || {},
    });
  } catch (error) {
    console.error("Error reacting to post:", error);
    return res.status(500).json({ error: "Failed to react to post" });
  }
}

export default withDatabase(handler);
