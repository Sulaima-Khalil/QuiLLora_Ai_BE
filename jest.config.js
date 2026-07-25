/**
 * Jest runs against native ESM (the package is `"type": "module"`), which is
 * why `npm test` passes `--experimental-vm-modules`. No Babel transform is
 * needed, so `transform` is disabled outright.
 */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // The in-memory MongoDB server can take a moment to start on first run.
  testTimeout: 60_000,
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js', '!src/database/seed.js'],
};
