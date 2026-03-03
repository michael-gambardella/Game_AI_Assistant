// Test file for username content moderation
// This can be run manually to test the content moderation functionality
// Uses the same word-boundary regex as production (contentModeration.ts)

// Import the OFFENSIVE_WORDS list from contentModeration.ts by reading the file
// Since this is a plain JS test, we hardcode a representative subset for testing.
// The full list lives in utils/contentModeration.ts as the single source of truth.
const OFFENSIVE_WORDS_SAMPLE = [
  'ass',
  'asshole',
  'shit',
  'fuck',
  'Robert Durst',
  'Ted Bundy',
  'Nick Begich III',
  'Richard Hudson Jr.',
  'Robert F. Kennedy Jr.',
  'Jimmy Patronis Jr.',
  'Rob Bresnahan Jr.',
  'Donald Trump Jr.',
  'Christopher S. Ripley',
  'Winsome Earle-Sears',
  'J.D. Vance',
  'J. K. Rowling',
  'Dr. Oz',
  'Trump',
  'cum',
  'KKK',
  'Putin',
];

/**
 * Check if content matches any offensive word using the same regex
 * as production (contentModeration.ts).
 *
 * Uses (?<!\w) and (?!\w) instead of \b so entries ending with
 * non-word characters (e.g. "Jr.") are still caught correctly.
 */
function checkContent(content) {
  const foundWords = OFFENSIVE_WORDS_SAMPLE.filter(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, 'i');
    return regex.test(content);
  });

  return {
    content,
    isOffensive: foundWords.length > 0,
    offendingWords: foundWords
  };
}

// ─── Test harness ───────────────────────────────────────────────

let passedTests = 0;
let failedTests = 0;

function expectBlocked(input, reason) {
  const result = checkContent(input);
  if (result.isOffensive) {
    console.log(`  PASS (blocked): "${input}" -- ${reason}`);
    passedTests++;
  } else {
    console.log(`  FAIL (should be blocked): "${input}" -- ${reason}`);
    failedTests++;
  }
}

function expectAllowed(input, reason) {
  const result = checkContent(input);
  if (!result.isOffensive) {
    console.log(`  PASS (allowed): "${input}" -- ${reason}`);
    passedTests++;
  } else {
    console.log(`  FAIL (should be allowed but blocked by: ${result.offendingWords.join(', ')}): "${input}" -- ${reason}`);
    failedTests++;
  }
}

// ─── Tests ──────────────────────────────────────────────────────

console.log("Username Content Moderation Test");
console.log("=================================");
console.log("");

// 1. Basic offensive words still blocked
console.log("1. Basic offensive words (should be BLOCKED):");
expectBlocked('fuck', 'exact match');
expectBlocked('FUCK', 'case-insensitive');
expectBlocked('shit', 'exact match');
expectBlocked('asshole', 'exact match');
expectBlocked('KKK', 'abbreviation');
console.log("");

// 2. Substring safety — no false positives
console.log("2. Substring safety (should be ALLOWED):");
expectAllowed('grass', '"ass" is inside but not a whole word');
expectAllowed('class', '"ass" is inside but not a whole word');
expectAllowed('classic', '"ass" is inside but not a whole word');
expectAllowed('document', 'no offensive substring');
expectAllowed('assume', '"ass" is a prefix but not standalone');
expectAllowed('cumbersome', '"cum" is a prefix but not standalone');
expectAllowed('accumulated', '"cum" is inside but not standalone');
console.log("");

// 3. Full-name matching — only full names blocked
console.log("3. Full-name matching (should be BLOCKED):");
expectBlocked('Robert Durst', 'exact full name');
expectBlocked('robert durst', 'case-insensitive full name');
expectBlocked('Nick Begich III', 'full name with numeral');
expectBlocked('Christopher S. Ripley', 'full name with middle initial');
expectBlocked('Winsome Earle-Sears', 'full name with hyphen');
expectBlocked('J.D. Vance', 'full name with periods');
expectBlocked('J. K. Rowling', 'full name with spaced initials');
expectBlocked('Dr. Oz', 'name with title prefix');
console.log("");

