import mongoose from 'mongoose';
import config from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Reject queries that reference fields absent from the schema instead of
 * silently ignoring them — turns typos into loud failures.
 */
mongoose.set('strictQuery', 'throw');

let connectionPromise = null;

/**
 * Connects to MongoDB, reusing the existing connection if one is already open.
 * Idempotent, so tests and the server can both call it safely.
 */
export const connectDatabase = async (uri = config.db.uri) => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 10,
      minPoolSize: 1,
      // Indexes are created explicitly by syncIndexes() rather than implicitly
      // on every model touch, which is a known production foot-gun.
      autoIndex: false,
    })
    .then((instance) => {
      logger.info(`MongoDB connected: ${instance.connection.host}/${instance.connection.name}`);
      return instance.connection;
    })
    .catch((error) => {
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
};

/** Builds every declared index. Called once at boot, after connecting. */
export const syncIndexes = async () => {
  const results = await Promise.allSettled(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const modelName = Object.keys(mongoose.models)[index];
      logger.warn(`Index sync failed for ${modelName}: ${result.reason?.message}`);
    }
  });
};

/** Closes the connection — used by graceful shutdown and test teardown. */
export const disconnectDatabase = async () => {
  connectionPromise = null;
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
};

mongoose.connection.on('error', (error) => {
  logger.error(`MongoDB connection error: ${error.message}`);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

export default connectDatabase;
