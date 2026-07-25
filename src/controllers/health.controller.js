import mongoose from 'mongoose';
import config from '../config/env.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/** Liveness probe — answers as long as the process is up. */
export const health = asyncHandler(async (_req, res) =>
  sendSuccess(res, {
    message: 'InkFlow AI API is running',
    data: {
      status: 'ok',
      environment: config.env,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  }),
);

/**
 * Readiness probe — reports 503 when the database is unreachable, so an
 * orchestrator stops routing traffic to an instance that cannot serve it.
 */
export const readiness = asyncHandler(async (_req, res) => {
  const state = READY_STATES[mongoose.connection.readyState] ?? 'unknown';
  const databaseReady = mongoose.connection.readyState === 1;

  return res.status(databaseReady ? 200 : 503).json({
    success: databaseReady,
    message: databaseReady ? 'Ready' : 'Database unavailable',
    data: { database: state, environment: config.env },
  });
});

export default { health, readiness };