// 4. First names only — should NOT match full-name entries
console.log("4. First names only (should be ALLOWED):");
expectAllowed('Robert', 'first name only, not "Robert Durst"');
expectAllowed('Nick', 'first name only, not "Nick Begich III"');
expectAllowed('Christopher', 'first name only, not "Christopher S. Ripley"');
expectAllowed('Winsome', 'first name only, not "Winsome Earle-Sears"');
expectAllowed('Ted', 'first name only, not "Ted Bundy"');
expectAllowed('Jimmy', 'first name only, not "Jimmy Patronis Jr."');
expectAllowed('Richard', 'first name only, not "Richard Hudson Jr."');
expectAllowed('Rob', 'first name only, not "Rob Bresnahan Jr."');
console.log("");

// 5. Last names only — should NOT match full-name entries
console.log("5. Last names only (should be ALLOWED):");
expectAllowed('Durst', 'last name only');
expectAllowed('Begich', 'last name only');
expectAllowed('Ripley', 'last name only');
expectAllowed('Bundy', 'last name only');
expectAllowed('Vance', 'last name only');
expectAllowed('Rowling', 'last name only');
expectAllowed('Oz', 'last name only');
console.log("");

// 6. Roman numerals / suffixes NOT causing false positives
console.log("6. Names with numerals / suffixes (should be ALLOWED):");
expectAllowed('Stanley Sherman IV', 'different person with Roman numeral');
expectAllowed('Victory III', 'non-name use of Roman numeral');
expectAllowed('Henry VIII', 'historical numeral');
expectAllowed('King James III', 'different name with same numeral');
expectAllowed('III', 'bare numeral alone');
expectAllowed('IV', 'bare numeral alone');
console.log("");

// 7. Jr. / Sr. NOT causing false positives
console.log("7. Jr. / Sr. suffixes (should be ALLOWED):");
expectAllowed('Sr. Knight', '"Sr." not part of any listed name');
expectAllowed('Jr. Smith', '"Jr." not part of any listed name');
expectAllowed('Martin Luther King Jr.', 'different person with Jr.');
expectAllowed('Hudson', 'last name only, not "Richard Hudson Jr."');
expectAllowed('Patronis', 'last name only, not "Jimmy Patronis Jr."');
expectAllowed('Bresnahan', 'last name only, not "Rob Bresnahan Jr."');
console.log("");

// 8. Names ending with "Jr." ARE correctly blocked
console.log("8. Names ending with Jr. (should be BLOCKED):");
expectBlocked('Robert F. Kennedy Jr.', 'full name with Jr. period');
expectBlocked('Richard Hudson Jr.', 'full name with Jr. period');
expectBlocked('Jimmy Patronis Jr.', 'full name with Jr. period');
expectBlocked('Rob Bresnahan Jr.', 'full name with Jr. period');
expectBlocked('Donald Trump Jr.', 'full name with Jr. period');
console.log("");

// 9. Hyphenated names
console.log("9. Hyphenated names:");
expectBlocked('Winsome Earle-Sears', 'full hyphenated name blocked');
expectAllowed('Earle-Sears', 'partial hyphenated name allowed');
expectAllowed('Earle', 'single part of hyphenated name allowed');
expectAllowed('Sears', 'single part of hyphenated name allowed');
console.log("");

// 10. Middle initial / period names
console.log("10. Names with middle initials / periods:");
expectBlocked('Christopher S. Ripley', 'full name with middle initial');
expectAllowed('Christopher Ripley', 'missing middle initial, different match');
expectAllowed('S. Ripley', 'partial name allowed');
console.log("");

// 11. Valid usernames
console.log("11. Valid usernames (should be ALLOWED):");
expectAllowed('validUser123', 'normal username');
expectAllowed('test_user', 'underscore username');
expectAllowed('user-name', 'hyphenated username');
expectAllowed('gamer123', 'alphanumeric username');
expectAllowed('player_2024', 'year in username');
expectAllowed('xXDarkKnightXx', 'gaming-style username');
expectAllowed('JohnSmith42', 'real-name-style username');
console.log("");

// ─── Results ────────────────────────────────────────────────────

console.log("Test Results:");
console.log(`  Passed: ${passedTests}`);
console.log(`  Failed: ${failedTests}`);
console.log(`  Total:  ${passedTests + failedTests}`);

if (failedTests === 0) {
  console.log("\nAll tests passed! Content moderation is working correctly.");
} else {
  console.log("\nSome tests failed. Please review the content moderation implementation.");
} 