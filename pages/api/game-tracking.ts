import type { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../utils/withDatabase';
import User from '../../models/User';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username, action, gameName, listType, notes } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    if (!action || !['add', 'remove', 'move'].includes(action)) {
      return res.status(400).json({ message: 'Valid action is required (add, remove, move)' });
    }

    if (!gameName || typeof gameName !== 'string' || gameName.trim().length === 0) {
      return res.status(400).json({ message: 'Game name is required' });
    }


    const user = await User.findOne({ username });

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
