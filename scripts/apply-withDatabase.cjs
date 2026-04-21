/**
 * One-time migration: wraps all API route handlers with withDatabase() or
 * withWingmanDB() HOC from utils/withDatabase.ts, eliminating per-route
 * connectToMongoDB() / connectToWingmanDB() boilerplate.
 *
 * Run from repo root: node scripts/apply-withDatabase.cjs
 * Safe to delete after running and verifying.
 */

'use strict';
const fs = require('fs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function importPath(filePath) {
  // e.g. "pages/api/auth/signin.ts" → depth 2 → "../../utils/withDatabase"
  const depth = filePath.replace(/\\/g, '/').split('/').length - 1;
  return '../'.repeat(depth) + 'utils/withDatabase';
}

/** Read file, normalise CRLF → LF, return content + original CRLF flag. */
function readNorm(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const crlf = raw.includes('\r\n');
  return { c: raw.replace(/\r\n/g, '\n'), crlf };
}

/** Write file, restoring original line endings. */
function write(filePath, content, crlf) {
  fs.writeFileSync(filePath, crlf ? content.replace(/\n/g, '\r\n') : content);
}

// ─── Transform variants ───────────────────────────────────────────────────────

/**
 * Standard: import connectToMongoDB + await connectToMongoDB() in handler body.
 */
function applyWithDatabase(filePath) {
  let { c, crlf } = readNorm(filePath);
  const imp = importPath(filePath);

  c = c.replace(
    /^import connectToMongoDB from ['"][^'"]+['"];\n/m,
    `import { withDatabase } from '${imp}';\n`
  );
  c = c.replace(/^[ \t]*await connectToMongoDB\(\);\n/mg, '');
  c = c.replace('export default async function handler(', 'async function handler(');
  c = c.trimEnd() + '\n\nexport default withDatabase(handler);\n';

  write(filePath, c, crlf);
}

/**
 * Standard: import { connectToWingmanDB } + await connectToWingmanDB().
 */
function applyWithWingmanDB(filePath) {
  let { c, crlf } = readNorm(filePath);
  const imp = importPath(filePath);

  c = c.replace(
    /^import \{ connectToWingmanDB \} from ['"][^'"]+['"];\n/m,
    `import { withWingmanDB } from '${imp}';\n`
  );
  c = c.replace(/^[ \t]*await connectToWingmanDB\(\);\n/mg, '');
  c = c.replace('export default async function handler(', 'async function handler(');
  c = c.trimEnd() + '\n\nexport default withWingmanDB(handler);\n';

  write(filePath, c, crlf);
}

/**
 * ReadyState guard variant for connectToWingmanDB:
 *   if (mongoose.connection.readyState !== 1) { await connectToWingmanDB(); }
 *
 * keepSplashDB=true: file also imports connectToSplashDB — keep that import,
 * only remove connectToWingmanDB from it.
 */
function applyWithWingmanDBReadyState(filePath, keepSplashDB = false) {
  let { c, crlf } = readNorm(filePath);
  const imp = importPath(filePath);

  c = c.replace(/^import mongoose from ['"][^'"]+['"];\n/m, '');

  if (keepSplashDB) {
    c = c.replace(
      /import \{ connectToWingmanDB, connectToSplashDB \}/,
      'import { connectToSplashDB }'
    );
    c = c.replace(
      /import \{ connectToSplashDB, connectToWingmanDB \}/,
      'import { connectToSplashDB }'
    );
    // Insert withWingmanDB import after the 'next' type import
    c = c.replace(
      /^(import type \{ NextApiRequest, NextApiResponse \} from 'next';\n)/m,
      `$1import { withWingmanDB } from '${imp}';\n`
    );
    if (!c.includes('withWingmanDB')) {
      c = c.replace(
        /^(import \{ connectToSplashDB \}[^\n]+\n)/m,
        `$1import { withWingmanDB } from '${imp}';\n`
      );
    }
  } else {
    c = c.replace(
      /^import \{ connectToWingmanDB \} from ['"][^'"]+['"];\n/m,
      `import { withWingmanDB } from '${imp}';\n`
    );
  }

  c = c.replace(
    /[ \t]*if \(mongoose\.connection\.readyState !== 1\) \{\n[ \t]*await connectToWingmanDB\(\);\n[ \t]*\}\n/g,
    ''
  );
  c = c.replace('export default async function handler(', 'async function handler(');
  c = c.trimEnd() + '\n\nexport default withWingmanDB(handler);\n';

  write(filePath, c, crlf);
}

