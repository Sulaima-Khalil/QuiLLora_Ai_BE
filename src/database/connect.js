import mongoose from 'mongoose';
import config from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Reject queries that reference fields absent from the schema instead of
 * silently ignoring them — turns typos into loud failures.
 */
mongoose.set('strictQuery', 'throw');

let connectionPromise = null;

// Distinguishes a deliberate close from a dropped socket, so shutdown does not
// log a reconnect warning for a connection nobody wants back.
let shuttingDown = false;

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

      // Recycle sockets before an idle proxy or Atlas silently drops them,
      // and notice a lost primary quickly rather than on the next query.
      maxIdleTimeMS: 60_000,
      heartbeatFrequencyMS: 10_000,
      socketTimeoutMS: 45_000,

      // Let the driver replay a single operation across a brief failover
      // instead of surfacing a transient network error to the caller.
      retryWrites: true,
      retryReads: true,

      // Queries issued while the connection is down fail fast with a clear
      // error rather than hanging for the 10s default buffer window.
      bufferTimeoutMS: 5_000,
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
  shuttingDown = true;

  if (mongoose.connection.readyState === 0) {
    shuttingDown = false;
    return;
  }

  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
  shuttingDown = false;
};

mongoose.connection.on('error', (error) => {
  logger.error(`MongoDB connection error: ${error.message}`);
});

/**
 * The driver reconnects on its own, so these listeners are for visibility and
 * for keeping `connectionPromise` honest.
 *
 * Dropping the cached promise matters: it resolved against a connection that
 * is now closed, so leaving it in place would make `connectDatabase()` hand
 * back a dead connection instead of dialling again.
 */
mongoose.connection.on('disconnected', () => {
  if (!shuttingDown) {
    connectionPromise = null;
    logger.warn('MongoDB disconnected — the driver will keep retrying');
  }
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

export default connectDatabase;
