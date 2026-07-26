import { Router } from 'express';
import collectionController from '../../controllers/collection.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addArticleSchema,
  bookmarkParamSchema,
  collectionArticleSchema,
  collectionIdSchema,
  createCollectionSchema,
  listCollectionsSchema,
  toggleBookmarkSchema,
  updateCollectionSchema,
} from '../../validators/collection.validator.js';

const router = Router();

// Everything here is private to the signed-in user.
router.use(authenticate);

/* ---------------------------------------------------------------------------
 * Bookmarks
 * ------------------------------------------------------------------------ */

router.get('/state', collectionController.getState);
router.get('/bookmarks', collectionController.listBookmarks);
router.post('/bookmarks', validate(toggleBookmarkSchema), collectionController.toggleBookmark);
router.post('/bookmarks/:articleId', validate(bookmarkParamSchema), collectionController.toggleBookmark);

/* ---------------------------------------------------------------------------
 * Named collections
 * ------------------------------------------------------------------------ */

router.get('/', validate(listCollectionsSchema), collectionController.listCollections);
router.post('/', validate(createCollectionSchema), collectionController.createCollection);

router.get('/:id', validate(collectionIdSchema), collectionController.getCollection);
router.patch('/:id', validate(updateCollectionSchema), collectionController.updateCollection);
router.put('/:id', validate(updateCollectionSchema), collectionController.updateCollection);
router.delete('/:id', validate(collectionIdSchema), collectionController.deleteCollection);

router.post('/:id/articles', validate(addArticleSchema), collectionController.addArticle);
router.delete('/:id/articles/:articleId', validate(collectionArticleSchema), collectionController.removeArticle);

export default router;
