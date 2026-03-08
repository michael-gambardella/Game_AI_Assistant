   # Project Structure & Cleanup Analysis

This document summarizes the repository structure and identifies candidates for cleanup **without removing essential testing**. No deletions have been made yet.

---

## 1. Current Top-Level Structure

| Item | Type | Notes |
|------|------|--------|
| `app/` | Dir | Next.js App Router pages (21 files) |
| `components/` | Dir | React components |
| `config/` | Dir | Bot and moderation config |
| `context/` | Dir | React context |
| `data/` | Dir | JSON/CSV data (gamers, automated-users, vg_data) |
| `hooks/` | Dir | React hooks |
| `middleware.ts` + `middleware/` | File + Dir | Next middleware and auth/rate-limit helpers |
| `models/` | Dir | Mongoose models |
| `pages/api/` | Dir | Next.js API routes (~120+ endpoints) |
| `public/` | Dir | Static assets |
| `scripts/` | Dir | 9 scripts (mix of utilities and tests) |
| `tests/` | Dir | 10 files (test scripts + 3 MD checklists) |
| `utils/` | Dir | Shared utilities |
| `README.md` | File | Project readme (keep) |
| `game-wingman.json` | File | Eliza-style bot config (external platform?) |
| `redirectTest.js` | File | One-off: encodes Twitch redirect URI (dev snippet) |
| `test-user-context-api.js` | File | Standalone script to hit `/api/user-context` (dev helper) |
| `performance-metrics.log` | File | Log file (often gitignored) |
| `server.ts` | File | Custom server (used by `dev:full`) |
| Config files | - | `package.json`, `tsconfig.json`, `next.config.mjs`, etc. |

---

## 2. Tests Folder (`tests/`)

### Test scripts (run manually or via npm)

| File | In package.json? | Purpose | Recommendation |
|------|------------------|---------|----------------|
| `testDatabaseConnections.ts` | ✅ `test:db` | DB connectivity | **KEEP** – essential |
| `testWebhookFix.ts` | ✅ `test:webhook` | Webhook behavior | **KEEP** – essential |
| `testAccountDashboard.js` | ❌ | Account dashboard | **KEEP** – useful manual test |
| `testConversationCount.js` | ❌ | Conversation count | **KEEP** – useful manual test |
| `testNavigation.js` | ❌ | Navigation | **KEEP** – useful manual test |
| `testSubscriptionSystem.js` | ❌ | Subscription flows | **KEEP** – essential for payments |
| `testUsernameContentModeration.js` | ❌ | Username moderation | **KEEP** – useful manual test |
| `test-user-context-api.js` | ❌ | User-context API test | **KEEP** – moved from root |

Testing checklists (`.md` files) that were in `tests/` have been **moved** to `docs/testing/` (see Section 8).

### Missing test files (package.json scripts – FIXED)

Previously, these scripts referenced missing files. They have been updated:

- **`test`** – Now runs `npm run test:db` (database connection test).
- **`test:sync`** – Removed (referenced missing `tests/testUserSync.ts`).
- **`test:all`** – Now runs only `test:db` (no longer runs removed `test:sync`).
- **`test:achievement-cache`** and **`test:achievement-cache:quick`** – Removed (referenced missing files).

### Markdown in `tests/`

| File | Purpose | Recommendation |
|------|---------|----------------|
| `MANUAL_TESTS.md` | Manual QA checklist (splash, sync, Pro) | **KEEP** – consolidate here or in `/docs` |
| `QUICK_VERIFICATION_CHECKLIST.md` | Quick verification steps | **KEEP** – consider merging into one “Testing” doc |
| `SUBSCRIPTION_SYSTEM_TESTS.md` | Subscription test plan | **KEEP** – essential for payment/subscription work |

---

## 3. Scripts Folder (`scripts/`)

| Script | Purpose | Recommendation |
|--------|---------|----------------|
| `clean-next-build.js` | Cleans `.next` (used by `npm run clean`) | **KEEP** – used |
| `dedupe-automated-forums.ts` | Data repair | **KEEP** – operational |
| `generate-game-catalog.ts` | Generate catalog | **KEEP** – operational |
| `generate-legacy-game-lists.ts` | Legacy list generation | **KEEP** – operational |
| `repair-automated-forum-posts.ts` | Repair forum posts | **KEEP** – operational |
| `sendBotInfoToChannel.ts` | Discord bot info to channel | **KEEP** – operational |
| `verify-pro-deadline.ts` | Pro deadline verification | **KEEP** – operational |
| `test-security-headers.js` | Security headers check | **KEEP** – useful test script |
| `test-token-blacklist.js` | Token blacklist check | **KEEP** – useful test script |

All current scripts are either used by npm or are one-off operational/test helpers. No removal suggested.

---

## 4. API Routes – Test / Dev-Only Endpoints

These endpoints look like ad-hoc tests or dev tools (not called by the main app). Safe to remove or move behind a “dev-only” guard if you want a cleaner API surface.

