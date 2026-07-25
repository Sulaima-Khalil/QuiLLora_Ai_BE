import { Router } from 'express';
import aiController from '../../controllers/ai.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { aiLimiter } from '../../middlewares/rateLimit.middleware.js';
import {
  generateArticleSchema,
  generateParagraphSchema,
  insightsSchema,
} from '../../validators/ai.validator.js';

const router = Router();

router.use(authenticate);

router.get('/options', aiController.options);

// Generation is the expensive path, so it carries its own per-user limiter.
router.post('/generate', aiLimiter, validate(generateArticleSchema), aiController.generate);
router.post('/paragraph', aiLimiter, validate(generateParagraphSchema), aiController.generateParagraph);
router.post('/insights', validate(insightsSchema), aiController.insights);

export default router;
