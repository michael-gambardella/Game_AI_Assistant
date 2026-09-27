import mongoose from 'mongoose';
import User from '../models/User';
import Question from '../models/Question';
import Feedback from '../models/Feedback';
import UserViolation from '../models/UserViolation';
import Forum from '../models/Forum';
import TwitchBotChannel from '../models/TwitchBotChannel';
import Session from '../models/Session';
import TokenBlacklist from '../models/TokenBlacklist';
import { VALID_REACTIONS } from './forumReactions';

/**
 * Username renames.
 *
 * Much of a user's data is keyed by username rather than userId (chat history, feedback,
 * moderation record, forums and posts, Twitch bot channels). A rename has to carry all of
 * it along, or the user loses their history - and whoever later takes the freed name
 * inherits it. Keep this list in sync when adding username-keyed data.
 */

// Forum post fields holding a single username
const POST_USERNAME_FIELDS = ['username', 'createdBy', 'metadata.editedBy'];

// Forum post fields holding arrays of usernames
const POST_USERNAME_ARRAYS = [
  'metadata.likedBy',
  ...VALID_REACTIONS.map(emoji => `metadata.reactions.${emoji}`),
];

/**
 * True if data under this username still exists without an owning account - typically left
 * behind by renames made before history was carried along. Such names must not be handed
 * to someone else, or they'd inherit a stranger's conversations, posts and moderation record.
 */
export async function hasOrphanedUsernameData(username: string): Promise<boolean> {
  const results = await Promise.all([
    Question.exists({ username }),
    Feedback.exists({ username }),
    UserViolation.exists({ username }),
    TwitchBotChannel.exists({ streamerUsername: username }),
    Forum.exists({
      $or: [
        { createdBy: username },
        { allowedUsers: username },
        { 'posts.username': username },
        { 'posts.createdBy': username },
      ],
    }),
  ]);
  return results.some(Boolean);
}

/**
 * Renames a user and moves everything keyed by their username, in one transaction: either
 * the whole rename happens or none of it does.
 *
 * Returns false (and changes nothing) if the user's current username is no longer
 * `oldUsername`, e.g. a concurrent rename. A unique-index violation on the new name
 * (someone took it meanwhile) is thrown as a MongoDB 11000 error.
 */
export async function renameUsernameEverywhere(
  userId: string,
  oldUsername: string,
  newUsername: string
): Promise<boolean> {
  const session = await mongoose.startSession();
  try {
    let renamed = false;

    await session.withTransaction(async () => {
      renamed = false; // withTransaction may retry this callback on transient errors
      const opts = { session };
      const renameTo = { $set: { username: newUsername } };

      const userResult = await User.updateOne(
        { userId, username: oldUsername },
        renameTo,
        opts
      );
      if (userResult.matchedCount !== 1) {
        return;
      }

      await Question.updateMany({ username: oldUsername }, renameTo, opts);
      await Feedback.updateMany({ username: oldUsername }, renameTo, opts);
      await UserViolation.updateMany({ username: oldUsername }, renameTo, opts);
      await Session.updateMany({ userId }, renameTo, opts);
      await TokenBlacklist.updateMany({ userId }, renameTo, opts);
      await TwitchBotChannel.updateMany(
        { streamerUsername: oldUsername },
        { $set: { streamerUsername: newUsername } },
        opts
      );

      // Forums: owner, private-forum access list, view tracking
      await Forum.updateMany(
        { createdBy: oldUsername },
        { $set: { createdBy: newUsername } },
        opts
      );
      await Forum.updateMany(
        { allowedUsers: oldUsername },
        { $set: { 'allowedUsers.$[u]': newUsername } },
        { ...opts, arrayFilters: [{ u: oldUsername }] }
      );
      await Forum.updateMany(
        { 'metadata.viewedBy': oldUsername },
        { $set: { 'metadata.viewedBy.$[u]': newUsername } },
        { ...opts, arrayFilters: [{ u: oldUsername }] }
      );

      // Posts: authorship/edit fields...
      for (const field of POST_USERNAME_FIELDS) {
        await Forum.updateMany(
          { [`posts.${field}`]: oldUsername },
          { $set: { [`posts.$[p].${field}`]: newUsername } },
          { ...opts, arrayFilters: [{ [`p.${field}`]: oldUsername }] }
        );
      }

      // ...and likes/reactions on anyone's posts. Only posts that contain the name are
      // targeted ($[p]), since array updates fail on posts where the array doesn't exist.
      for (const field of POST_USERNAME_ARRAYS) {
        await Forum.updateMany(
          { [`posts.${field}`]: oldUsername },
          { $set: { [`posts.$[p].${field}.$[u]`]: newUsername } },
          { ...opts, arrayFilters: [{ [`p.${field}`]: oldUsername }, { u: oldUsername }] }
        );
      }

      renamed = true;
    });

    return renamed;
  } finally {
    await session.endSession();
  }
}
