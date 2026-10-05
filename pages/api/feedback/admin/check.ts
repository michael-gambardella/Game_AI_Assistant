import type { NextApiRequest, NextApiResponse } from 'next';
import { validateAdminAccess } from '../../../../utils/adminAccess';
import { getAuthenticatedUser } from '../../../../middleware/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Whether the *signed-in* user is the admin (a username in the request proves nothing).
    // Not signed in -> simply not admin.
    const user = await getAuthenticatedUser(req);
    const accessCheck = validateAdminAccess(user?.username);
    
    if (accessCheck.hasAccess) {
      return res.status(200).json({
        success: true,
        isAdmin: true,
        message: 'Admin access confirmed'
      });
    } else {
      return res.status(200).json({
        success: true,
        isAdmin: false,
        message: 'Regular user access'
      });
    }

  } catch (error: any) {
    console.error('Error checking admin access:', error);
    return res.status(200).json({
      success: true,
      isAdmin: false,
      message: 'Regular user access'
    });
  }
}
