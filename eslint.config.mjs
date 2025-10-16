import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";


/** @type {import('eslint').Linter.Config[]} */
export default [
	// Global ignores
	{ignores: ["infrastructure/**", "scripts/**", "dist/**", "node_modules/**"]},

	// Main source files
	{
		files: ["src/**/*.{ts,js}"],
		ignores: ["src/__tests__/**", "**/*.test.ts", "src/mcp/**"],
		languageOptions: { globals: {...globals.browser, ...globals.node} },
	},
	pluginJs.configs.recommended,
	...tseslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ["src/**/*.{ts,js}"],
		ignores: ["src/__tests__/**", "**/*.test.ts", "src/mcp/**"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error"
		}
	},

	// Test files - separate tsconfig
	{
		files: ["src/__tests__/**/*.ts", "**/*.test.ts"],
		languageOptions: {
			globals: {...globals.node},
			parserOptions: {
				project: "./tsconfig.test.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			// Disable unsafe rules for test files due to Node.js test runner lacking proper types
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/require-await": "off"
		}
	},

	// MCP servers - separate tsconfig
	{
		files: ["src/mcp/**/*.ts"],
		languageOptions: {
			globals: {...globals.node},
			parserOptions: {
				project: "./tsconfig.mcp.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/require-await": "off"
		}
	},

	prettier, // Must be last to disable conflicting formatting rules
];
