import type { NextApiRequest, NextApiResponse } from 'next';
import { withDatabase } from '../../utils/withDatabase';
import Forum from '../../models/Forum';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { forumTitle, usernameToAdd } = req.body;

    if (!forumTitle || !usernameToAdd) {
      return res.status(400).json({ error: 'forumTitle and usernameToAdd are required' });
    }

    // Find the forum by title
    const forum = await Forum.findOne({ title: forumTitle });
    
    if (!forum) {
      return res.status(404).json({ error: `Forum "${forumTitle}" not found` });
    }

    console.log(`Found forum: ${forum.title}`);
    console.log(`Current allowedUsers:`, forum.allowedUsers);

    // Check if user is already in allowedUsers
    if (forum.allowedUsers.includes(usernameToAdd)) {
      return res.status(200).json({ 
        message: `User ${usernameToAdd} is already in allowedUsers`,
        forum: forum
      });
    }

    // Add user to allowedUsers
    forum.allowedUsers.push(usernameToAdd);
    await forum.save();

    console.log(`Successfully added ${usernameToAdd} to allowedUsers`);
    console.log(`Updated allowedUsers:`, forum.allowedUsers);

    return res.status(200).json({ 
      message: `Successfully added ${usernameToAdd} to allowedUsers`,
      forum: forum
    });

  } catch (error) {
    console.error('Error adding user to private forum:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withDatabase(handler);
