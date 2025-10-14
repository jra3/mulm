import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";


/** @type {import('eslint').Linter.Config[]} */
export default [
	{files: ["**/*.{js,mjs,cjs,ts}"]},
	{ignores: ["src/__tests__/**", "**/*.test.ts", "src/mcp/**", "infrastructure/**", "scripts/**", "dist/**", "node_modules/**"]},
	{languageOptions: { globals: {...globals.browser, ...globals.node} }},
	pluginJs.configs.recommended,
	...tseslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{rules: {
		"@typescript-eslint/no-explicit-any": "warn",
		"@typescript-eslint/no-floating-promises": "error",
		"@typescript-eslint/no-misused-promises": "error"
	}},
	prettier, // Must be last to disable conflicting formatting rules
];
