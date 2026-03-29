import { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const realm = process.env.STEAM_OPENID_REALM;
  const returnUrl = process.env.STEAM_OPENID_RETURN_URL;

  if (!realm || !returnUrl) {
    return res.status(500).json({ error: 'Steam OpenID environment variables are not configured.' });
  }

  const steamLoginUrl =
    'https://steamcommunity.com/openid/login' +
    `?openid.ns=${encodeURIComponent('http://specs.openid.net/auth/2.0')}` +
    `&openid.mode=checkid_setup` +
    `&openid.return_to=${encodeURIComponent(returnUrl)}` +
    `&openid.realm=${encodeURIComponent(realm)}` +
    `&openid.identity=${encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select')}` +
    `&openid.claimed_id=${encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select')}`;

  res.redirect(steamLoginUrl);
}
