import { Router } from 'express';
import healthController from '../../controllers/health.controller.js';
import authRoutes from './auth.routes.js';
import oauthRoutes from './oauth.routes.js';
import articleRoutes from './article.routes.js';
import collectionRoutes from './collection.routes.js';
import teamRoutes from './team.routes.js';
import userRoutes from './user.routes.js';
import analyticsRoutes from './analytics.routes.js';
import aiRoutes from './ai.routes.js';

/** Version 1 of the API. Mounted by the app at `config.apiPrefix`. */
const router = Router();

router.get('/health', healthController.health);
router.get('/ready', healthController.readiness);

router.use('/auth', authRoutes);
router.use('/oauth', oauthRoutes);
router.use('/articles', articleRoutes);
router.use('/collections', collectionRoutes);
router.use('/team', teamRoutes);
router.use('/users', userRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/ai', aiRoutes);

export default router;
