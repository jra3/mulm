/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    // eslint-disable-next-line no-useless-escape
    "^.+\.tsx?$": ["ts-jest",{}],
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/infrastructure/cdk.out/",
    "/scripts/",
    ".*\\.helper\\.(ts|js)$"
  ],
  setupFiles: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  }
};