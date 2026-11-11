import {
	type ActionContract,
	ActionPayloadRefused,
	type ActionRejection,
	exitCodecOf,
	makeActionClient,
	type WireSchema
} from "@superstarter/todo-protocol/action.ts"
import {
	CreateTodo,
	DeleteTodo,
	SetTodoCompleted
} from "@superstarter/todo-protocol/todo-contracts.ts"
import { TodoId, TodoNotFound, type TodoTitle } from "@superstarter/todo-protocol/todos.ts"
import { Array as Arr, Effect, Formatter, Option, Ref, Schema, String as Str } from "effect"
import type { Workload } from "#workload.ts"

/** A todo as the in-memory store holds it. */
type Stored = Readonly<{ title: TodoTitle; completed: boolean }>

const failed = (): ActionRejection => ({ kind: "failed" })

const client = makeActionClient(failed)

/** The UUIDv7 a store mints for its `index`th todo: version 7, the RFC 9562 variant, time-ordered by index. */
const uuidv7Of = (index: number): string => {
	const hex = Str.padStart(12, "0")(index.toString(16))
	return `01900000-0000-7000-8000-${hex}`
}

const decodeTodoId = Schema.decodeUnknownEffect(TodoId)

/** One server action as Next serves it: the payload decoded, the action run, its Exit encoded through the contract's
 * codec; a payload that does not decode is the contract's ActionPayloadRefused. The Promise is the Next boundary. */
const serve =
	<P extends WireSchema, S extends WireSchema, E extends WireSchema>(
		contract: ActionContract<P, S, E>,
		handler: (payload: P["Type"]) => Effect.Effect<S["Type"], E["Type"]>
	) =>
	(input: P["Encoded"]): Promise<Schema.Json> =>
		Effect.runPromise(
			Schema.decodeUnknownEffect(contract.payload)(input).pipe(
				Effect.mapError(() => ActionPayloadRefused.make({})),
				Effect.flatMap(handler),
				Effect.exit,
				Effect.flatMap((exit) => Schema.encodeUnknownEffect(exitCodecOf(contract))(exit)),
				Effect.orDie
			)
		)

/** superstarter's three server actions over one Map-backed store, each called through the app's action client. */
const actionsOver = (store: Ref.Ref<ReadonlyMap<string, Stored>>, minted: Ref.Ref<number>) => ({
	create: client(
		CreateTodo,
		serve(CreateTodo, (title) =>
			Effect.gen(function* () {
				const index = yield* Ref.getAndUpdate(minted, (n) => n + 1)
				const id = yield* Effect.orDie(decodeTodoId(uuidv7Of(index)))
				yield* Ref.update(store, (map) => new Map(map).set(id, { title, completed: false }))
				return id
			})
		)
	),
	setCompleted: client(
		SetTodoCompleted,
		serve(SetTodoCompleted, ({ id, completed }) =>
			Effect.gen(function* () {
				const map = yield* Ref.get(store)
				const todo = yield* Effect.fromOption(Option.fromUndefinedOr(map.get(id))).pipe(
					Effect.mapError(() => TodoNotFound.make({ id }))
				)
				yield* Ref.set(store, new Map(map).set(id, { ...todo, completed }))
			})
		)
	),
	remove: client(
		DeleteTodo,
		serve(DeleteTodo, (id) =>
			Ref.update(store, (map) => {
				const next = new Map(map)
				next.delete(id)
				return next
			})
		)
	)
})

/** The titles people type, Unicode included, each one a valid TodoTitle. */
const TITLES: ReadonlyArray<string> = Arr.makeBy(
	200,
	(index) =>
		`${["Buy milk", "Ship it", "Café ☕", "Call Zoë", "読書", "Fix #42"][index % 6]} ${index}`
)

/** A day of todo traffic: 200 todos created, every one completed, a missing one refused, half of them deleted. */
const traffic = Effect.gen(function* () {
	const store = yield* Ref.make<ReadonlyMap<string, Stored>>(new Map())
	const minted = yield* Ref.make(0)
	const { create, setCompleted, remove } = actionsOver(store, minted)
	const decodeTitle = Schema.decodeUnknownEffect(CreateTodo.payload)
	const ids = yield* Effect.forEach(TITLES, (title) =>
		Effect.flatMap(Effect.orDie(decodeTitle(title)), (decoded) => Effect.orDie(create(decoded)))
	)
	yield* Effect.forEach(ids, (id) => Effect.orDie(setCompleted({ id, completed: true })))
	const missing = yield* Effect.orDie(decodeTodoId(uuidv7Of(1_000_000)))
	const refused = yield* Effect.match(setCompleted({ id: missing, completed: true }), {
		onFailure: (failure) => failure._tag,
		onSuccess: () => "accepted"
	})
	yield* Effect.forEach(Arr.take(ids, 100), (id) => Effect.orDie(remove(id)))
	const left = yield* Ref.get(store)
	return () => Formatter.format({ ids, refused, left: [...left.entries()] })
})

/** superstarter's server actions over their real wire contracts, in memory. */
export const SUPERSTARTER_WORKLOADS: ReadonlyArray<Workload> = [
	{ name: "superstarter-todo-actions-200", source: "@superstarter/todo-protocol", run: traffic }
]
