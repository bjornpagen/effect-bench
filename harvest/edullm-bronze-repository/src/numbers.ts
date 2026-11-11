import { Schema } from "effect"

/** Exact counts and byte lengths admitted once; consumers never re-check the range. */
export const NonNegativeIntegerSchema = Schema.Number.check(
	Schema.makeFilter((value) => Number.isInteger(value) && value >= 0, {
		message: "Expected a non-negative integer."
	})
).pipe(Schema.brand("NonNegativeInteger"))
export type NonNegativeInteger = typeof NonNegativeIntegerSchema.Type
