import axios from 'axios';
import { getClientCredentialsAccessToken } from './twitchAuth';

// Utility function to clean and match titles
export function cleanAndMatchTitle(queryTitle: string, recordTitle: string): boolean {
  const cleanQuery = queryTitle.toLowerCase().trim();
  const cleanRecord = recordTitle.toLowerCase().trim();
  return cleanQuery === cleanRecord; // Simple exact match
}

// Validate that a game result matches distinctive words from the query title
export function validateGameMatch(queryTitle: string, resultTitle: string): boolean {
  const queryLower = queryTitle.toLowerCase();
  const resultLower = resultTitle.toLowerCase();

  // Extract distinctive words from query (numbers, remake, HD, etc.)
  const distinctiveWords = queryLower
    .split(/\s+/)
    .filter(w => {
      if (/^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return true;
      if (/remake|remaster|reimagined/i.test(w)) return true;
      if (/world|part|sequel/i.test(w)) return true;
      if (/^hd$|^4k$|definitive|edition|deluxe|ultimate|complete|collection/i.test(w)) return true;
      return false;
    })
    .map(w => w.replace(/[^a-z0-9]/g, ''));

  // If query has distinctive words, they MUST be in the result
  if (distinctiveWords.length > 0) {
    const allDistinctivePresent = distinctiveWords.every(dw => {
      if (dw.length > 0) {
        const wordPattern = new RegExp(`\\b${dw}\\b`, 'i');
        return wordPattern.test(resultLower);
      }
      return true;
    });
    return allDistinctivePresent;
  }

  // If no distinctive words, do basic matching
  return true;
}

// Example IGDB Fetch Function with Improved Filtering
export async function fetchFromIGDB(gameTitle: string): Promise<string | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();

    // Limit game title to 255 characters (IGDB API limit)
    const limitedTitle = gameTitle.length > 255 ? gameTitle.substring(0, 252) + '...' : gameTitle;

    // Escape special characters and quotes in the game title
    const sanitizedTitle = limitedTitle.replace(/"/g, '\\"');

    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      // Fetch comprehensive metadata: name, release date, platforms, developers, publishers, genres, rating
      // Increase limit to search through multiple results to find the correct match
      `search "${sanitizedTitle}";
       fields name,first_release_date,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,genres.name,rating,aggregated_rating;
       limit 10;`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (response.data && response.data.length > 0) {
      // First, try exact match
      let game = response.data.find((g: any) => cleanAndMatchTitle(gameTitle, g.name));

      // If exact match found, validate it has distinctive words
      if (game && !validateGameMatch(gameTitle, game.name)) {
        game = undefined; // Reject if distinctive words don't match
      }

      // If no exact match or exact match failed validation, try to find a match with distinctive words
      if (!game) {
        game = response.data.find((g: any) => {
          // Check if result contains the query title (or vice versa) and has distinctive words
          const gameNameLower = g.name.toLowerCase();
          const queryLower = gameTitle.toLowerCase();
          const hasBasicMatch = gameNameLower.includes(queryLower) || queryLower.includes(gameNameLower);
          return hasBasicMatch && validateGameMatch(gameTitle, g.name);
        });
      }

      // Check if game was found before accessing properties
      if (!game) {
        return null;
      }

      // Get comprehensive metadata: developers, publishers, platforms, release date, genres, rating
      const developers = game.involved_companies?.filter((ic: any) => ic.developer)
        .map((ic: any) => ic.company?.name).filter(Boolean).join(", ") || "unknown developers";
      const publishers = game.involved_companies?.filter((ic: any) => ic.publisher)
        .map((ic: any) => ic.company?.name).filter(Boolean).join(", ") || "unknown publishers";
      const platforms = game.platforms?.map((p: any) => p.name).filter(Boolean).join(", ") || "unknown platforms";
      const genres = game.genres?.map((g: any) => g.name).filter(Boolean).join(", ") || null;
      const rating = game.aggregated_rating ? Math.round(game.aggregated_rating) : (game.rating ? Math.round(game.rating) : null);
      const releaseDate = game.first_release_date
        ? new Date(game.first_release_date * 1000).toLocaleDateString()
        : "unknown release date";

      // Build comprehensive response with all available metadata
      let gameInfo = `${game.name} was released on ${releaseDate}. It was developed by ${developers} and published by ${publishers} for ${platforms}.`;

      if (genres) {
        gameInfo += ` Genres: ${genres}.`;
      }

      if (rating) {
        gameInfo += ` Rating: ${rating}/100.`;
      }

      return gameInfo;
    }
    return null;
  } catch (error) {
    console.error("Error fetching data from IGDB:", error);
    if (axios.isAxiosError(error)) {
      console.error("IGDB API Response:", (error as any).response?.data);
    }
    return null;
  }
}

