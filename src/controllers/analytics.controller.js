import analyticsService from '../services/analytics.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';

/** GET /analytics — everything pages/Analytics.jsx renders. */
export const getAnalytics = asyncHandler(async (req, res) => {
  const days = req.validatedQuery?.days ?? 7;
  const analytics = await analyticsService.getAnalytics(req.user._id, days);

  return sendSuccess(res, { message: 'Analytics', data: analytics });
});

/** GET /analytics/summary — the dashboard's stat cards. */
export const getSummary = asyncHandler(async (req, res) => {
  const summary = await analyticsService.getDashboardSummary(req.user._id);
  return sendSuccess(res, { message: 'Dashboard summary', data: { summary } });
});

export default { getAnalytics, getSummary };
