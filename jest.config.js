/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    testEnvironment: "node",
    testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
    moduleFileExtensions: ["ts", "tsx", "js", "json", "jsx"],
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
    },
};
