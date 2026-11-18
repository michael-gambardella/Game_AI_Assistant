/**
 * Usernames that carry special privileges and so must never be registered or renamed to
 * by anyone else - in any capitalization or spacing.
 *
 * Signup/rename only reject *exact* duplicates (MongoDB's unique index is case-sensitive),
 * so without this list someone could register e.g. "legendaryrenegade" next to the real
 * "LegendaryRenegade". Keep in sync with name-based privileges (adminAccess.ts,
 * proAccessUtil.ts checkProAccess).
 */

// Automated forum accounts (always Pro; created by /api/automated-users/create)
export const AUTOMATED_USERNAMES = ['MysteriousMrEnter', 'WaywardJammer', 'InterdimensionalHipster'];

// Test accounts that get Pro outside production (proAccessUtil.ts)
export const TEST_USERNAMES = ['test-user', 'TestUser1'];

const canonical = (name: string) => name.replace(/\s+/g, '').toLowerCase();

const reservedNames = (): string[] => [
  process.env.ADMIN_USERNAME || 'LegendaryRenegade',
  'LegendaryRenegade',
  ...AUTOMATED_USERNAMES,
  ...TEST_USERNAMES,
];

/** True if `name` matches a reserved username, ignoring case and whitespace. */
export function isReservedUsername(name: string): boolean {
  const wanted = canonical(name);
  return reservedNames().some(reserved => canonical(reserved) === wanted);
}