// Fetch series data from IGDB
export async function fetchSeriesFromIGDB(seriesTitle: string): Promise<any[] | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();

    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      `fields name, release_dates.date, platforms.name; where series.name ~ "${seriesTitle}";`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`,
        }
      }
    );

    if (response.data && response.data.length > 0) {
      return response.data;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching series data from IGDB:", error);
    return null;
  }
}

// Fetch data from RAWG with enhanced matching logic
export async function fetchFromRAWG(gameTitle: string): Promise<string | null> {
  try {
    const sanitizedTitle = gameTitle.toLowerCase().trim();
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(sanitizedTitle)}&search_precise=true`;

    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      const game = response.data.results.find((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        return normalizedGameName === sanitizedTitle ||
               normalizedGameName.includes(sanitizedTitle);
      });

      if (game) {
        return `${game.name} (Released: ${game.released}, Genres: ${game.genres.map((g: any) => g.name).join(', ')}, ` +
               `Platforms: ${game.platforms.map((p: any) => p.platform.name).join(', ')}, ` +
               `URL: https://rawg.io/games/${game.slug})`;
      }
    }
    return null;
  } catch (error) {
    console.error("Error fetching data from RAWG:", error);
    return null;
  }
}

/**
 * Fetch version/release information for a game from IGDB and RAWG
 * Returns information about different platform releases, versions, and updates
 */
export async function fetchVersionInfo(gameTitle: string): Promise<string | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();
    const sanitizedTitle = gameTitle.replace(/"/g, '\\"');

    const response = await axios.post(
      'https://api.igdb.com/v4/games',
      `search "${sanitizedTitle}";
       fields name,summary,storyline,release_dates.date,release_dates.platform.name,release_dates.region,platforms.name,version_parent.name;
       limit 5;`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (response.data && response.data.length > 0) {
      const games = response.data.filter((g: any) => cleanAndMatchTitle(gameTitle, g.name));

      if (games.length === 0) {
        return null;
      }

      const mainGame = games[0];
      const versionInfo: string[] = [];

      if (mainGame.summary) {
        versionInfo.push(`Game Summary: ${mainGame.summary.substring(0, 300)}${mainGame.summary.length > 300 ? '...' : ''}`);
      }

      if (mainGame.release_dates && mainGame.release_dates.length > 0) {
        const platformReleases = new Map<string, string[]>();

        for (const release of mainGame.release_dates) {
          if (release.platform && release.date) {
            const platformName = release.platform.name || 'Unknown Platform';
            const releaseDate = new Date(release.date * 1000).toLocaleDateString();
            const region = release.region ? ` (${release.region})` : '';

            if (!platformReleases.has(platformName)) {
              platformReleases.set(platformName, []);
            }
            platformReleases.get(platformName)!.push(`${releaseDate}${region}`);
          }
        }

        if (platformReleases.size > 0) {
          versionInfo.push('Platform Releases:');
          for (const [platform, dates] of Array.from(platformReleases.entries())) {
            versionInfo.push(`- ${platform}: ${dates.join(', ')}`);
          }
        }
      }

      if (mainGame.version_parent) {
        versionInfo.push(`This is a version/DLC of: ${mainGame.version_parent.name}`);
      }

      if (games.length > 1) {
        versionInfo.push(`Found ${games.length} related entries for this game.`);
      }

      const rawgInfo = await fetchVersionInfoFromRAWG(gameTitle);
      if (rawgInfo) {
        versionInfo.push(rawgInfo);
      }

      if (mainGame.platforms && mainGame.platforms.length > 1) {
        const platformList = mainGame.platforms.map((p: any) => p.name).join(', ');
        versionInfo.push(`Note: This game is available on multiple platforms (${platformList}). Platform versions may differ in graphics, performance, controls, or features due to hardware capabilities.`);
      }

      return versionInfo.length > 0 ? versionInfo.join('\n') : null;
    }

    return null;
  } catch (error) {
    console.error("Error fetching version info from IGDB:", error);
    return null;
  }
}

/**
 * Fetch version information from RAWG API
 */
