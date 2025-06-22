const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.jsx"],
    moduleFileExtensions: ["ts", "js", "json", "jsx", "tsx"],
    globals: {
        "ts-jest": {
            tsconfig: "tsconfig.json",
        },
    },
    transform: {
        "^.+\\.tsx?$": "ts-jest",
    },
};
