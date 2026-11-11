import { Array as Arr, Option, Schema, String as Str } from "effect"

/** The most characters a title holds, counted as PostgreSQL counts them: the column's CHECK and the admission Schema
 * both hold it, and the column refuses a longer title rather than truncating it. */
export const TODO_TITLE_MAX_LENGTH = 256

/** A server-minted UUIDv7: every primary key is one, so its first 48 bits are its row's creation
 * time. Each table's id brands it further, and stays a Uuidv7. */
export const Uuidv7 = Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand("Uuidv7"))
export type Uuidv7 = typeof Uuidv7.Type

/** A todo's id. */
export const TodoId = Uuidv7.pipe(Schema.brand("TodoId"))
export type TodoId = typeof TodoId.Type

/** A title's length in characters as PostgreSQL's `char_length` counts it: code points, not UTF-16 units. */
export const titleLengthOf = (title: string): number => Arr.fromIterable(title).length

/**
 * The characters a title may neither begin nor end with: every Unicode White_Space character and the byte order mark,
 * which covers every space JavaScript's `trim` removes and every one PostgreSQL's `[:space:]` may match. The column's
 * CHECK spells this same list as escapes, so neither side depends on a runtime's notion of space or on the database
 * server's C library, and the agreement suite proves they match.
 */
export const TITLE_EDGE_SPACES: ReadonlySet<number> = new Set([
	0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x16_80, 0x20_00, 0x20_01, 0x20_02, 0x20_03,
	0x20_04, 0x20_05, 0x20_06, 0x20_07, 0x20_08, 0x20_09, 0x20_0a, 0x20_28, 0x20_29, 0x20_2f, 0x20_5f,
	0x30_00, 0xfe_ff
])

/** Whether a character, when there is one, is an edge space. */
const isEdgeSpace = (character: Option.Option<string>): boolean =>
	Option.exists(Option.flatMap(character, Str.codePointAt(0)), (point) =>
		TITLE_EDGE_SPACES.has(point)
	)

/** Whether a title neither begins nor ends with one of the edge spaces, read by code point. */
const isEdgeTrimmed = (title: string): boolean => {
	const characters = Arr.fromIterable(title)
	return !isEdgeSpace(Arr.head(characters)) && !isEdgeSpace(Arr.last(characters))
}

/** A title as a person typed it: trimmed of the edge spaces, never empty, at most `TODO_TITLE_MAX_LENGTH` characters,
 * so every title the column's CHECK accepts decodes, and every title that decodes is stored as it is. */
export const TodoTitle = Schema.String.check(
	Schema.makeFilter(isEdgeTrimmed),
	Schema.isMinLength(1),
	Schema.makeFilter((title: string) => titleLengthOf(title) <= TODO_TITLE_MAX_LENGTH)
).pipe(Schema.brand("TodoTitle"))
export type TodoTitle = typeof TodoTitle.Type

/** The todo whose completion the person set no longer exists. */
export class TodoNotFound extends Schema.TaggedError<
	TodoNotFound,
	{ readonly brand: unique symbol }
>()("TodoNotFound", {
	id: TodoId
}) {}
