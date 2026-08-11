# Testing Guide

Comprehensive manual and checklist documentation for QA and verification across the Video Game Wingman system.

## Contents

- [Discord Bot Testing Checklist](#discord-bot-testing-checklist)
- [Subscription System Testing Plan](#subscription-system-testing-plan)

---

## Discord Bot Testing Checklist

### ✅ Role Setup Verification

#### Role Hierarchy (Already Fixed)

- [x] Administrator role is **above** Discord Bot role
- [x] Discord Bot role is **above** @everyone role

#### Bot Role Permissions Check

Go to **Server Settings → Roles → Discord Bot** and verify these permissions are **ENABLED**:

##### Essential Permissions (Required):

- [ ] **View Channels** - Bot needs to see channels
- [ ] **Send Messages** - Bot needs to respond
- [ ] **Read Message History** - Bot needs to read messages for moderation
- [ ] **Moderate Members** - Required for timeouts ⚠️ **CRITICAL**
- [ ] **Ban Members** - Required for permanent bans ⚠️ **CRITICAL**
- [ ] **Kick Members** - Optional but recommended

##### Recommended Permissions:

- [ ] **Use Slash Commands** - If you use slash commands
- [ ] **Embed Links** - For rich warning messages
- [ ] **Manage Messages** - To delete offensive messages (optional)

**Note:** If any of the essential permissions are missing, the bot will fail to moderate users.

---

### 🧪 Testing Checklist

#### Test 1: Basic Bot Functionality

- [ ] Bot responds to DMs
- [ ] Bot responds when mentioned in server channels
- [ ] Bot sends messages correctly
- [ ] Bot can read messages

#### Test 2: Content Moderation - First Violation (Warning)

**Setup:** Use a test account (not your admin account)

1. [ ] Send a message with offensive content (use a word from the offensive word list)
2. [ ] **Expected:** Bot sends warning message (via DM or channel reply)
3. [ ] **Expected:** Bot does NOT process the message with AI
4. [ ] **Expected:** Message is logged in database

#### Test 3: Content Moderation - Second Violation (Timeout)

**Setup:** Same test account, send another offensive message

1. [ ] Send second offensive message
2. [ ] **Expected:** Bot applies 5-minute timeout
3. [ ] **Expected:** User cannot send messages for 5 minutes
4. [ ] **Expected:** Action is logged in database

#### Test 4: Content Moderation - Progressive Escalation

**Setup:** Continue with same test account

1. [ ] Send third offensive message
2. [ ] **Expected:** Bot applies 30-minute timeout
3. [ ] Send fourth offensive message
4. [ ] **Expected:** Bot applies 1-hour timeout
5. [ ] Send fifth offensive message
6. [ ] **Expected:** Bot permanently bans user

#### Test 5: Ban Status Check

**Setup:** Use a banned test account

1. [ ] Banned user sends message
2. [ ] **Expected:** Bot silently rejects (no response)
3. [ ] **Expected:** Message is not processed

#### Test 6: AI Response Filtering

**Note:** This is harder to test, but verify:

1. [ ] Bot generates normal responses for clean messages
2. [ ] If AI generates inappropriate content, it's replaced with safe fallback

#### Test 7: Admin Protection

**Setup:** Use your Administrator account

1. [ ] Send offensive content as Administrator
2. [ ] **Expected:** Bot CANNOT timeout/ban you (role hierarchy protection)
3. [ ] **Expected:** Bot may still send warning (if it can read your message)

#### Test 8: DM Moderation

**Setup:** Use a test account

1. [ ] Send offensive content in DM to bot
2. [ ] **Expected:** Bot sends warning
3. [ ] **Expected:** Bot does NOT attempt timeout/ban (not possible in DMs)

---

### 🔍 How to Verify Permissions

#### Method 1: Check Role Settings

1. Go to **Server Settings → Roles**
2. Click on **Discord Bot** role
3. Scroll through permissions list
4. Verify all essential permissions are **ON** (green checkmark)

#### Method 2: Test Permissions Directly

1. Try to manually timeout a test user (if you can't, bot can't either)
2. Check if bot can send messages in channels
3. Check if bot appears in member list with correct role

#### Method 3: Check Bot's Effective Permissions

1. Go to **Server Settings → Members**
2. Find your bot in the member list
3. Click on the bot
4. View its roles and permissions

---

### ⚠️ Common Issues & Quick Fixes

#### Issue: "Missing Permissions" Error

**Check:**

- [ ] Bot role has "Moderate Members" permission
- [ ] Bot role is above the user's role in hierarchy
- [ ] Bot role has "Ban Members" permission (for bans)

#### Issue: Bot Can't Send Messages

**Check:**

- [ ] Bot role has "Send Messages" permission
- [ ] Channel permissions allow bot to send messages
- [ ] Bot is not rate-limited

#### Issue: Bot Can't Read Messages

**Check:**

- [ ] Bot role has "Read Message History" permission
- [ ] Channel permissions allow bot to read messages

#### Issue: Moderation Actions Don't Work

**Check:**

- [ ] Bot role is above target user's role
- [ ] Bot has "Moderate Members" permission
- [ ] Bot has "Ban Members" permission (for bans)
- [ ] Bot is not below the user in hierarchy

---

### 📝 Testing Notes

**Test Account Setup:**

- Create a test account or use a friend's account
- Give test account a low role (below bot)
- Use test account to send offensive messages

**Safe Testing:**

- Test in a private server first
- Use words you know are in the offensive word list
- Have a way to unban test accounts if needed

**What to Log:**

- Which tests passed/failed
- Any error messages
- Permission issues encountered
- Database logging verification

---

### ✅ Final Verification

After all tests:

- [ ] All essential permissions are enabled
- [ ] Role hierarchy is correct (Admin > Bot > Members)
- [ ] Bot can moderate regular members
- [ ] Bot cannot moderate administrators
- [ ] Progressive moderation works (warning → timeout → ban)
- [ ] Ban status check works
- [ ] Database logging works

---

### 🚀 Ready for Production?

Before deploying to production:

- [ ] All tests passed
- [ ] Permissions verified
- [ ] Role hierarchy correct
- [ ] Error handling tested
- [ ] Database logging verified
- [ ] Bot invite URL updated with new permissions integer

---

## Subscription System Testing Plan

### Overview

This section outlines comprehensive testing procedures for the Video Game Wingman Pro subscription system implementation.

### Pre-Testing Setup

#### Environment Variables Required

- `STRIPE_SECRET_KEY` (test key)
- `STRIPE_WEBHOOK_SECRET` (test webhook secret)
- Database connections configured

#### Test Data Preparation

1. Create test users with different subscription states
2. Set up Stripe test products and prices
3. Configure webhook endpoints

### 1. User Model Testing

#### Test: Subscription Schema Integration

**Objective**: Verify the User model correctly stores subscription data

**Steps**:

1. Create a new user via `/api/syncUser`
2. Check database for subscription field structure
3. Verify default values are set correctly
4. Test subscription status methods

**Expected Results**:

- User document contains subscription object
- Default status is 'expired'
- `hasActiveProAccess()` method works
- `getSubscriptionStatus()` returns correct status

#### Test: Early Access User Creation

**Objective**: Verify early access users get proper subscription setup

**Steps**:

1. Create user with early access eligibility (before Dec 31, 2026 11:59:59 PM EST)
2. Check subscription status is 'free_period'
3. Verify early access dates are set correctly
4. Confirm hasProAccess is true

**Expected Results**:

- `subscription.earlyAccessGranted: true`
- `subscription.earlyAccessStartDate: 2027-01-01T04:59:59.999Z`
- `subscription.earlyAccessEndDate: 2028-01-01T04:59:59.999Z`
- `hasProAccess: true`

### 2. Pro Access Checking Testing

#### Test: Enhanced Access Logic

**Objective**: Verify the new subscription-based access checking works

**Steps**:

1. Call `/api/checkProAccess` with different user types
2. Test early access users
3. Test paid subscription users
4. Test expired users
5. Test users without subscriptions

**Expected Results**:

- Early access users return `hasProAccess: true`
- Paid users return `hasProAccess: true`
- Expired users return `hasProAccess: false`
- Detailed subscription status is returned

#### Test: Backward Compatibility

**Objective**: Ensure existing Pro access logic still works

**Steps**:

1. Test users with legacy `hasProAccess: true`
2. Verify they still have access
3. Check subscription status is populated

**Expected Results**:

- Legacy users maintain access
- Subscription status is generated for display

### 3. Subscription Status Display Testing

#### Test: ProStatus Component

**Objective**: Verify the enhanced ProStatus component displays correctly

**Steps**:

1. Test with different subscription types:
   - Free period active
   - Free period expiring soon (≤30 days)
   - Paid subscription active
   - Canceled subscription (active until period end)
   - Expired free period
   - No subscription

**Expected Results**:

- Correct status badges are displayed
- Warning indicators show for expiring subscriptions
- Action buttons appear appropriately
- Days remaining are calculated correctly

#### Test: Status API Response

**Objective**: Verify `/api/checkProAccess` returns detailed status

**Steps**:

1. Call API with different user types
2. Check response structure
3. Verify subscription status details

**Expected Results**:

- Response includes `hasProAccess` boolean
- Response includes `subscriptionStatus` object
- Status contains type, status text, expiration info
- Warning flags are set correctly

### 4. Early Access Management Testing

#### Test: User Registration Flow

**Objective**: Verify new users get proper early access setup

**Steps**:

1. Create new user via `/api/syncUser`
2. Check if user is eligible for early access
3. Verify subscription data is set up correctly
4. Test with user after deadline

**Expected Results**:

- Users before deadline get early access
- Users after deadline don't get early access
- Subscription data is properly structured

#### Test: Early Access Expiration Warnings

**Objective**: Verify warning system works correctly

**Steps**:

1. Test `/api/checkEarlyAccessExpiration` with different scenarios:
   - More than 60 days remaining
   - 30-60 days remaining
   - 7-30 days remaining
   - 1-7 days remaining
   - 1 day remaining
   - Expired

**Expected Results**:

- Correct warning levels are returned
- Appropriate messages are shown
- Days remaining is calculated correctly
- Action recommendations are provided

### 5. Transition Flow Testing

#### Test: Early Access to Paid Transition

**Objective**: Verify transition API works correctly

**Steps**:

1. Call `/api/transitionEarlyAccess` with eligible user
2. Check response data structure
3. Verify transition eligibility logic
4. Test with ineligible users

**Expected Results**:

- Eligible users can transition
- Proper transition data is returned
- Ineligible users are rejected
- User state is updated correctly

### 6. Payment Prevention Testing

#### Test: Webhook Protection

**Objective**: Verify early access users are protected from charges

**Steps**:

1. Simulate subscription creation for early access user
2. Check webhook prevents charge
3. Verify subscription is canceled
4. Confirm user state is updated

**Expected Results**:

- Unauthorized subscriptions are canceled
- User remains in free period
- Logs show prevention actions
- No charges occur

#### Test: Legitimate Transition Protection

**Objective**: Verify legitimate transitions are allowed

**Steps**:

1. Test transition with proper metadata
2. Verify subscription is processed
3. Check user state updates correctly

**Expected Results**:

- Legitimate transitions succeed
- User moves to paid subscription
- Proper metadata is required

### 7. Integration Testing

#### Test: End-to-End User Journey

**Objective**: Test complete user experience

**Steps**:

1. Create early access user
2. Verify free period access
3. Test warning notifications
4. Simulate transition to paid
5. Verify paid subscription works

**Expected Results**:

- Smooth user experience
- Proper state transitions
- Correct access levels
- Appropriate notifications

### 8. Error Handling Testing

#### Test: Database Connection Issues

**Objective**: Verify graceful error handling

**Steps**:

1. Test with disconnected database
2. Verify error responses
3. Check logging

**Expected Results**:

- Graceful error handling
- Proper error messages
- No application crashes

#### Test: Invalid Data Handling

**Objective**: Verify system handles invalid data

**Steps**:

1. Test with malformed user data
2. Test with missing subscription fields
3. Test with invalid dates

**Expected Results**:

- System doesn't crash
- Default values are used
- Errors are logged

### Testing Tools

#### Manual Testing Scripts

```javascript
// Test subscription status
const testSubscriptionStatus = async (username) => {
  const response = await fetch('/api/checkProAccess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  return response.json();
};

// Test early access expiration
const testEarlyAccessExpiration = async (username) => {
  const response = await fetch('/api/checkEarlyAccessExpiration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  return response.json();
};

// Test transition eligibility
const testTransitionEligibility = async (username) => {
  const response = await fetch('/api/transitionEarlyAccess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  return response.json();
};
```

#### Database Queries for Verification

```javascript
// Check user subscription status
db.users.findOne({ username: "testuser" }, { subscription: 1, hasProAccess: 1 });

// Check early access users
db.users.find({ "subscription.earlyAccessGranted": true });

// Check subscription status distribution
db.users.aggregate([
  { $group: { _id: "$subscription.status", count: { $sum: 1 } } }
]);
```

### Success Criteria

#### Functional Requirements

- [ ] Early access users get free period correctly
- [ ] Pro access checking works for all user types
- [ ] Subscription status display shows correct information
- [ ] Warning notifications appear at appropriate times
- [ ] Transition flow works for eligible users
- [ ] Payment prevention protects early access users
- [ ] Webhook handles all event types correctly

#### Performance Requirements

- [ ] API responses under 500ms
- [ ] Database queries optimized
- [ ] No memory leaks
- [ ] Proper error logging

#### Security Requirements

- [ ] No unauthorized access to subscription data
- [ ] Webhook signature verification works
- [ ] Payment prevention is reliable
- [ ] User data is protected

### Post-Testing Actions

1. **Document Results**: Record all test outcomes
2. **Fix Issues**: Address any failures found
3. **Performance Optimization**: Improve slow operations
4. **Security Review**: Verify all security measures
5. **User Experience**: Ensure smooth interactions

### Next Steps After Testing

1. **Stripe Integration**: Set up actual Stripe configuration
2. **Checkout Flow**: Implement payment collection
3. **Customer Portal**: Add subscription management
4. **Email Notifications**: Set up automated alerts
5. **Monitoring**: Add subscription analytics

