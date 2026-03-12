# Video Game Wingman

**Your AI-powered gaming companion for Discord and web**

Video Game Wingman is an intelligent AI assistant designed specifically for gamers. Whether you're stuck on a difficult level, looking for game recommendations, or want to discuss gaming strategies with fellow players, Video Game Wingman is your go-to companion.

## 🎮 What is Video Game Wingman?

Video Game Wingman is more than just an AI - it's a gamer who lives and breathes video games, always ready to discuss strategies, secrets, and stories. Think of it as your enthusiastic co-op partner in your gaming journey.

### Key Features

- **AI-Powered Gaming Assistant**: Get personalized help with walkthroughs, game recommendations, and strategies
- **Discord Bot Integration**: Add Video Game Wingman to your Discord server for real-time gaming discussions
- **Community Forums**: Join Pro-only forums to discuss games, share tips, and connect with other gamers
- **Real-time Notifications**: Get instant updates about achievements, forum responses, and community activity
- **Progress Tracking**: Track your gaming progress and achievements with detailed analytics
- **Health & Ergonomics Monitoring**: Get break reminders and health tips to maintain healthy gaming habits
- **Multi-Platform Support**: Access via web interface or Discord

### What Video Game Wingman Can Help With

- 🎯 **Game Walkthroughs**: Step-by-step guidance for any game
- 🎮 **Game Recommendations**: Personalized suggestions based on your preferences
- 🔍 **Hidden Secrets**: Discover easter eggs and hidden content
- 💡 **Tips & Tricks**: Pro strategies to improve your gameplay
- 📚 **Game Lore**: Deep dives into game stories and backstories
- 📊 **Progress Tracking**: Track your gaming progress and achievements with detailed analytics
- 🏆 **Achievement System**: Earn achievements based on your gaming questions and activities
- ⏰ **Health Monitoring**: Get break reminders and ergonomics tips for healthy gaming
- 🎪 **Game News**: Stay updated with the latest gaming industry news

## 🚀 Getting Started

### Prerequisites

- Node.js 20.x or higher
- MongoDB database
- Discord Application (for bot features)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd ai_assistant_nextjs
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

4. Run the development server:

**For normal frontend development (with HMR and Fast Refresh):**

```bash
npm run dev
```

**For full-stack development (includes Discord bot, Socket.IO, and all services):**

```bash
npm run dev:full
```

**When to use each:**

- Use `npm run dev` for most development work - it's faster with Hot Module Replacement (HMR) and Fast Refresh
- Use `npm run dev:full` when you need to test:
  - Discord bot functionality
  - Socket.IO real-time features
  - Automated scheduler
  - Full integration testing

## Game catalog data (automated users)

The automated-user system uses a unified catalog file:
- `data/automated-users/games.json` (**source of truth**)

Legacy compatibility files:
- `data/automated-users/single-player.json`
- `data/automated-users/multiplayer.json`

During migration, the app will prefer `games.json` and fall back to the legacy files if `games.json` is missing.

### Regenerating legacy lists (optional)

If you need to regenerate the legacy lists from `games.json`:

```bash
npx tsx scripts/generate-legacy-game-lists.ts
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Discord Bot Setup

1. Create a Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Add the bot to your server using the invite link
3. Configure the bot with your Discord Application ID

### Setting Up Bot Information Channel

To create an informational channel in your Discord server that explains how to use the bot:

1. **Create the channel** in your Discord server (e.g., `#bot-information` or `#how-to-use-bot`)

2. **Run the information script** to automatically populate the channel with helpful guides:

```bash
npx tsx scripts/sendBotInfoToChannel.ts bot-information
```

Replace `bot-information` with the name of your channel (without the `#`).

The script will send multiple informational embeds covering:

- How to communicate with the bot (DMs, mentions, slash commands)
- What kinds of questions you can ask
- Pro Access information
- How to add the bot to other servers
- Additional tips and information

**Note:** Make sure your Discord bot is running (`npm run dev:full`) and has access to the channel before running the script.

## 🏗️ Architecture

- **Frontend**: Next.js 14 with React 18
- **Backend**: Next.js API routes
- **Database**: MongoDB with Mongoose
- **Authentication**: Custom auth system with Discord OAuth
- **AI Integration**: OpenAI GPT models
- **Real-time Features**: Socket.IO for live updates
- **Payment Processing**: Stripe for Pro subscriptions

## 📁 Project Structure

```
├── app/                    # Next.js app directory
│   ├── page.tsx           # Main chat interface
│   ├── forum/             # Forum pages
│   ├── account/           # User account management
│   └── upgrade/           # Pro subscription page
├── components/            # React components
│   ├── ForumList.tsx      # Forum listing component
│   ├── CreateForum.tsx    # Forum creation component
│   └── Sidebar.tsx        # Navigation sidebar
├── pages/api/             # API endpoints
│   ├── assistant.ts       # AI chat endpoint
│   ├── discord/           # Discord integration
│   └── forum/             # Forum management
├── utils/                 # Utility functions
│   ├── discordBot.ts      # Discord bot logic
│   ├── aiHelper.ts        # AI integration
│   └── proAccessUtil.ts   # Pro feature access
└── models/                # Database models
    ├── User.ts            # User schema
    ├── Forum.ts           # Forum schema
    └── Question.ts        # Chat history schema
```

## 🧹 Maintenance & Cleanup Notes

- **Tests**
  - Automated / manual test scripts live in `tests/` and are referenced from `package.json` where required (for example, `testDatabaseConnections.ts` via `npm run test:db`).
  - Testing checklists and QA procedures are consolidated in `docs/testing/TESTING.md` (with `docs/testing/README.md` as an index).
- **Scripts**
  - Operational and QA helper scripts live under `scripts/` (for example, `clean-next-build.js`, `test-security-headers.js`, `test-token-blacklist.js`) and are safe to keep; they are either wired to npm scripts or useful one-off tools.
- **Dev-only API routes**
  - Historical ad-hoc API test routes (for Twitch bot, automated users, and helper tests) have been removed from `pages/api/` to keep the production surface clean.
  - If you add new dev-only routes, prefer grouping them under a clearly named path (for example, `pages/api/_dev/`) and removing them before production deploys.
- **Docs**
  - High-level project documentation is this `README.md`.
  - Deeper structure/cleanup notes that used to live in `PROJECT_STRUCTURE_ANALYSIS.md` are now summarized in this section; the separate file has been removed to reduce top-level clutter.

## 🎯 Pro Features

Upgrade to Video Game Wingman Pro to unlock:

- **Unlimited Questions**: No rate limits on AI interactions
- **Forum Access**: Create and participate in exclusive gaming forums
- **Real-time Notifications**: Instant updates on achievements and forum activity
- **Advanced Analytics**: Detailed gaming progress tracking
- **Priority Support**: Faster response times for assistance
- **Private Forums**: Create invite-only discussion groups

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines for details on how to:

- Report bugs
- Suggest new features
- Submit pull requests
- Set up the development environment

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Discord**: Join our Discord server for community support
- **GitHub Issues**: Report bugs and request features on our GitHub repository
- **Email**: Contact the developer directly

## 🔗 Links

- **Website**: [https://assistant.videogamewingman.com](https://assistant.videogamewingman.com)
- **Discord Bot**: Add to your server
- **GitHub Repository**: [View source code and contribute](https://github.com/your-org/video-game-wingman)

---

_Ready to level up your gaming experience? Let Video Game Wingman be your guide!_ 🎮✨
