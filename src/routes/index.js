import { Router } from 'express';
import config from '../config/env.js';
import v1Routes from './v1/index.js';
import { sendSuccess } from '../utils/ApiResponse.js';

const router = Router();

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

export default router;
