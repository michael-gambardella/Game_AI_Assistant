# Discord Bot Testing Checklist

## ✅ Role Setup Verification

### Role Hierarchy (Already Fixed)

- [x] Administrator role is **above** Discord Bot role
- [x] Discord Bot role is **above** @everyone role

### Bot Role Permissions Check

Go to **Server Settings → Roles → Discord Bot** and verify these permissions are **ENABLED**:

#### Essential Permissions (Required):

- [ ] **View Channels** - Bot needs to see channels
- [ ] **Send Messages** - Bot needs to respond
- [ ] **Read Message History** - Bot needs to read messages for moderation
- [ ] **Moderate Members** - Required for timeouts ⚠️ **CRITICAL**
- [ ] **Ban Members** - Required for permanent bans ⚠️ **CRITICAL**
- [ ] **Kick Members** - Optional but recommended

#### Recommended Permissions:

- [ ] **Use Slash Commands** - If you use slash commands
- [ ] **Embed Links** - For rich warning messages
- [ ] **Manage Messages** - To delete offensive messages (optional)

**Note:** If any of the essential permissions are missing, the bot will fail to moderate users.

---

## 🧪 Testing Checklist

### Test 1: Basic Bot Functionality

- [ ] Bot responds to DMs
- [ ] Bot responds when mentioned in server channels
- [ ] Bot sends messages correctly
- [ ] Bot can read messages

### Test 2: Content Moderation - First Violation (Warning)

**Setup:** Use a test account (not your admin account)

1. [ ] Send a message with offensive content (use a word from the offensive word list)
2. [ ] **Expected:** Bot sends warning message (via DM or channel reply)
3. [ ] **Expected:** Bot does NOT process the message with AI
4. [ ] **Expected:** Message is logged in database

### Test 3: Content Moderation - Second Violation (Timeout)

**Setup:** Same test account, send another offensive message

1. [ ] Send second offensive message
2. [ ] **Expected:** Bot applies 5-minute timeout
3. [ ] **Expected:** User cannot send messages for 5 minutes
4. [ ] **Expected:** Action is logged in database

### Test 4: Content Moderation - Progressive Escalation

**Setup:** Continue with same test account

1. [ ] Send third offensive message
2. [ ] **Expected:** Bot applies 30-minute timeout
3. [ ] Send fourth offensive message
4. [ ] **Expected:** Bot applies 1-hour timeout
5. [ ] Send fifth offensive message
6. [ ] **Expected:** Bot permanently bans user

### Test 5: Ban Status Check

**Setup:** Use a banned test account

1. [ ] Banned user sends message
2. [ ] **Expected:** Bot silently rejects (no response)
3. [ ] **Expected:** Message is not processed

### Test 6: AI Response Filtering

**Note:** This is harder to test, but verify:

1. [ ] Bot generates normal responses for clean messages
2. [ ] If AI generates inappropriate content, it's replaced with safe fallback

### Test 7: Admin Protection

**Setup:** Use your Administrator account

1. [ ] Send offensive content as Administrator
2. [ ] **Expected:** Bot CANNOT timeout/ban you (role hierarchy protection)
3. [ ] **Expected:** Bot may still send warning (if it can read your message)

### Test 8: DM Moderation

**Setup:** Use a test account

1. [ ] Send offensive content in DM to bot
2. [ ] **Expected:** Bot sends warning
3. [ ] **Expected:** Bot does NOT attempt timeout/ban (not possible in DMs)

---

## 🔍 How to Verify Permissions

### Method 1: Check Role Settings

1. Go to **Server Settings → Roles**
2. Click on **Discord Bot** role
3. Scroll through permissions list
4. Verify all essential permissions are **ON** (green checkmark)

### Method 2: Test Permissions Directly

1. Try to manually timeout a test user (if you can't, bot can't either)
2. Check if bot can send messages in channels
3. Check if bot appears in member list with correct role

### Method 3: Check Bot's Effective Permissions

1. Go to **Server Settings → Members**
2. Find your bot in the member list
3. Click on the bot
4. View its roles and permissions

---

## ⚠️ Common Issues & Quick Fixes

### Issue: "Missing Permissions" Error

**Check:**

- [ ] Bot role has "Moderate Members" permission
- [ ] Bot role is above the user's role in hierarchy
- [ ] Bot role has "Ban Members" permission (for bans)

### Issue: Bot Can't Send Messages

**Check:**

- [ ] Bot role has "Send Messages" permission
- [ ] Channel permissions allow bot to send messages
- [ ] Bot is not rate-limited

### Issue: Bot Can't Read Messages

**Check:**

- [ ] Bot role has "Read Message History" permission
- [ ] Channel permissions allow bot to read messages

### Issue: Moderation Actions Don't Work

**Check:**

- [ ] Bot role is above target user's role
- [ ] Bot has "Moderate Members" permission
- [ ] Bot has "Ban Members" permission (for bans)
- [ ] Bot is not below the user in hierarchy

---

## 📝 Testing Notes

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

## ✅ Final Verification

After all tests:

- [ ] All essential permissions are enabled
- [ ] Role hierarchy is correct (Admin > Bot > Members)
- [ ] Bot can moderate regular members
- [ ] Bot cannot moderate administrators
- [ ] Progressive moderation works (warning → timeout → ban)
- [ ] Ban status check works
- [ ] Database logging works

---

## 🚀 Ready for Production?

Before deploying to production:

- [ ] All tests passed
- [ ] Permissions verified
- [ ] Role hierarchy correct
- [ ] Error handling tested
- [ ] Database logging verified
- [ ] Bot invite URL updated with new permissions integer
