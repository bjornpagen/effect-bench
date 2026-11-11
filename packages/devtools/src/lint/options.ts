import { Schema } from "effect"

/** Repository-relative paths: one ending in "/" names a directory and every file beneath it, any other one file. */
const Paths = Schema.Array(Schema.String)

const Names = Schema.Array(Schema.String)

/** Workspace packages by repository-relative directory, without a trailing "/". */
const PackageDirectories = Schema.Array(Schema.String)

/** A type a repository module exports (a type alias, an interface or a class): the module by its repository-relative
 * path, the type by its name. */
const DeclaredType = Schema.Struct({ module: Schema.String, type: Schema.String })

/**
 * The repository's names for the superlint rules that need them (owner paths, declared statements), from the
 * `superlint` field of the root package.json. Every field is required: a rule with nothing to admit states it with an
 * empty list.
 */
export const SuperlintOptions = Schema.Struct({
	/** The workspace packages that use no Effect, by repository-relative directory without a trailing "/": each runs
	 * the Effect-free lint rules, its tsconfig extends the dev tools' Effect-free base, and it depends on no `effect`. */
	effectFree: PackageDirectories,
	/** The repository's exceptions: files where a rule does not run, by its id. Exceptions live here, never inline. */
	exceptions: Schema.Array(Schema.Struct({ rule: Schema.String, files: Paths })),
	/** Where a closed vocabulary's member is spelled as a bare string: the test support read beside the test files,
	 * the types whose members form the vocabularies (a union of strings, or the `_tag` of a tagged error or a union of
	 * them), the registrars whose first argument is a title (`describe`, `it`), and the parameter names whose argument
	 * is prose (`message`). */
	uncheckedVocabularyLiteral: Schema.Struct({
		support: Paths,
		vocabularies: Schema.Array(DeclaredType),
		titled: Names,
		explanations: Names
	})
})

export type SuperlintOptions = typeof SuperlintOptions.Type

/** The options the fixtures run under: names that point into each rule's own fixture directory. */
export const FIXTURE_OPTIONS: SuperlintOptions = {
	effectFree: [],
	exceptions: [],
	uncheckedVocabularyLiteral: {
		support: ["unchecked-vocabulary-literal/"],
		vocabularies: [
			{ module: "unchecked-vocabulary-literal/vocabulary.ts", type: "FaultTag" },
			{ module: "unchecked-vocabulary-literal/vocabulary.ts", type: "TodoFailure" },
			{ module: "unchecked-vocabulary-literal/vocabulary.ts", type: "TodoNotFound" }
		],
		titled: ["describe", "it", "effect"],
		explanations: ["message", "why"]
	}
}
