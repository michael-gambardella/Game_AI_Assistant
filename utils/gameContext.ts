import { fetchRecentlyPlayedGames } from './steamAPI';

export const MAX_PROGRESS_LENGTH = 150;

/**
 * Normalizes a user-entered progress note ("Chapter 4", "just beat Margit") for storage
 * and prompt injection: single line, no quotes/brackets (which would let it break out of
 * the bracketed [Game Context: ...] block), capped length. Returns '' when empty.
 */
export function normalizeProgress(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/["\[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROGRESS_LENGTH)
    .trim();
}

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
  gameTracking?: { currentlyPlaying?: Array<{ gameName: string; progress?: string }> };
  steamId?: string;
}): Promise<CurrentGameContext> {
  const trackedEntries = (user.gameTracking?.currentlyPlaying || [])
    .map(g => ({ name: g.gameName?.trim(), progress: normalizeProgress(g.progress) }))
    .filter((g): g is { name: string; progress: string } => !!g.name);
  const trackedGames = trackedEntries.map(g => g.name);
  const hasProgress = trackedEntries.some(g => g.progress);

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
  if (trackedEntries.length > 0) {
    const described = trackedEntries.map(g =>
      g.progress ? `${g.name} (current progress: "${g.progress}")` : g.name
    );
    parts.push(`Currently playing: ${described.join(', ')}`);
  }
  if (uniqueSteamGames.length > 0) {
    parts.push(`Recently played on Steam: ${uniqueSteamGames.join(', ')}`);
  }

  const primaryGame = trackedGames[0] || steamGames[0]?.split(' (')[0];

  // Spoiler-safe mode: only added when the user has told us how far they are in at least one game,
  // and scoped to those games so answers about other titles are unaffected.
  const spoilerInstruction = hasProgress
    ? ` SPOILER-SAFE MODE: For any game above with a stated current progress, treat everything beyond that point as a spoiler. Do NOT reveal later story events, plot twists, character deaths or identity reveals, endings, or the names of later bosses, areas, or unlocks. Answer using only what is relevant at or before their current progress. If a complete answer would require later-game information, briefly say so and tell them they can ask again with "spoilers OK" — unless this question already explicitly asks for spoilers, in which case answer fully.`
    : '';

  const contextString = `[Game Context: This user is ${parts.join('. ')}. When the question doesn't name a specific game, assume it's about the game(s) listed above and answer accordingly. When suggesting games, prioritize titles in the same or closely related game types as the games listed above. Do NOT suggest generic "best games" lists — tailor suggestions specifically to the game types and styles of the user's current games.${spoilerInstruction}]`;

  return { contextString, primaryGame };
}
