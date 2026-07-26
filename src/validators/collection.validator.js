import { z } from 'zod';
import { idParam, objectId } from './common.validator.js';

/** Collection and bookmark schemas — mirrors collectionsStore.js. */

export const createCollectionSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Collection name is required').max(80),
    description: z.string().trim().max(300).optional(),
  }),
};

export const updateCollectionSchema = {
  params: idParam,
  body: z
    .object({
      name: z.string().trim().min(1, 'Collection name is required').max(80).optional(),
      description: z.string().trim().max(300).optional(),
    })
    .refine((data) => data.name !== undefined || data.description !== undefined, {
      message: 'Provide a name or description to update',
    }),
};

/** GET /collections?search= — optional narrowing for the global search bar. */
export const listCollectionsSchema = {
  query: z.object({
    search: z.string().trim().max(120).optional(),
  }),
};

export const collectionIdSchema = { params: idParam };

export const collectionArticleSchema = {
  params: z.object({ id: objectId('id'), articleId: objectId('articleId') }),
};

export const addArticleSchema = {
  params: idParam,
  body: z.object({ articleId: objectId('articleId') }),
};

export const toggleBookmarkSchema = {
  body: z.object({ articleId: objectId('articleId') }),
};

export const bookmarkParamSchema = {
  params: z.object({ articleId: objectId('articleId') }),
};

export default {
  createCollectionSchema,
  updateCollectionSchema,
  listCollectionsSchema,
  collectionIdSchema,
  collectionArticleSchema,
  addArticleSchema,
  toggleBookmarkSchema,
  bookmarkParamSchema,
};
