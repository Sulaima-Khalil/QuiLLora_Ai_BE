import { Router } from 'express';
import config from '../config/env.js';
import v1Routes from './v1/index.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { aiLimiter } from '../middlewares/rateLimit.middleware.js';
import { assistantSchema } from '../validators/ai.validator.js';
import aiController from '../controllers/ai.controller.js';

const router = Router();
const assistantRouter = Router();

assistantRouter.use(authenticate);
assistantRouter.post('/generate', aiLimiter, validate(assistantSchema), aiController.assistant);

/** Service index — lists the mounted API versions. */
router.get('/', (_req, res) =>
  sendSuccess(res, {
    message: 'InkFlow AI API',
    data: {
      name: 'InkFlow AI API',
      versions: ['v1'],
      current: config.apiPrefix,
      docs: '/docs/API.md',
    },
  }),
);

router.use('/v1', v1Routes);
router.use('/ai', assistantRouter);

export default router;
