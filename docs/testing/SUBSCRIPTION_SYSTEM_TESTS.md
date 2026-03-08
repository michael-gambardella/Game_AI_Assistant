# Subscription System Testing Plan

## Overview
This document outlines comprehensive testing procedures for the Video Game Wingman Pro subscription system implementation.

## Pre-Testing Setup

### Environment Variables Required
- `STRIPE_SECRET_KEY` (test key)
- `STRIPE_WEBHOOK_SECRET` (test webhook secret)
- Database connections configured

### Test Data Preparation
1. Create test users with different subscription states
2. Set up Stripe test products and prices
3. Configure webhook endpoints

## 1. User Model Testing

### Test: Subscription Schema Integration
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

### Test: Early Access User Creation
**Objective**: Verify early access users get proper subscription setup

**Steps**:
1. Create user with early access eligibility (before Dec 31, 2025)
2. Check subscription status is 'free_period'
3. Verify early access dates are set correctly
4. Confirm hasProAccess is true

**Expected Results**:
- `subscription.earlyAccessGranted: true`
- `subscription.earlyAccessStartDate: 2025-12-31T23:59:59.999Z`
- `subscription.earlyAccessEndDate: 2026-12-31T23:59:59.999Z`
- `hasProAccess: true`

## 2. Pro Access Checking Testing

### Test: Enhanced Access Logic
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

### Test: Backward Compatibility
**Objective**: Ensure existing Pro access logic still works

**Steps**:
1. Test users with legacy `hasProAccess: true`
2. Verify they still have access
3. Check subscription status is populated

**Expected Results**:
- Legacy users maintain access
- Subscription status is generated for display

## 3. Subscription Status Display Testing

### Test: ProStatus Component
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

### Test: Status API Response
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

## 4. Early Access Management Testing

### Test: User Registration Flow
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

### Test: Early Access Expiration Warnings
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

## 5. Transition Flow Testing

### Test: Early Access to Paid Transition
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

## 6. Payment Prevention Testing

### Test: Webhook Protection
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

### Test: Legitimate Transition Protection
**Objective**: Verify legitimate transitions are allowed

**Steps**:
1. Test transition with proper metadata
2. Verify subscription is processed
3. Check user state updates correctly

**Expected Results**:
- Legitimate transitions succeed
- User moves to paid subscription
- Proper metadata is required

## 7. Integration Testing

### Test: End-to-End User Journey
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

## 8. Error Handling Testing

### Test: Database Connection Issues
**Objective**: Verify graceful error handling

**Steps**:
1. Test with disconnected database
2. Verify error responses
3. Check logging

**Expected Results**:
- Graceful error handling
- Proper error messages
- No application crashes

### Test: Invalid Data Handling
**Objective**: Verify system handles invalid data

**Steps**:
1. Test with malformed user data
2. Test with missing subscription fields
3. Test with invalid dates

**Expected Results**:
- System doesn't crash
- Default values are used
- Errors are logged

## Testing Tools

### Manual Testing Scripts
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

### Database Queries for Verification
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

## Success Criteria

### Functional Requirements
- [ ] Early access users get free period correctly
- [ ] Pro access checking works for all user types
- [ ] Subscription status display shows correct information
- [ ] Warning notifications appear at appropriate times
- [ ] Transition flow works for eligible users
- [ ] Payment prevention protects early access users
- [ ] Webhook handles all event types correctly

### Performance Requirements
- [ ] API responses under 500ms
- [ ] Database queries optimized
- [ ] No memory leaks
- [ ] Proper error logging

### Security Requirements
- [ ] No unauthorized access to subscription data
- [ ] Webhook signature verification works
- [ ] Payment prevention is reliable
- [ ] User data is protected

## Post-Testing Actions

1. **Document Results**: Record all test outcomes
2. **Fix Issues**: Address any failures found
3. **Performance Optimization**: Improve slow operations
4. **Security Review**: Verify all security measures
5. **User Experience**: Ensure smooth interactions

## Next Steps After Testing

1. **Stripe Integration**: Set up actual Stripe configuration
2. **Checkout Flow**: Implement payment collection
3. **Customer Portal**: Add subscription management
4. **Email Notifications**: Set up automated alerts
5. **Monitoring**: Add subscription analytics
