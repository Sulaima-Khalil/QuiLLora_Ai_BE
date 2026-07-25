import { z } from 'zod';
import { ARTICLE_STATUSES, ARTICLE_VISIBILITIES } from '../constants/index.js';
import { booleanish, idParam, objectId, paginationQuery, stringArray } from './common.validator.js';

/** Article request schemas — field names match pages/Write.jsx. */

const statusEnum = z.enum(ARTICLE_STATUSES);
const visibilityEnum = z.enum(ARTICLE_VISIBILITIES);

const articleBodyFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  content: z.string().max(1_000_000, 'Article content is too large').optional(),
  excerpt: z.string().trim().max(400).optional(),
  category: z.string().trim().max(60).optional(),
  tags: stringArray({ max: 20, itemMax: 40 }).optional(),
  status: statusEnum.optional(),
  visibility: visibilityEnum.optional(),
  allowComments: booleanish.optional(),
  coverImage: z.string().trim().max(500).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(320).optional(),
  generatedByAI: booleanish.optional(),
  notes: z.array(z.string().trim().max(1000)).max(50).optional(),
};

export const createArticleSchema = {
  body: z.object(articleBodyFields),
};

export const updateArticleSchema = {
  params: idParam,
  // Every field optional so the editor can PATCH just what changed.
  body: z.object({ ...articleBodyFields, title: articleBodyFields.title.optional() }),
};

export const listArticlesSchema = {
  query: paginationQuery.extend({
    status: z.union([statusEnum, z.array(statusEnum)]).optional(),
    category: z.string().trim().max(60).optional(),
    tag: z.string().trim().max(40).optional(),
    includeArchived: booleanish.optional(),
  }),
};

export const listPublicArticlesSchema = {
  query: paginationQuery.extend({
    category: z.string().trim().max(60).optional(),
    tag: z.string().trim().max(40).optional(),
    author: objectId('author').optional(),
  }),
};

export const articleIdSchema = { params: idParam };

export const changeStatusSchema = {
  params: idParam,
  body: z.object({ status: statusEnum }),
};

export const recordViewSchema = {
  params: idParam,
  body: z
    .object({
      referrer: z.string().trim().max(500).optional(),
      durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
    })
    .optional()
    .default({}),
};

export const addNoteSchema = {
  params: idParam,
  body: z.object({ text: z.string().trim().min(1, 'Note text is required').max(1000) }),
};

export const noteIdSchema = {
  params: z.object({ id: objectId('id'), noteId: objectId('noteId') }),
};

export default {
  createArticleSchema,
  updateArticleSchema,
  listArticlesSchema,
  listPublicArticlesSchema,
  articleIdSchema,
  changeStatusSchema,
  recordViewSchema,
  addNoteSchema,
  noteIdSchema,
};
