import { active, lintConfig } from "@effect-bench/devtools/preset"
import { CLOCK_RULES, TEST_RULES } from "@effect-bench/testing/oxlint"
import { defineConfig } from "oxlint"
import manifest from "#package.json" with { type: "json" }

/** effect-bench's lists for the lint standard; everything else comes from the dev tools' preset. */
export default defineConfig(
	lintConfig({
		ignorePatterns: ["packages/devtools/src/*/fixtures/**"],
		restrictedImports: {
			paths: [
				{
					name: "zod",
					message:
						'Zod is banned. Admit outside values with Effect Schema (`import { Schema } from "effect"`), where a Schema shares its type\'s name.'
				}
			],
			patterns: []
		},
		restrictedGlobals: [],
		restrictedProperties: [],
		unassignedImports: [],
		effectFree: manifest.superlint.effectFree,
		ceremony: ["packages/devtools/**", "**/*.test.ts", "**/scripts/**"],
		plugin: {
			"brands-sole-mint": {
				mints: [
					{ doors: ["packages/testing/src/random.ts"], brands: ["LabelStream", "RunStream"] },
					{ doors: ["packages/testing/src/vitest/mutated-file.ts"], brands: ["RealPath"] }
				]
			},
			"import-doors": { doors: [] },
			"no-dynamic-imports": { allowed: [] }
		},
		tests: {
			jsPlugin: "@effect-bench/testing/oxlint",
			rules: TEST_RULES,
			clock: { files: ["packages/testing/src/**"], rules: CLOCK_RULES }
		},
		overrides: [
			{
				files: ["packages/testing/src/live.ts"],
				rules: active({
					/** The live clock a case's hang guard and a fuzz run's time budget read: its job is the clock. */
					"testing/no-wall-clock-verdict": "off"
				})
			},
			{
				files: ["packages/testing/src/witness.fixtures.ts"],
				rules: active({
					/** A type test's refusal is a `@ts-expect-error` that names what it refuses. */
					"typescript/ban-ts-comment": [
						"error",
						{
							"ts-check": true,
							"ts-expect-error": "allow-with-description",
							"ts-ignore": true,
							"ts-nocheck": true
						}
					]
				})
			}
		]
	})
)
