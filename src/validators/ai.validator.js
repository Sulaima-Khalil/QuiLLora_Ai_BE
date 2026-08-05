import { z } from 'zod';
import { AI_LENGTHS, TONES } from '../constants/index.js';

const assistantActions = ['generateIdeas', 'writeParagraph', 'improveWriting', 'summarize', 'customPrompt'];

/** AI Writer schemas — fields match the intake form in pages/AIWriter.jsx. */

export const generateArticleSchema = {
  body: z.object({
    // The frontend enables "Generate" only past two characters; enforced here too.
    topic: z.string().trim().min(3, 'Describe your topic in at least 3 characters').max(200),
    tone: z.enum(TONES).optional(),
    length: z.enum(AI_LENGTHS).optional(),
    category: z.string().trim().max(60).optional(),
    // Bumped by the client to request a different draft for the same prompt.
    variation: z.coerce.number().int().min(0).max(1000).optional(),
  }),
};

export const generateParagraphSchema = {
  body: z.object({
    topic: z.string().trim().max(200).optional(),
    variation: z.coerce.number().int().min(0).max(1000).optional(),
  }),
};

export const insightsSchema = {
  body: z.object({
    content: z.string().max(1_000_000).optional(),
    topic: z.string().trim().max(200).optional(),
    tone: z.enum(TONES).optional(),
    length: z.enum(AI_LENGTHS).optional(),
    category: z.string().trim().max(60).optional(),
  }),
};

export const assistantSchema = {
  body: z.object({
    action: z.enum(assistantActions, { errorMap: () => ({ message: 'Unsupported AI action' }) }),
    prompt: z.string().trim().min(1, 'Prompt is required').max(4000),
    selectedText: z.string().max(20_000).optional().default(''),
    documentTitle: z.string().trim().max(200).optional().default('Untitled document'),
    documentContent: z.string().max(80_000).optional().default(''),
  }),
};

export default { generateArticleSchema, generateParagraphSchema, insightsSchema, assistantSchema };
