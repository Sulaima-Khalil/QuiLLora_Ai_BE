import aiService from '../services/ai.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { AI_LENGTHS, SUGGESTED_CATEGORIES, TONES } from '../constants/index.js';

/**
 * POST /ai/generate — drafts an article from the intake form.
 *
 * Counts against the plan's daily allowance. The service claims the slot
 * before composing and hands it back if composing fails.
 */
export const generate = asyncHandler(async (req, res) => {
  const article = await aiService.generateArticleFor(req.user._id, req.body);
  return sendSuccess(res, { message: 'Draft generated', data: { article } });
});

/** POST /ai/paragraph — the "Generate next paragraph" action. Also metered. */
export const generateParagraph = asyncHandler(async (req, res) => {
  const paragraph = await aiService.generateParagraphFor(req.user._id, req.body);
  return sendSuccess(res, { message: 'Paragraph generated', data: { paragraph } });
});

/**
 * POST /ai/insights — editorial feedback for the Neural Sidebar.
 *
 * Not metered: it measures text the author already wrote and returns no new
 * prose, so charging a generation for it would be charging for a read.
 */
export const insights = asyncHandler(async (req, res) => {
  const result = aiService.generateInsights(req.body);
  return sendSuccess(res, { message: 'Editorial insights', data: { insights: result } });
});

/** GET /ai/options — the tone/length/category choices the UI offers. */
export const options = asyncHandler(async (_req, res) =>
  sendSuccess(res, {
    message: 'Generation options',
    data: { tones: TONES, lengths: AI_LENGTHS, categories: SUGGESTED_CATEGORIES },
  }),
);

export const assistant = asyncHandler(async (req, res) => {
  const text = await aiService.generateAssistantResponse(req.user._id, req.body);
  return res.status(200).json({ text });
});

export default { generate, generateParagraph, insights, options, assistant };
