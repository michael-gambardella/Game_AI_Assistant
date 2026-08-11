// Splash page early access signup deadline and free Pro access window.
// Values are UTC equivalents of Eastern Time deadlines (EST = UTC-5 in December).
// Dec 31, 2026 11:59:59.999 PM EST
export const PRO_DEADLINE = new Date('2027-01-01T04:59:59.999Z');

// Same as PRO_DEADLINE: the free-access window starts when the signup deadline closes
export const EARLY_ACCESS_START_DATE = PRO_DEADLINE;

// Dec 31, 2027 11:59:59.999 PM EST (1 year after PRO_DEADLINE)
export const EARLY_ACCESS_END_DATE = new Date('2028-01-01T04:59:59.999Z');
