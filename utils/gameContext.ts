import { fetchRecentlyPlayedGames } from './steamAPI';

export interface CurrentGameContext {
  contextString: string;
  primaryGame?: string;
}

/**
 * Builds a "what is this user currently playing" context block for the AI,
 * so users don't have to restate the game in every question.
 *
 * Prefers the user's explicit gameTracking.currentlyPlaying list (they told us
 * directly) over the Steam recently-played heuristic (inferred from playtime).
 * Formatted as a bracketed instruction block rather than folded into the
 * question text, so it can't be mistaken for a game title to extract/search on
 * (mirrors the existing Steam-context handling in pages/api/assistant.ts).
 */
export async function getCurrentGameContext(user: {
  gameTracking?: { currentlyPlaying?: Array<{ gameName: string }> };
  steamId?: string;
}): Promise<CurrentGameContext> {
  const trackedGames = (user.gameTracking?.currentlyPlaying || [])
    .map(g => g.gameName?.trim())
    .filter((name): name is string => !!name);

  let steamGames: string[] = [];
  if (user.steamId) {
    try {
      const recentGames = await fetchRecentlyPlayedGames(user.steamId);
      if (recentGames && recentGames.length > 0) {
        steamGames = recentGames.map(g => {
          const totalHours = Math.round(g.playtime_forever / 60);
          if (g.playtime_2weeks > 0) {
            const recentHours = (g.playtime_2weeks / 60).toFixed(1);
            return `${g.name} (${recentHours}h this week, ${totalHours}h total)`;
          }
          return totalHours > 0 ? `${g.name} (${totalHours}h total)` : g.name;
        });
      }
    } catch {
      // Never let Steam API failures block question answering
    }
  }

  if (trackedGames.length === 0 && steamGames.length === 0) {
    return { contextString: '' };
  }

  // Dedupe Steam entries that are already represented in the explicit list
  const trackedLower = new Set(trackedGames.map(g => g.toLowerCase()));
  const uniqueSteamGames = steamGames.filter(
    g => !trackedLower.has(g.split(' (')[0].toLowerCase())
  );

  const parts: string[] = [];
  if (trackedGames.length > 0) {
    parts.push(`Currently playing: ${trackedGames.join(', ')}`);
  }
  if (uniqueSteamGames.length > 0) {
    parts.push(`Recently played on Steam: ${uniqueSteamGames.join(', ')}`);
  }

  const primaryGame = trackedGames[0] || steamGames[0]?.split(' (')[0];

  const contextString = `[Game Context: This user is ${parts.join('. ')}. When the question doesn't name a specific game, assume it's about the game(s) listed above and answer accordingly. When suggesting games, prioritize titles in the same or closely related game types as the games listed above. Do NOT suggest generic "best games" lists — tailor suggestions specifically to the game types and styles of the user's current games.]`;

  return { contextString, primaryGame };
}
