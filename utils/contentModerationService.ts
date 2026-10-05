import axios from './axiosConfig';
import { ContentCheckResult } from '../types';

export const checkContent = async (content: string, userId: string): Promise<ContentCheckResult> => {
  try {
    // The server records any violation against the signed-in user (auth cookie), not a
    // client-supplied name; the shared axios instance refreshes an expired token
    const response = await axios.post('/api/checkContent', { content });

    return {
      isValid: true,
      ...response.data
    };
  } catch (error: any) {
    console.error('Error in checkContent:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      userId
    });
    
    if (error.response?.data) {
      return {
        isValid: false,
        ...error.response.data
      };
    }
    
    return {
      isValid: false,
      error: error.message || 'Failed to check content'
    };
  }
}; 