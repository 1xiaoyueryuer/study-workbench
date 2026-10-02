import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      ".artifacts/**",
      "docs/design/material-preview/**",
      "release/**",
      "node_modules/**",
      ".cache/**",
      "evidence/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["scripts/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        window: "readonly",
        document: "readonly",
        crypto: "readonly",
        innerWidth: "readonly",
        innerHeight: "readonly",
        devicePixelRatio: "readonly",
        performance: "readonly",
      },
    },
  },
  ...ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
