import { NextApiRequest, NextApiResponse } from 'next';
import { withWingmanDB } from '../../../utils/withDatabase';
import { getSession } from '../../../utils/session';
import { logger } from '../../../utils/logger';
import { getPerformanceMonitor } from '../../../utils/twitch/performanceMonitor';
import TwitchBotChannel from '../../../models/TwitchBotChannel';

/**
 * Performance Monitoring API for Twitch Bot
 * Provides performance metrics, alerts, and reports
 * 
 * Endpoints:
 * - GET /api/twitchBot/performance?type=report&channelName=xxx&days=7
 * - GET /api/twitchBot/performance?type=alerts&channelName=xxx&severity=warning&unacknowledged=true
 * - GET /api/twitchBot/performance?type=metrics&channelName=xxx&metricType=response_time
 * - GET /api/twitchBot/performance?type=thresholds
 * - POST /api/twitchBot/performance?type=acknowledge (body: { alertId: "xxx" } or { acknowledgeAll: true, channelName: "xxx" })
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check authentication
  const session = await getSession(req);
  if (!session || !session.username) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'You must be logged in to view performance data'
    });
  }

  const username = session.username;

  // Allow GET for most endpoints, POST for acknowledge
  const { type } = req.query;
  
  if (type === 'acknowledge') {
    // Acknowledge endpoint uses POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Use POST for acknowledge.' });
    }
  } else {
    // All other endpoints use GET
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  }

  try {
    switch (type) {
      case 'report':
        return await handlePerformanceReport(req, res, username);
      
      case 'alerts':
        return await handlePerformanceAlerts(req, res, username);
      
      case 'metrics':
        return await handlePerformanceMetrics(req, res, username);
      
      case 'thresholds':
        return await handleGetThresholds(req, res);
      
      case 'acknowledge':
        return await handleAcknowledgeAlert(req, res, username);
      
      default:
        return res.status(400).json({
          error: 'Invalid endpoint type',
          message: 'Type must be one of: report, alerts, metrics, thresholds, acknowledge',
          availableTypes: ['report', 'alerts', 'metrics', 'thresholds', 'acknowledge']
        });
    }
  } catch (error) {
    logger.error('Error in performance API', {
      error: error instanceof Error ? error.message : String(error),
      type,
      username
    });
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Verify channel ownership
 */
async function verifyChannelOwnership(
  channelName: string,
  username: string
): Promise<boolean> {
  try {
    const channel = await TwitchBotChannel.findOne({
      channelName: channelName.toLowerCase().trim(),
      ownerUsername: username
    });
    return !!channel;
  } catch (error) {
    logger.error('Error verifying channel ownership', {
      error: error instanceof Error ? error.message : String(error),
      channelName,
      username
    });
    return false;
  }
}

/**
 * GET /api/twitchBot/performance?type=report
 * Returns performance report for a channel
 */
async function handlePerformanceReport(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName, days } = req.query;

  if (!channelName || typeof channelName !== 'string') {
    return res.status(400).json({
      error: 'Missing required parameter',
      message: 'channelName query parameter is required'
    });
  }

  // Verify channel ownership
  const hasAccess = await verifyChannelOwnership(channelName, username);
  if (!hasAccess) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You do not have access to this channel\'s performance data'
    });
  }

  const daysNum = days ? parseInt(days as string, 10) : 7;

  if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
    return res.status(400).json({
      error: 'Invalid days parameter',
      message: 'Days must be a number between 1 and 365'
    });
  }

  try {
    const performanceMonitor = getPerformanceMonitor();
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    
    // Use database-based report for historical data
    const report = await performanceMonitor.generateReport(
      channelName,
      startDate,
      endDate
    );

    return res.status(200).json({
      success: true,
      channelName,
      days: daysNum,
      startDate: report.startDate,
      endDate: report.endDate,
      report
    });
  } catch (error) {
    logger.error('Error generating performance report', {
      error: error instanceof Error ? error.message : 'Unknown error',
      channelName,
      username
    });
    throw error;
  }
}

/**
 * GET /api/twitchBot/performance?type=alerts
 * Returns performance alerts
 */
