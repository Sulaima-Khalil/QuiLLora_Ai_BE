import { Router } from 'express';
import articleController from '../../controllers/article.controller.js';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { uploadArticleCover } from '../../middlewares/upload.middleware.js';
import {
  addNoteSchema,
  articleIdSchema,
  changeStatusSchema,
  createArticleSchema,
  listArticlesSchema,
  listPublicArticlesSchema,
  noteIdSchema,
  recordViewSchema,
  updateArticleSchema,
} from '../../validators/article.validator.js';

const router = Router();

/* ---------------------------------------------------------------------------
 * Public / optionally authenticated
 *
 * Declared before `/:id` so the literal paths are not captured as ids.
 * ------------------------------------------------------------------------ */

router.get(
  '/discover',
  optionalAuthenticate,
  validate(listPublicArticlesSchema),
  articleController.listPublicArticles,
);

router.get('/categories', articleController.listCategories);

/* ---------------------------------------------------------------------------
 * Authenticated — the author's own workspace
 * ------------------------------------------------------------------------ */

router.get('/', authenticate, validate(listArticlesSchema), articleController.listMyArticles);

router.post(
  '/',
  authenticate,
  // multer runs first: it populates req.body for multipart submissions.
  uploadArticleCover.single('coverImage'),
  validate(createArticleSchema),
  articleController.createArticle,
);

/* ---------------------------------------------------------------------------
 * Single article
 * ------------------------------------------------------------------------ */

router.get('/:id', optionalAuthenticate, validate(articleIdSchema), articleController.getArticle);

router.post('/:id/view', optionalAuthenticate, validate(recordViewSchema), articleController.recordView);

router.put(
  '/:id',
  authenticate,
  uploadArticleCover.single('coverImage'),
  validate(updateArticleSchema),
  articleController.updateArticle,
);

router.patch(
  '/:id',
  authenticate,
  uploadArticleCover.single('coverImage'),
  validate(updateArticleSchema),
  articleController.updateArticle,
);

router.patch('/:id/status', authenticate, validate(changeStatusSchema), articleController.changeStatus);
router.patch('/:id/archive', authenticate, validate(articleIdSchema), articleController.archiveArticle);
router.patch('/:id/restore', authenticate, validate(articleIdSchema), articleController.restoreArticle);

router.delete('/:id', authenticate, validate(articleIdSchema), articleController.deleteArticle);

router.post('/:id/notes', authenticate, validate(addNoteSchema), articleController.addNote);
router.delete('/:id/notes/:noteId', authenticate, validate(noteIdSchema), articleController.deleteNote);

export default router;
