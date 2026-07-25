import aiService from '../services/ai.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { AI_LENGTHS, SUGGESTED_CATEGORIES, TONES } from '../constants/index.js';

/** POST /ai/generate — drafts an article from the intake form. */
export const generate = asyncHandler(async (req, res) => {
  const article = await Promise.resolve(aiService.generateArticle(req.body));
  return sendSuccess(res, { message: 'Draft generated', data: { article } });
});

/** POST /ai/paragraph — the "Generate next paragraph" action. */
export const generateParagraph = asyncHandler(async (req, res) => {
  const paragraph = aiService.generateParagraph(req.body);
  return sendSuccess(res, { message: 'Paragraph generated', data: { paragraph } });
});

/** POST /ai/insights — editorial feedback for the Neural Sidebar. */
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

export default { generate, generateParagraph, insights, options };