async function handlePerformanceAlerts(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName, severity, limit, unacknowledged } = req.query;

  // If channelName is provided, verify ownership
  if (channelName && typeof channelName === 'string') {
    const hasAccess = await verifyChannelOwnership(channelName, username);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this channel\'s performance data'
      });
    }
  }

  const limitNum = limit ? parseInt(limit as string, 10) : 50;
  const severityFilter = severity as 'warning' | 'critical' | undefined;
  const onlyUnacknowledged = unacknowledged === 'true';

  try {
    const performanceMonitor = getPerformanceMonitor();
    
    // Get alerts based on unacknowledged filter
    let alerts;
    if (onlyUnacknowledged) {
      alerts = performanceMonitor.getUnacknowledgedAlerts(channelName as string | undefined);
    } else {
      alerts = performanceMonitor.getRecentAlerts(limitNum * 2, channelName as string | undefined);
    }
    
    // Filter by severity if provided
    if (severityFilter) {
      alerts = alerts.filter(a => a.severity === severityFilter);
    }
    
    // Limit results
    alerts = alerts.slice(0, limitNum);

    return res.status(200).json({
      success: true,
      channelName: channelName || 'all',
      filters: {
        severity: severityFilter,
        unacknowledged: onlyUnacknowledged,
        limit: limitNum
      },
      count: alerts.length,
      alerts
    });
  } catch (error) {
    logger.error('Error getting performance alerts', {
      error: error instanceof Error ? error.message : 'Unknown error',
      channelName,
      username
    });
    throw error;
  }
}

/**
 * GET /api/twitchBot/performance?type=metrics
 * Returns recent performance metrics
 */
async function handlePerformanceMetrics(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  const { channelName, metricType, limit } = req.query;

  // If channelName is provided, verify ownership
  if (channelName && typeof channelName === 'string') {
    const hasAccess = await verifyChannelOwnership(channelName, username);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this channel\'s performance data'
      });
    }
  }

  const limitNum = limit ? parseInt(limit as string, 10) : 100;
  const typeFilter = metricType as 'response_time' | 'ai_response_time' | 'db_query_time' | 'api_call_time' | 'error_rate' | 'cache_hit_rate' | undefined;

  try {
    const performanceMonitor = getPerformanceMonitor();
    let metrics = performanceMonitor.getRecentMetrics(limitNum * 2, channelName as string | undefined);

    // Filter by metric type if provided
    if (typeFilter) {
      metrics = metrics.filter(m => m.metricType === typeFilter);
    }
    
    // Limit results
    metrics = metrics.slice(0, limitNum);

    return res.status(200).json({
      success: true,
      channelName: channelName || 'all',
      metricType: typeFilter || 'all',
      limit: limitNum,
      count: metrics.length,
      metrics: metrics
    });
  } catch (error) {
    logger.error('Error getting performance metrics', {
      error: error instanceof Error ? error.message : 'Unknown error',
      channelName,
      username
    });
    throw error;
  }
}

/**
 * GET /api/twitchBot/performance?type=thresholds
 * Returns current performance thresholds
 */
async function handleGetThresholds(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const performanceMonitor = getPerformanceMonitor();
    const thresholds = performanceMonitor.getThresholds();

    return res.status(200).json({
      success: true,
      thresholds
    });
  } catch (error) {
    logger.error('Error getting thresholds', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * POST /api/twitchBot/performance?type=acknowledge
 * Acknowledge one or all alerts
 */
async function handleAcknowledgeAlert(
  req: NextApiRequest,
  res: NextApiResponse,
  username: string
) {
  // Only allow POST requests for acknowledge
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST for acknowledge.' });
  }

  const { alertId, channelName, acknowledgeAll } = req.body;

  // If channelName is provided, verify ownership
  if (channelName && typeof channelName === 'string') {
    const hasAccess = await verifyChannelOwnership(channelName, username);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this channel\'s performance data'
      });
    }
  }

  try {
    const performanceMonitor = getPerformanceMonitor();
    
    if (acknowledgeAll) {
      // Acknowledge all alerts for the channel (or all channels if no channelName)
      const count = performanceMonitor.acknowledgeAllAlerts(channelName as string | undefined);
      return res.status(200).json({
        success: true,
        message: `Acknowledged ${count} alert(s)`,
        acknowledgedCount: count,
        channelName: channelName || 'all'
      });
    } else if (alertId && typeof alertId === 'string') {
      // Acknowledge a specific alert
      const success = performanceMonitor.acknowledgeAlert(alertId);
      if (success) {
        return res.status(200).json({
          success: true,
          message: 'Alert acknowledged successfully',
          alertId
        });
      } else {
        return res.status(404).json({
          error: 'Alert not found',
          message: 'The specified alert ID was not found or is already acknowledged',
          alertId
        });
      }
    } else {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'Either alertId or acknowledgeAll=true must be provided'
      });
    }
  } catch (error) {
    logger.error('Error acknowledging alert', {
      error: error instanceof Error ? error.message : 'Unknown error',
      alertId,
      channelName,
      username
    });
    throw error;
  }
}

export default withWingmanDB(handler);
