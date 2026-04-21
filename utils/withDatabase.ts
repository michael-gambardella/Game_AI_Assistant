import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import connectToMongoDB from './mongodb';
import { connectToWingmanDB } from './databaseConnections';

// Stricter return type so this composes with withRequestSizeLimit
type AsyncApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

export function withDatabase(handler: NextApiHandler): AsyncApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      await connectToMongoDB();
    } catch (error) {
      console.error('[withDatabase] Connection failed:', error);
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
      return;
    }
    await handler(req, res);
  };
}

export function withWingmanDB(handler: NextApiHandler): AsyncApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      await connectToWingmanDB();
    } catch (error) {
      console.error('[withWingmanDB] Connection failed:', error);
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
      return;
    }
    await handler(req, res);
  };
}
