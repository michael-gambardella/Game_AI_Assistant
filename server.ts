import { createServer } from "http";
import { parse, UrlWithParsedQuery } from "url";
import next from "next";
import { initSocket } from "./middleware/realtime";
import { initializeScheduler } from "./utils/automatedUsersScheduler";
import { initializeDiscordBot, shutdownDiscordBot } from "./utils/discordBot";
import { initializeTwitchBot, shutdownTwitchBot } from "./utils/twitchBot";
import { startTokenRefreshScheduler } from "./utils/twitchBotTokenRefresh";
import fs from "fs";
import path from "path";

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

// Function to set up Google Vision credentials
const setupGoogleCredentials = () => {
  // Use OS-appropriate temp directory
  const tempDir = process.platform === 'win32' 
    ? path.join(process.env.TEMP || process.env.TMP || 'C:\\temp', 'service-account-key.json')
    : path.join("/tmp", "service-account-key.json");
  
  const credentialsPath = tempDir;
  
  // Check for GOOGLE_CREDENTIALS first (used by API routes), then fall back to GOOGLE_APPLICATION_CREDENTIALS_JSON
  let credentials = process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  
  if (credentials) {
    // If GOOGLE_CREDENTIALS is already a JSON object string, use it directly
    // If it's already parsed or needs parsing, handle it
    try {
      // Ensure the directory exists
      const dir = path.dirname(credentialsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Try to parse if it's a string (GOOGLE_CREDENTIALS might already be JSON)
      const parsed = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
      // Write the JSON credentials to a file in the temporary directory
      fs.writeFileSync(credentialsPath, JSON.stringify(parsed));
      // Set the GOOGLE_APPLICATION_CREDENTIALS environment variable to point to the file
      process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
      console.log("Google Vision API credentials set up successfully.");
    } catch (error) {
        // If parsing fails, assume it's already a JSON string and write it directly
        try {
          // Ensure the directory exists
          const dir = path.dirname(credentialsPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(credentialsPath, credentials);
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
          console.log("Google Vision API credentials set up successfully.");
        } catch (writeError) {
          // Log error but don't throw - app can work without Google credentials
          const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
          console.warn("Failed to write Google credentials file:", errorMessage);
          // Continue without credentials - app can work without it
        }
      }
  } else {
    // Only log as warning, not error, since the app can work without it (image moderation will be skipped)
    console.warn("Google Vision API credentials not set. Image analysis and moderation features will be limited.");
    console.warn("Set GOOGLE_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable to enable full functionality.");
  }
};

// Mark that server is initializing (prevents duplicate error handlers in logger)
process.env.SERVER_INITIALIZED = 'true';

app.prepare().then(async () => {
  const server = createServer((req, res) => {
    const parsedUrl: UrlWithParsedQuery = req.url
      ? parse(req.url, true)
      : { query: {}, pathname: "/", path: null, href: "", search: null, slashes: null, auth: null, hash: null, host: null, hostname: null, port: null, protocol: null };

    handle(req, res, parsedUrl);
  });

  // Initialize the Socket.IO server
  initSocket(server);

  // Initialize automated users scheduler
  console.log('Initializing automated users scheduler...');
  console.log(`AUTOMATED_USERS_ENABLED: ${process.env.AUTOMATED_USERS_ENABLED}`);
  console.log(`Server starting at: ${new Date().toISOString()}`);
  console.log(`Node version: ${process.version}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  
  // Server keepalive commented out - not needed with Standard 1x dyno (always on)
  // The scheduler heartbeat (every 5 minutes) is sufficient for monitoring
  // setInterval(() => {
  //   console.log(`[SERVER KEEPALIVE] Server is alive at ${new Date().toISOString()}`);
  // }, 60000); // Every minute
  
  initializeScheduler();
  setupGoogleCredentials();

  // Initialize Discord bot
  // Note: This is optional - server will continue even if bot fails to initialize
  try {
    const botInitialized = await initializeDiscordBot();
    if (botInitialized) {
      console.log('✅ Discord bot initialized successfully');
    } else {
      // Bot initialization was skipped (likely missing configuration)
      // This is expected behavior and not an error
      console.warn('⚠️ Discord bot initialization skipped (Discord bot features will be unavailable)');
    }
  } catch (error) {
    // Unexpected error during initialization - log but don't crash server
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Unexpected error during Discord bot initialization:', errorMessage);
    // Server continues even if bot fails to initialize
  }

  // Initialize Twitch bot
  // Note: This is optional - server will continue even if bot fails to initialize
  try {
    const twitchBotInitialized = await initializeTwitchBot();
    if (twitchBotInitialized) {
      console.log('✅ Twitch bot initialized successfully');
    } else {
      // Bot initialization was skipped (likely missing configuration or invalid token)
      // This is expected behavior and not an error
      console.warn('⚠️ Twitch bot initialization skipped (Twitch bot features will be unavailable)');
    }
    
    // Start automatic token refresh scheduler regardless of initialization status
    // This allows the scheduler to refresh tokens and retry initialization later
    // This will check and refresh the bot token every hour
    try {
      startTokenRefreshScheduler();
      console.log('✅ Twitch bot token refresh scheduler started');
    } catch (schedulerError) {
      const schedulerErrorMessage = schedulerError instanceof Error ? schedulerError.message : String(schedulerError);
      const schedulerErrorStack = schedulerError instanceof Error ? schedulerError.stack : undefined;
      console.warn('⚠️ Failed to start token refresh scheduler:', schedulerErrorMessage);
      if (dev && schedulerErrorStack) {
        console.warn('Stack:', schedulerErrorStack);
      }
      // Non-fatal - bot will still work, just won't auto-refresh
    }
  } catch (error) {
    // Unexpected error during initialization - log but don't crash server
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Unexpected error during Twitch bot initialization:', errorMessage);
    if (dev && errorStack) {
      console.error('Stack:', errorStack);
    }
    
    // Still try to start the scheduler - it might help refresh tokens
    try {
      startTokenRefreshScheduler();
      console.log('✅ Twitch bot token refresh scheduler started (despite initialization error)');
    } catch (schedulerError) {
      const schedulerErrorMessage = schedulerError instanceof Error ? schedulerError.message : String(schedulerError);
      console.warn('⚠️ Failed to start token refresh scheduler:', schedulerErrorMessage);
    }
    // Server continues even if bot fails to initialize
  }

  // Start the server
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });

  // Graceful shutdown handling
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    // Close HTTP server
    server.close(() => {
      console.log('HTTP server closed');
    });

    // Shutdown Discord bot
    await shutdownDiscordBot();

    // Shutdown Twitch bot
    await shutdownTwitchBot();

    // Give processes time to finish
    setTimeout(() => {
      console.log('Graceful shutdown complete');
      process.exit(0);
    }, 5000);
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle connection errors gracefully (client disconnects, aborted requests, etc.)
  // These are common and non-critical - just log them without crashing
  process.on('uncaughtException', (error: Error) => {
    // Check if it's a Node.js error with a code property
    const nodeError = error as Error & { code?: string };
    
    // Ignore connection reset errors (ECONNRESET, EPIPE, aborted) - these happen when clients close connections
    const isConnectionError = 
      nodeError.code === 'ECONNRESET' || 
      nodeError.code === 'EPIPE' || 
      error.message === 'aborted' ||
      error.message?.toLowerCase().includes('aborted') ||
      error.message?.toLowerCase().includes('econnreset');
    
    if (isConnectionError) {
      // Silently ignore - these are expected when clients close connections mid-request
      // Only log in development for debugging
      if (dev) {
        console.debug('Client connection closed (ignored):', nodeError.code || error.message);
      }
      return; // Don't crash or log as error
    }
    
    // Log other uncaught exceptions
    console.error('❌ Uncaught Exception:', error.message);
    if (dev && error.stack) {
      console.error('Stack:', error.stack);
    }
    
    // In production, exit on uncaught exceptions (except connection errors)
    if (!dev) {
      process.exit(1);
    }
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    // Check if it's a Node.js error with a code property
    const nodeError = reason as Error & { code?: string };
    
    // Ignore connection-related rejections
    if (reason && (nodeError.code === 'ECONNRESET' || nodeError.code === 'EPIPE' || (reason instanceof Error && reason.message === 'aborted'))) {
      if (dev) {
        console.debug('Unhandled rejection (connection closed):', nodeError.code || (reason instanceof Error ? reason.message : String(reason)));
      }
      return;
    }
    
    // Log full error details
    console.error('❌ Unhandled Rejection:');
    if (reason instanceof Error) {
      console.error('  Error:', reason.message);
      console.error('  Name:', reason.name);
      if (reason.stack) {
        console.error('  Stack:', reason.stack);
      }
      if (nodeError.code) {
        console.error('  Code:', nodeError.code);
      }
    } else {
      console.error('  Reason:', reason);
      console.error('  Type:', typeof reason);
      try {
        console.error('  Stringified:', JSON.stringify(reason, null, 2));
      } catch (e) {
        console.error('  (Could not stringify reason)');
      }
    }
  });
});