/**
 * Remove junk UserViolation records created by the Discord/Twitch bots.
 *
 * Until the bots switched to findOffensiveWords (a pure check), their moderation called
 * containsOffensiveContent with throwaway IDs, which recorded a website violation under
 * that ID for every offensive message and every flagged AI reply. Nothing ever read those
 * records - the bots track violations in DiscordUserViolation / TwitchUserViolation.
 *
 * A record is treated as junk only if BOTH:
 *   1. its username exactly matches one of the throwaway formats the bots generated:
 *        discord_check_<timestamp>_<Math.random()>   twitch_check_<timestamp>_<Math.random()>
 *        discord_<Discord user ID>_<timestamp>       twitch_<Twitch name>_<timestamp>
 *        ai_response_<id>_<timestamp>
 *   2. no user account has that username (so a real person's record is never touched).
 *
 * Usage:
 *   npx tsx scripts/cleanup-bot-violation-records.ts            (dry run: read-only report)
 *   npx tsx scripts/cleanup-bot-violation-records.ts --apply    (delete the records reported)
 */
import mongoose from 'mongoose';
import { connectToWingmanDB } from '../utils/databaseConnections';
import User from '../models/User';
import UserViolation from '../models/UserViolation';

const TIMESTAMP = String.raw`\d{13}`;            // Date.now() in ms
const RANDOM = String.raw`0\.\d+(?:e-\d+)?`;    // Math.random()

const JUNK_FORMATS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'discord_check_<timestamp>_<random>', pattern: new RegExp(`^discord_check_${TIMESTAMP}_${RANDOM}$`) },
  { label: 'twitch_check_<timestamp>_<random>', pattern: new RegExp(`^twitch_check_${TIMESTAMP}_${RANDOM}$`) },
  { label: 'discord_<Discord ID>_<timestamp>', pattern: new RegExp(`^discord_\\d{15,21}_${TIMESTAMP}$`) },
  { label: 'twitch_<Twitch name>_<timestamp>', pattern: new RegExp(`^twitch_[A-Za-z0-9_]{1,25}_${TIMESTAMP}$`) },
  { label: 'ai_response_<id>_<timestamp>', pattern: new RegExp(`^ai_response_[A-Za-z0-9_]{1,40}_${TIMESTAMP}$`) },
];

async function main() {
  const apply = process.argv.includes('--apply');
  await connectToWingmanDB();

  const totalRecords = await UserViolation.countDocuments({});

  // Cheap prefix pre-filter in the database, exact format checks below
  const candidates = await UserViolation.find(
    { username: { $regex: '^(discord_|twitch_|ai_response_)' } },
    { username: 1, warningCount: 1, banCount: 1, createdAt: 1, violations: { $slice: 1 } }
  ).lean() as any[];

  const matched = candidates
    .map(doc => ({ doc, format: JUNK_FORMATS.find(f => f.pattern.test(doc.username)) }))
    .filter(m => m.format);

  // Never touch a record whose username belongs to a real account
  const owned = new Set(
    (await User.find({ username: { $in: matched.map(m => m.doc.username) } }, { username: 1 }).lean() as any[])
      .map(u => u.username)
  );
  const junk = matched.filter(m => !owned.has(m.doc.username));
  const skippedOwned = matched.filter(m => owned.has(m.doc.username));
  const unmatchedPrefix = candidates.filter(c => !matched.some(m => m.doc === c));

  console.log(`\nUserViolation records in total: ${totalRecords}`);
  console.log(`Records with a bot-style prefix: ${candidates.length}`);
  console.log(`Junk records (exact bot format, no matching account): ${junk.length}\n`);

  for (const format of JUNK_FORMATS) {
    const inFormat = junk.filter(m => m.format === format);
    if (!inFormat.length) continue;
    // The creation timestamp is the 13-digit group right before the end (or before the
    // trailing Math.random() part) - not the first 13 digits, which may be a Discord ID
    const times = inFormat
      .map(m => Number(m.doc.username.match(/_(\d{13})(?:_[0-9.e-]+)?$/)?.[1]))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const range = times.length
      ? `${new Date(times[0]).toISOString().slice(0, 10)} .. ${new Date(times[times.length - 1]).toISOString().slice(0, 10)}`
      : 'n/a';
    console.log(`  ${format.label.padEnd(38)} ${String(inFormat.length).padStart(6)}   (${range})`);
    for (const m of inFormat.slice(0, 3)) console.log(`      e.g. ${m.doc.username}`);
  }

  if (skippedOwned.length) {
    console.log(`\nSkipped (a real account has this exact name): ${skippedOwned.length}`);
    for (const m of skippedOwned.slice(0, 10)) console.log(`      ${m.doc.username}`);
  }
  if (unmatchedPrefix.length) {
    console.log(`\nLeft alone (bot-like prefix but not an exact bot format): ${unmatchedPrefix.length}`);
    for (const c of unmatchedPrefix.slice(0, 10)) console.log(`      ${c.username}`);
  }

  if (!apply) {
    console.log('\nDry run - nothing was changed. Re-run with --apply to delete the junk records listed above.');
  } else if (junk.length) {
    const result = await UserViolation.deleteMany({ _id: { $in: junk.map(m => m.doc._id) } });
    console.log(`\nDeleted ${result.deletedCount} junk record(s).`);
  } else {
    console.log('\nNothing to delete.');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Cleanup failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
