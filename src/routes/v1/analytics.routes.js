import { Router } from 'express';
import analyticsController from '../../controllers/analytics.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { analyticsQuerySchema } from '../../validators/analytics.validator.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(analyticsQuerySchema), analyticsController.getAnalytics);
router.get('/summary', analyticsController.getSummary);

export default router;