/**
 * ReadyState guard variant for connectToMongoDB:
 *   if (mongoose.connection.readyState !== 1) { await connectToMongoDB(); }
 * Used by: game-resume.ts, user-context.ts
 */
function applyWithDatabaseReadyState(filePath) {
  let { c, crlf } = readNorm(filePath);
  const imp = importPath(filePath);

  c = c.replace(/^import mongoose from ['"][^'"]+['"];\n/m, '');
  c = c.replace(
    /^import connectToMongoDB from ['"][^'"]+['"];\n/m,
    `import { withDatabase } from '${imp}';\n`
  );
  c = c.replace(
    /[ \t]*if \(mongoose\.connection\.readyState !== 1\) \{\n[ \t]*await connectToMongoDB\(\);\n[ \t]*\}\n/g,
    ''
  );
  // Belt-and-suspenders: remove any remaining standalone calls
  c = c.replace(/^[ \t]*await connectToMongoDB\(\);\n/mg, '');
  c = c.replace('export default async function handler(', 'async function handler(');
  c = c.trimEnd() + '\n\nexport default withDatabase(handler);\n';

  write(filePath, c, crlf);
}

/**
 * Composed variant for signin.ts / signup.ts:
 * Handler is already non-exported; export uses withRequestSizeLimit(handler).
 * Becomes: withRequestSizeLimit(withWingmanDB(handler))
 */
function applyWithWingmanDBComposed(filePath) {
  let { c, crlf } = readNorm(filePath);
  const imp = importPath(filePath);

  c = c.replace(/^import mongoose from ['"][^'"]+['"];\n/m, '');
  c = c.replace(
    /^import \{ connectToWingmanDB \} from ['"][^'"]+['"];\n/m,
    `import { withWingmanDB } from '${imp}';\n`
  );
  c = c.replace(
    /[ \t]*if \(mongoose\.connection\.readyState !== 1\) \{\n[ \t]*await connectToWingmanDB\(\);\n[ \t]*\}\n/g,
    ''
  );
  c = c.replace(
    'export default withRequestSizeLimit(handler);',
    'export default withRequestSizeLimit(withWingmanDB(handler));'
  );

  write(filePath, c, crlf);
}

// ─── File lists ───────────────────────────────────────────────────────────────

// Routes that call connectToMongoDB() directly (no readyState guard)
const withDatabaseFiles = [
  'pages/api/addPostToForum.ts',
  'pages/api/addUserToPrivateForum.ts',
  'pages/api/challenge-history.ts',
  'pages/api/challenge-progress.ts',
  'pages/api/checkNewAchievements.ts',
  'pages/api/createForum.ts',
  'pages/api/deleteForum.ts',
  'pages/api/deletePost.ts',
  'pages/api/dismiss-recommendations.ts',
  'pages/api/editPost.ts',
  'pages/api/email-preferences.ts',
  'pages/api/feedback/admin/all.ts',
  'pages/api/feedback/admin/stats.ts',
  'pages/api/feedback/my-feedback.ts',
  'pages/api/feedback/submit.ts',
  'pages/api/getAllForums.ts',
  'pages/api/getConversation.ts',
  'pages/api/getForumTopic.ts',
  'pages/api/health/checkStatus.ts',
  'pages/api/health/endBreak.ts',
  'pages/api/health/endSession.ts',
  'pages/api/health/getTimerState.ts',
  'pages/api/health/markHealthTipShown.ts',
  'pages/api/health/recordBreak.ts',
  'pages/api/health/saveTimerState.ts',
  'pages/api/health/snoozeReminder.ts',
  'pages/api/health/startSession.ts',
  'pages/api/health/updateSettings.ts',
  'pages/api/hotTopics.ts',
  'pages/api/leaderboard.ts',
  'pages/api/likePost.ts',
  'pages/api/linkSteamId.ts',
  'pages/api/reactToPost.ts',
  'pages/api/recommendations.ts',
  'pages/api/stats.ts',
  'pages/api/streak.ts',
  'pages/api/twitchBot/channels.ts',
  'pages/api/twitchBot/channelSettings.ts',
  'pages/api/twitchBot/moderation.ts',
  'pages/api/twitchBotCallback.ts',
  'pages/api/twitchBotLogin.ts',
  'pages/api/twitchCallback.ts',
  'pages/api/twitchViewerCallback.ts',
  'pages/api/twitchViewerUnlink.ts',
  'pages/api/twitch/eventsub.ts',
  'pages/api/twitch/setup-eventsub.ts',
  'pages/api/updateForumsAllowedUsers.ts',
  'pages/api/updateForumStatus.ts',
  'pages/api/validateUsername.ts',
  'pages/api/verifyUser.ts',
  'pages/api/cron/weekly-digest.ts',
];

