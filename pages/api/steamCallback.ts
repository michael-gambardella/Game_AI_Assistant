import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { logger } from '../../utils/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  logger.info('Steam OpenID callback received');

  // Parse the raw query string directly so dots in param names (openid.mode etc.) are preserved
  const rawQuery = req.url?.split('?')[1] || '';
  const urlParams = new URLSearchParams(rawQuery);

  const mode = urlParams.get('openid.mode');

  // Steam sends 'cancel' if the user rejected the login
  if (mode === 'cancel') {
    logger.info('Steam login cancelled by user');
    return res.redirect('/?steamError=cancelled');
  }

  if (mode !== 'id_res') {
    logger.error('Unexpected openid.mode from Steam', { mode });
    return res.redirect('/?steamError=true');
  }

  // Build verification params — identical to what Steam sent, except mode changes
  const verifyParams = new URLSearchParams();
  urlParams.forEach((value, key) => {
    verifyParams.set(key, key === 'openid.mode' ? 'check_authentication' : value);
  });

  try {
    // POST params back to Steam to confirm the login is genuine
    const verifyResponse = await axios.post(
      'https://steamcommunity.com/openid/login',
      verifyParams.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (!verifyResponse.data.includes('is_valid:true')) {
      logger.error('Steam OpenID verification failed — is_valid was not true');
      return res.redirect('/?steamError=true');
    }

    // Extract the Steam ID from the claimed_id URL
    // Format: https://steamcommunity.com/openid/id/76561198XXXXXXXXX
    const claimedId = urlParams.get('openid.claimed_id') || '';
    const steamIdMatch = claimedId.match(/https:\/\/steamcommunity\.com\/openid\/id\/(\d+)/);

    if (!steamIdMatch) {
      logger.error('Could not extract Steam ID from claimed_id', { claimedId });
      return res.redirect('/?steamError=true');
    }

    const steamId = steamIdMatch[1];
    logger.info('Steam login verified', { steamId });

    // Redirect back to the app — the frontend will call /api/linkSteamId
    // to persist the Steam ID using its active authenticated session
    res.redirect(`/?steamLinked=true&steamId=${steamId}`);
  } catch (error) {
    logger.error('Error during Steam OpenID verification', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
