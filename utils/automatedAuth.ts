import User from '../models/User';
import { connectToWingmanDB } from './databaseConnections';
import { generateAccessToken } from './jwt';
import { AUTOMATED_USERNAMES } from './reservedUsernames';

/**
 * Server-side sign-in for the automated forum accounts.
 *
 * The automated users run inside the server (utils/automatedUsersService) and call our own
 * API over HTTP, where routes identify the caller from a session - they have no browser
 * cookies. This issues a short-lived access token (the same kind a normal sign-in creates)
 * so those calls authenticate as the automated account itself:
 *
 *   headers: { ...(await getAutomatedUserAuthHeaders(username)) }
 *
 * Only genuine automated accounts qualify, so this can never sign in as a real user:
 * the three named accounts with their @wingman.internal email, or "gamer" accounts with a
 * gamerProfile (which regular signup never sets). It is not reachable from any HTTP route.
 */
export async function getAutomatedUserAuthHeaders(username: string): Promise<{ Authorization: string }> {
  await connectToWingmanDB();
  const user = await User.findOne({ username })
    .select('userId username email gamerProfile.type')
    .lean() as { userId: string; username: string; email?: string; gamerProfile?: { type?: string } } | null;

  const isNamedAutomated = !!user && AUTOMATED_USERNAMES.includes(user.username) &&
    !!user.email?.endsWith('@wingman.internal');
  const isGamer = !!user?.gamerProfile?.type;

  if (!user || !user.userId || !(isNamedAutomated || isGamer)) {
    throw new Error(`Refusing server-side sign-in: "${username}" is not an automated account`);
  }

  const token = generateAccessToken({ userId: user.userId, username: user.username, email: user.email });
  return { Authorization: `Bearer ${token}` };
}