export async function fetchVersionInfoFromRAWG(gameTitle: string): Promise<string | null> {
  try {
    const sanitizedTitle = gameTitle.toLowerCase().trim();
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(sanitizedTitle)}`;

    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      const matches = response.data.results.filter((g: any) => {
        const normalizedGameName = g.name.toLowerCase().trim();
        return normalizedGameName === sanitizedTitle ||
               normalizedGameName.includes(sanitizedTitle) ||
               sanitizedTitle.includes(normalizedGameName);
      });

      if (matches.length > 1) {
        const versionList = matches.map((g: any) => {
          const platforms = g.platforms?.map((p: any) => p.platform.name).join(', ') || 'Unknown';
          const description = g.description_raw ? ` - ${g.description_raw.substring(0, 150)}...` : '';
          return `- ${g.name} (${platforms}, Released: ${g.released || 'TBA'})${description}`;
        }).join('\n');

        return `RAWG found multiple versions:\n${versionList}`;
      } else if (matches.length === 1) {
        const game = matches[0];
        const platforms = game.platforms?.map((p: any) => p.platform.name).join(', ') || 'Unknown';
        const description = game.description_raw ? `\nDescription: ${game.description_raw.substring(0, 200)}...` : '';
        return `RAWG: Available on ${platforms} (Released: ${game.released || 'TBA'})${description}`;
      }
    }

    return null;
  } catch (error) {
    console.error("Error fetching version info from RAWG:", error);
    return null;
  }
}

// Fetch series data from RAWG
export async function fetchSeriesFromRAWG(seriesTitle: string): Promise<any[] | null> {
  try {
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(seriesTitle)}`;
    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      return response.data.results;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching series data from RAWG:", error);
    return null;
  }
}

/**
 * Fetch game levels/items from IGDB using game ID
 * Note: IGDB doesn't have a direct "levels" endpoint, but we can search for game guides/walkthroughs
 * For now, we'll use the game's name and let the AI correlate with image context
 */
export async function fetchGameLevelsFromIGDB(gameTitle: string): Promise<string | null> {
  try {
    const accessToken = await getClientCredentialsAccessToken();

    // Limit game title to 255 characters (IGDB API limit)
    const limitedTitle = gameTitle.length > 255 ? gameTitle.substring(0, 252) + '...' : gameTitle;

    // Escape special characters and quotes in the game title
    const sanitizedTitle = limitedTitle.replace(/"/g, '\\"');

    const gameResponse = await axios.post(
      'https://api.igdb.com/v4/games',
      `search "${sanitizedTitle}";
       fields name,id,summary;
       limit 1;`,
      {
        headers: {
          'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (gameResponse.data && gameResponse.data.length > 0) {
      const game = gameResponse.data[0];
      return `Game: ${game.name}. ${game.summary ? `Summary: ${game.summary.substring(0, 200)}...` : ''}`;
    }

    return null;
  } catch (error) {
    console.error("Error fetching game levels from IGDB:", error);
    return null;
  }
}

/**
 * Fetch game information from RAWG including level/item data
 * RAWG has game details that can help identify levels
 */
export async function fetchGameDetailsFromRAWG(gameTitle: string): Promise<string | null> {
  try {
    const url = `https://api.rawg.io/api/games?key=${process.env.RAWG_API_KEY}&search=${encodeURIComponent(gameTitle)}&search_precise=true`;
    const response = await axios.get(url);

    if (response.data && response.data.results.length > 0) {
      const game = response.data.results[0];

      const detailUrl = `https://api.rawg.io/api/games/${game.id}?key=${process.env.RAWG_API_KEY}`;
      const detailResponse = await axios.get(detailUrl);
      const gameDetails = detailResponse.data;

      let info = `Game: ${gameDetails.name}`;
      if (gameDetails.description_raw) {
        info += `\nDescription: ${gameDetails.description_raw.substring(0, 500)}...`;
      }
      if (gameDetails.released) {
        info += `\nReleased: ${gameDetails.released}`;
      }
      if (gameDetails.platforms && gameDetails.platforms.length > 0) {
        info += `\nPlatforms: ${gameDetails.platforms.map((p: any) => p.platform.name).join(', ')}`;
      }
      if (gameDetails.genres && gameDetails.genres.length > 0) {
        info += `\nGenres: ${gameDetails.genres.map((g: any) => g.name).join(', ')}`;
      }
      if (gameDetails.tags && gameDetails.tags.length > 0) {
        const relevantTags = gameDetails.tags
          .filter((t: any) => t.language === 'eng')
          .slice(0, 5)
          .map((t: any) => t.name);
        if (relevantTags.length > 0) {
          info += `\nTags: ${relevantTags.join(', ')}`;
        }
      }

      return info;
    }

    return null;
  } catch (error) {
    console.error("Error fetching game details from RAWG:", error);
    return null;
  }
}