// Routes that call connectToWingmanDB() directly (no readyState guard)
const withWingmanDBFiles = [
  'pages/api/accountData.ts',
  'pages/api/automated-users/create-gamers.ts',
  'pages/api/automated-users/create.ts',
  'pages/api/automated-users/disable-weekly-digest.ts',
  'pages/api/avatar/recent.ts',
  'pages/api/avatar/set.ts',
  'pages/api/avatar/upload.ts',
  'pages/api/cancel-subscription.ts',
  'pages/api/checkEarlyAccessExpiration.ts',
  'pages/api/createCheckoutSession.ts',
  'pages/api/cron/aggregate-analytics.ts',
  'pages/api/debug-user-subscription.ts',
  'pages/api/deleteInteraction.ts',
  'pages/api/game-tracking.ts',
  'pages/api/game-tracking-get.ts',
  'pages/api/guides/get.ts',
  'pages/api/guides/save.ts',
  'pages/api/migrateUserUsageLimits.ts',
  'pages/api/migrateUserUsageLimitsAdvanced.ts',
  'pages/api/profile-share-data.ts',
  'pages/api/twitchBot/performance.ts',
  'pages/api/transitionEarlyAccess.ts',
  'pages/api/usageStatus.ts',
  'pages/api/webhook.ts',
];

// Routes with mongoose readyState guard around connectToWingmanDB()
const readyStateWingmanFiles = [
  'pages/api/admin/updateSubscriptionPricing.ts',
  'pages/api/auth/admin-unlock-account.ts',
  'pages/api/auth/exchange-token.ts',
  'pages/api/auth/forgot-password.ts',
  'pages/api/auth/refresh.ts',
  'pages/api/auth/reset-password.ts',
  'pages/api/auth/setup-early-access.ts',
  'pages/api/auth/setup-password.ts',
  'pages/api/auth/splash-login.ts',
  'pages/api/auth/unlock-account.ts',
  'pages/api/auth/verify.ts',
  'pages/api/auth/verify-reset-code.ts',
  'pages/api/findUserByUsername.ts',
  'pages/api/syncUser.ts',
];

// Routes with mongoose readyState guard around connectToMongoDB()
const readyStateDatabaseFiles = [
  'pages/api/game-resume.ts',
  'pages/api/user-context.ts',
];

// ─── Run ──────────────────────────────────────────────────────────────────────

let ok = 0, fail = 0;
const errors = [];

function run(label, files, fn) {
  for (const f of files) {
    try {
      fn(f);
      ok++;
      console.log(`✓ ${label}: ${f}`);
    } catch (e) {
      fail++;
      errors.push(`FAIL [${label}] ${f}: ${e.message}`);
    }
  }
}

run('withDatabase', withDatabaseFiles, applyWithDatabase);
run('withWingmanDB', withWingmanDBFiles, applyWithWingmanDB);
run('withWingmanDB (readyState)', readyStateWingmanFiles, applyWithWingmanDBReadyState);
run('withDatabase (readyState)', readyStateDatabaseFiles, applyWithDatabaseReadyState);

// Special cases
try {
  applyWithWingmanDBReadyState('pages/api/admin/fix-early-access-subscriptions.ts', true);
  ok++; console.log('✓ withWingmanDB (readyState+SplashDB): pages/api/admin/fix-early-access-subscriptions.ts');
} catch (e) { fail++; errors.push(`FAIL fix-early-access: ${e.message}`); }

try {
  applyWithWingmanDBComposed('pages/api/auth/signin.ts');
  ok++; console.log('✓ withWingmanDB (composed): pages/api/auth/signin.ts');
} catch (e) { fail++; errors.push(`FAIL signin: ${e.message}`); }

try {
  applyWithWingmanDBComposed('pages/api/auth/signup.ts');
  ok++; console.log('✓ withWingmanDB (composed): pages/api/auth/signup.ts');
} catch (e) { fail++; errors.push(`FAIL signup: ${e.message}`); }

console.log(`\nDone: ${ok} succeeded, ${fail} failed.`);
if (errors.length) console.error('\nErrors:\n' + errors.join('\n'));
