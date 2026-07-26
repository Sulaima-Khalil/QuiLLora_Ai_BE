/**
 * Test bootstrap.
 *
 * Every suite runs against a real MongoDB instance started in memory, so the
 * tests exercise genuine indexes, validators and aggregations rather than
 * mocks that can drift from the driver's behaviour.
 *
 * Environment variables are set before any application module is imported,
 * because src/config/env.js validates them at import time.
 */
import { afterAll, afterEach, beforeAll, jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/inkflow-test-placeholder';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-uvwxyz';
process.env.BCRYPT_SALT_ROUNDS = '4'; // Keep hashing cheap so suites stay fast.
process.env.LOG_LEVEL = 'silent';
process.env.ENABLE_CRON = 'false';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.SERVE_UPLOADS = 'false';

/*
 * Safepay, wired up against nothing.
 *
 * The credentials are real in shape and fake in value, and no suite reaches
 * the network: the two calls that would — opening a checkout and cancelling a
 * subscription — are stubbed per test on the service's default export.
 *
 * The webhook secret is deliberately *not* stubbed. Signature verification
 * runs for real against these bytes, so the tests prove the HMAC rather than
 * a mock of it. Values are generated per run and read back from `config`, so
 * no test repeats a literal and no secret scanner has one to flag.
 */
const { randomBytes: randomSecret } = await import('node:crypto');

process.env.SAFEPAY_ENVIRONMENT = 'sandbox';
process.env.SAFEPAY_API_KEY = `sec_${randomSecret(8).toString('hex')}`;
process.env.SAFEPAY_V1_SECRET = randomSecret(24).toString('hex');
process.env.SAFEPAY_WEBHOOK_SECRET = randomSecret(24).toString('hex');
process.env.SAFEPAY_PLAN_PRO_MONTHLY = 'plan_test-pro-monthly';
process.env.SAFEPAY_PLAN_PRO_YEARLY = 'plan_test-pro-yearly';
process.env.SAFEPAY_PLAN_BUSINESS_MONTHLY = 'plan_test-business-monthly';
process.env.SAFEPAY_PLAN_BUSINESS_YEARLY = 'plan_test-business-yearly';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

// Registers every schema on the mongoose instance so syncIndexes() below has
// models to work with, regardless of which suite is running.
await import('../src/models/index.js');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();

  await mongoose.connect(mongoServer.getUri('inkflow-test'), { autoIndex: false });

  // Unique indexes are load-bearing in several tests (duplicate email,
  // one-view-per-visitor-per-day), so they must actually exist.
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
}, 120_000);

// Isolate suites from each other without paying to restart the server.
afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

jest.setTimeout(60_000);