### Root-level API “test” routes

| Route | File | Purpose |
|-------|------|--------|
| `/api/test` | `pages/api/test.ts` | Returns `{ message: 'API is working' }` – generic health check |
| `/api/test-db-structure` | `pages/api/test-db-structure.ts` | DB structure check |
| `/api/test-frequency-helpers` | `pages/api/test-frequency-helpers.ts` | Frequency helpers test |
| `/api/test-genre-helpers` | `pages/api/test-genre-helpers.ts` | Genre helpers test |
| `/api/test-performance-safeguards` | `pages/api/test-performance-safeguards.ts` | Performance safeguards test |
| `/api/testTwitchBot` | `pages/api/testTwitchBot.ts` | Twitch bot test |

### Under `pages/api/twitchBot/`

| Route | File |
|-------|------|
| `test-analytics.ts` | Analytics test |
| `test-analytics-auth.ts` | Analytics auth test |
| `test-aggregation.ts` | Aggregation test |
| `test-performance-monitor.ts` | Performance monitor test |

### Under `pages/api/automated-users/`

| Route | File |
|-------|------|
| `testAutomation.ts` | Automation test |
| `test-content-generation.ts` | Content generation test |
| `test-gamer-matching.ts` | Gamer matching test |
| `test-image-search.ts` | Image search test |
| `test-integration.ts` | Integration test |
| `test-service-layer.ts` | Service layer test |

**Done:** These test-only API routes have been removed (see Optional cleanup step 1).

---

## 5. App Page – Test / Dev-Only

| Path | File | Purpose |
|------|------|--------|
| `/test-early-access` | `app/test-early-access/page.tsx` | Form to simulate early access redirect with `userId`/`email` |

Not linked from the rest of the app. **Recommendation:** Keep if you use it for QA; remove or move behind a feature flag if you want a cleaner app tree.

---

## 6. Root-Level Loose Files

| File | Purpose | Recommendation |
|------|---------|----------------|
| ~~`redirectTest.js`~~ | ~~Encodes one Twitch callback URL~~ | **Removed** – one-off dev snippet |
| ~~`test-user-context-api.js`~~ | ~~Calls `/api/user-context`~~ | **Moved** to `tests/test-user-context-api.js` |
| ~~`game-wingman.json`~~ | ~~ElizaOS-style bot config (unused)~~ | **Removed** – never implemented |
| `performance-metrics.log` | Runtime log | Ensure it’s in `.gitignore`; do not commit if it’s generated |

---

## 7. Markdown Files Outside `tests/`

| File | Purpose | Recommendation |
|------|---------|----------------|
| `README.md` | Project readme | **KEEP** |
| ~~`DISCORD_BOT_TESTING_CHECKLIST.md`~~ | ~~Discord bot QA checklist~~ | **Moved** to `docs/testing/DISCORD_BOT_TESTING_CHECKLIST.md` |

---

## 8. Optional: Consolidating Documentation

To reduce “several md files” without losing content:

- `docs/testing/DISCORD_BOT_TESTING_CHECKLIST.md` (from root)
- `docs/testing/MANUAL_TESTS.md`, `QUICK_VERIFICATION_CHECKLIST.md`, `SUBSCRIPTION_SYSTEM_TESTS.md` (from `tests/`)
- `docs/testing/README.md` – index of the testing docs

---

## 9. Summary of Recommendations

### Do not remove (essential testing / used scripts)

- All files in **`tests/`** that exist (test scripts only; MD checklists are in `docs/testing/`).
- **`scripts/`** – all current scripts are either used by npm or are operational/test helpers.

### Fix or trim (no file deletions required)

- **package.json:** ✅ Fixed. `test` now runs `test:db`; removed `test:sync`, `test:achievement-cache`, and `test:achievement-cache:quick`; `test:all` runs only `test:db`.

### Optional cleanup (after you confirm)

1. **API test routes** – ✅ Done. Removed all 16 test-only routes (root, twitchBot/, automated-users/).
2. **Root snippets** – ✅ Done. Removed `redirectTest.js`; moved `test-user-context-api.js` to `tests/test-user-context-api.js`.
3. **App** – Remove or hide `app/test-early-access/page.tsx` if you don’t use it.
4. **Docs** – ✅ Done. Created `docs/testing/` and moved all 4 testing checklists there; added `docs/testing/README.md` index.
5. **Config** – Done. Removed `game-wingman.json` if it’s unused.

### Optional structure improvement

- Group dev-only API routes under something like `pages/api/_dev/` (Next.js allows this) so they’re clearly separated from production endpoints.

---

## 10. Next Steps

1. Decide which optional cleanups (Sections 4–8) you want.
2. Fix `package.json` test scripts (Section 2) so `npm run test` (and related) either work or are removed.
3. Apply one change at a time (e.g. remove one test API route, run app and tests, then continue).

If you tell me which of these you want (e.g. “remove all API test routes and root snippets, fix package.json, and add docs/”), I can outline exact file-by-file steps or patches next.
