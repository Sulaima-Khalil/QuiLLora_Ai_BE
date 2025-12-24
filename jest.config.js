export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  moduleNameMapper: {
    '^multer$': '<rootDir>/__mocks__/multer.js'
  },
  clearMocks: true
}
