import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';
import { normalizeProgress } from '../../utils/gameContext';
import { getSession } from '../../utils/session';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Identity comes from the auth cookie, never the request body - otherwise anyone could
  // modify another user's lists.
  const session = await getSession(req);
  if (!session?.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const { action, gameName, listType, notes } = req.body;

    if (!action || !['add', 'remove', 'move', 'setProgress'].includes(action)) {
      return res.status(400).json({ message: 'Valid action is required (add, remove, move, setProgress)' });
    }

    if (!gameName || typeof gameName !== 'string' || gameName.trim().length === 0) {
      return res.status(400).json({ message: 'Game name is required' });
    }


    const user = await User.findOne({ userId: session.userId });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize gameTracking if it doesn't exist
    if (!user.gameTracking) {
      user.gameTracking = {
        wishlist: [],
        currentlyPlaying: []
      };
    }

    const trimmedGameName = gameName.trim();
    const gameNotes = notes?.trim() || '';

    if (action === 'add') {
      // Support both single listType and array of listTypes
      let listTypes: string[] = [];
      if (Array.isArray(listType)) {
        listTypes = listType;
      } else if (listType) {
        listTypes = [listType];
      }

      // Validate listTypes
      if (listTypes.length === 0 || !listTypes.every(lt => ['wishlist', 'currentlyPlaying'].includes(lt))) {
        return res.status(400).json({ message: 'Valid listType(s) required (wishlist, currentlyPlaying)' });
      }

      // Remove duplicates
      listTypes = Array.from(new Set(listTypes));

      // Check if game already exists in any target list and add to lists where it doesn't exist
      const addedToLists: string[] = [];

      if (listTypes.includes('wishlist')) {
        const existingInWishlist = user.gameTracking.wishlist.find(
          (game: any) => game.gameName.toLowerCase() === trimmedGameName.toLowerCase()
        );
        if (!existingInWishlist) {
          user.gameTracking.wishlist.push({
            gameName: trimmedGameName,
            addedAt: new Date(),
            notes: gameNotes
          });
          addedToLists.push('wishlist');
        }
      }

      if (listTypes.includes('currentlyPlaying')) {
        const existingInPlaying = user.gameTracking.currentlyPlaying.find(
          (game: any) => game.gameName.toLowerCase() === trimmedGameName.toLowerCase()
        );
        if (!existingInPlaying) {
          user.gameTracking.currentlyPlaying.push({
            gameName: trimmedGameName,
            startedAt: new Date(),
            notes: gameNotes
          });
          addedToLists.push('currentlyPlaying');
        }
      }

      if (addedToLists.length === 0) {
        return res.status(400).json({ message: 'Game already exists in all selected lists' });
      }
    } else if (action === 'remove') {
      if (!listType || !['wishlist', 'currentlyPlaying'].includes(listType)) {
        return res.status(400).json({ message: 'Valid listType is required (wishlist, currentlyPlaying)' });
      }

      const targetList = user.gameTracking[listType];
      const gameIndex = targetList.findIndex(
        (game: any) => game.gameName.toLowerCase() === trimmedGameName.toLowerCase()
      );

      if (gameIndex === -1) {
        return res.status(404).json({ message: 'Game not found in this list' });
      }

      targetList.splice(gameIndex, 1);
    } else if (action === 'move') {
      // Move game from one list to another
      const { fromList, toList } = req.body;

      if (!fromList || !toList || 
          !['wishlist', 'currentlyPlaying'].includes(fromList) ||
          !['wishlist', 'currentlyPlaying'].includes(toList) ||
          fromList === toList) {
        return res.status(400).json({ message: 'Valid fromList and toList are required and must be different' });
      }

      const sourceList = user.gameTracking[fromList];
      const gameIndex = sourceList.findIndex(
        (game: any) => game.gameName.toLowerCase() === trimmedGameName.toLowerCase()
      );

      if (gameIndex === -1) {
        return res.status(404).json({ message: 'Game not found in source list' });
      }

      const game = sourceList[gameIndex];
      sourceList.splice(gameIndex, 1);

      // Add to target list with updated timestamp
      if (toList === 'wishlist') {
        user.gameTracking.wishlist.push({
          gameName: trimmedGameName,
          addedAt: new Date(),
          notes: gameNotes || game.notes
        });
      } else {
        user.gameTracking.currentlyPlaying.push({
          gameName: trimmedGameName,
          startedAt: new Date(),
          notes: gameNotes || game.notes
        });
      }
    } else if (action === 'setProgress') {
      // Spoiler-safe mode: record how far the user is in a currently-playing game.
      // An empty value clears it (turning spoiler-safe mode off for that game).
      const { progress } = req.body;

      if (progress !== undefined && progress !== null && typeof progress !== 'string') {
        return res.status(400).json({ message: 'Progress must be a string' });
      }

      const game = user.gameTracking.currentlyPlaying.find(
        (g: any) => g.gameName.toLowerCase() === trimmedGameName.toLowerCase()
      );

      if (!game) {
        return res.status(404).json({ message: 'Game not found in currently playing list' });
      }

      const normalizedProgress = normalizeProgress(progress);
      game.progress = normalizedProgress || undefined;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      gameTracking: user.gameTracking
    });
  } catch (error) {
    console.error('Error managing game tracking:', error);
    return res.status(500).json({
      message: 'Error managing game tracking',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withWingmanDB(handler);
