import { Schema } from "effect"

export const CopyKindSchema = Schema.Literals(["timeback", "caliper"])
export type CopyKind = typeof CopyKindSchema.Type

export const CoordinateSchema = Schema.Number.check(
	Schema.makeFilter(Number.isSafeInteger, { message: "Expected a safe integer coordinate." })
)

export const IntervalSchema = Schema.Struct({
	lo: CoordinateSchema,
	hi: CoordinateSchema
})
	.check(
		Schema.makeFilter(({ lo, hi }) => lo < hi, {
			message: "Expected a nonempty half-open interval."
		})
	)
	.pipe(Schema.brand("CopyInterval"))
export type Interval = typeof IntervalSchema.Type

/** Work payload coordinate meaning belongs to the pass window. */
export const CopyPageSchema = IntervalSchema
export type CopyPage = typeof CopyPageSchema.Type

/** The 17 catalog spellings the mirror pins; `sql/cast.ts` maps them to registry names, never the reverse. */
export const PINNED_COLUMN_TYPES = [
	"text",
	"uuid",
	"integer",
	"bigint",
	"smallint",
	"real",
	"double precision",
	"numeric",
	"boolean",
	"date",
	"timestamp without time zone",
	"timestamp with time zone",
	"jsonb",
	"jsonb[]",
	"text[]",
	"integer[]",
	"uuid[]"
] as const
export const PinnedColumnTypeSchema = Schema.Literals(PINNED_COLUMN_TYPES)
export type PinnedColumnType = typeof PinnedColumnTypeSchema.Type

/** PostgreSQL catalog identifiers are nonempty and cannot contain NUL. Quoting belongs to Drizzle. */
const ColumnNameSchema = Schema.NonEmptyString.check(
	Schema.makeFilter((name) => !name.includes("\0"), {
		message: "Expected a PostgreSQL identifier."
	})
)

export const PinnedColumnSchema = Schema.Struct({
	name: ColumnNameSchema,
	type: PinnedColumnTypeSchema
})
export type PinnedColumn = typeof PinnedColumnSchema.Type
export const PinnedColumnsSchema = Schema.NonEmptyArray(PinnedColumnSchema).check(
	Schema.makeFilter((columns) => new Set(columns.map(({ name }) => name)).size === columns.length, {
		message: "Expected distinct pinned column names in catalog order."
	})
)

/** Catalog facts, not a parser for PostgreSQL type syntax. Array element ownership is admitted by the door. */
export const OriginColumnSchema = Schema.Struct({
	name: ColumnNameSchema,
	formatType: Schema.NonEmptyString,
	isUserDefined: Schema.Boolean,
	isArray: Schema.Boolean
})
export type OriginColumn = typeof OriginColumnSchema.Type

const HeapCoordinateSchema = CoordinateSchema.check(Schema.isGreaterThanOrEqualTo(0))

/** The admitted heap extent of one copy pass; its kind and reread basis live on the ledger row. */
export const CopyWindowSchema = Schema.Struct({
	fromBlock: HeapCoordinateSchema,
	blocks: HeapCoordinateSchema,
	bytesPerBlock: HeapCoordinateSchema
}).check(
	Schema.makeFilter(
		({ fromBlock, blocks, bytesPerBlock }) =>
			fromBlock < Math.max(1, blocks) && (blocks === 0 || bytesPerBlock > 0),
		{
			message: "Expected a nonempty admitted heap interval with positive bytes per nonempty block."
		}
	)
)
export type CopyWindow = typeof CopyWindowSchema.Type
