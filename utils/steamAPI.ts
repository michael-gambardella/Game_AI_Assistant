import axios from 'axios';

export interface SteamRecentGame {
  appid: number;
  name: string;
  playtime_2weeks: number; // in minutes
  playtime_forever: number; // in minutes
}

export const fetchRecentlyPlayedGames = async (steamId: string): Promise<SteamRecentGame[] | null> => {
  const apiKey = process.env.STEAM_API_KEY;

  if (!apiKey) {
    console.error('STEAM_API_KEY environment variable is missing.');
    return null;
  }

  try {
    const response = await axios.get(
      `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${apiKey}&steamid=${steamId}&count=5`
    );

    const games = response.data?.response?.games;
    if (games && games.length > 0) {
      return games as SteamRecentGame[];
    }

    // No games in the 2-week window — fall back to most recently played from owned games
    const ownedResponse = await axios.get(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`
    );

    const ownedGames = ownedResponse.data?.response?.games;

    // Profile is private or user owns no games
    if (!ownedGames || ownedGames.length === 0) {
      return [];
    }

    // Sort by rtime_last_played descending, take top 5 with any playtime
    const recentlyPlayed = ownedGames
      .filter((g: any) => g.rtime_last_played && g.rtime_last_played > 0)
      .sort((a: any, b: any) => b.rtime_last_played - a.rtime_last_played)
      .slice(0, 5)
      .map((g: any) => ({
        appid: g.appid,
        name: g.name,
        playtime_2weeks: 0, // not available from owned games endpoint
        playtime_forever: g.playtime_forever ?? 0,
      }));

    return recentlyPlayed.length > 0 ? recentlyPlayed : [];
  } catch (error: any) {
    console.error('Error fetching recently played games from Steam:', error.message);
    return null;
  }
};

export const fetchSteamGameDetails = async (gameId: string): Promise<any> => {
  const apiKey = process.env.STEAM_API_KEY;

  if (!apiKey) {
    console.error('STEAM_API_KEY environment variable is missing.');
    return null;
  }

  try {
    const [gameSchema, achievementStats, gameNews] = await Promise.all([
      axios.get(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${gameId}`),
      axios.get(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${gameId}&key=${apiKey}`),
      axios.get(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${gameId}&count=5&maxlength=300`)
    ]);

    return {
      gameSchema: gameSchema.data,
      achievementStats: achievementStats.data?.achievementpercentages?.achievements ?? null,
      gameNews: gameNews.data?.appnews?.newsitems ?? null
    };
  } catch (error: any) {
    console.error('Error fetching data from Steam API:', error.message);
    return null;
  }
};
