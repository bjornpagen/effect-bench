import { Effect, Schema } from "effect"

/** Every server action the app exposes. Each is one contract's `name` and the
 * `superstarter.action.name` on every span its run opens. */
export const SERVER_ACTIONS = ["todos.create", "todos.set-completed", "todos.delete"] as const
export type ServerActionName = (typeof SERVER_ACTIONS)[number]

/** A Schema that decodes and encodes without services, so both sides of the wire can run it. */
export type WireSchema = Schema.Top & {
	readonly DecodingServices: never
	readonly EncodingServices: never
}

/**
 * What one server action admits, answers and refuses. The contract lives in browser-safe code so the
 * server action and its caller share one definition: the payload decodes on the server, and the
 * outcome, typed errors included, decodes back into the same classes in the browser.
 */
export type ActionContract<
	P extends WireSchema,
	S extends WireSchema,
	E extends WireSchema
> = Readonly<{
	name: ServerActionName
	payload: P
	success: S
	error: E
}>

/** The server could not decode the action's payload, so nothing ran: the page sent what this
 * deployment's contract refuses, as a page older than the deployment can. Every contract names it. */
export class ActionPayloadRefused extends Schema.TaggedError<
	ActionPayloadRefused,
	{ readonly brand: unique symbol }
>()("ActionPayloadRefused", {}) {}

/** The server answered that the action failed in a way the person cannot fix. Its cause never
 * crosses the wire; the server reported it. */
export class ActionFailed extends Schema.TaggedError<
	ActionFailed,
	{ readonly brand: unique symbol }
>()("ActionFailed", {}) {}

/** No answer from the action reached the caller: the request failed in transit, its answer was cut
 * off, or something other than the action answered. The change may or may not have landed, so the
 * caller never retries it on its own. */
export class ActionUnconfirmed extends Schema.TaggedError<
	ActionUnconfirmed,
	{ readonly brand: unique symbol }
>()("ActionUnconfirmed", {}) {}

/** A server action as the client imports it. It answers JSON: the Exit of its Effect, encoded by its
 * contract. */
export type ServerAction<P extends WireSchema> = (input: P["Encoded"]) => Promise<Schema.Json>

/** Everything one action refuses with: its contract's own errors and a payload that does not decode. */
export const refusalsOf = <E extends WireSchema>(
	contract: ActionContract<WireSchema, WireSchema, E>
) => Schema.Union([contract.error, ActionPayloadRefused])

/** The one encoding of an action's outcome: success, a refusal, or the opaque ActionFailed. */
export const exitCodecOf = <S extends WireSchema, E extends WireSchema>(
	contract: ActionContract<WireSchema, S, E>
) =>
	Schema.toCodecJson(
		Schema.Exit(contract.success, Schema.Union([refusalsOf(contract), ActionFailed]), Schema.Never)
	)

/** Why a server action's promise rejected, as its host tells: the host's own control signal, which
 * leaves as itself so the host's boundary acts on it; the server's own answer that the action
 * failed; or no answer from the action at all. */
export type ActionRejection =
	| Readonly<{ kind: "signal"; signal: unknown }>
	| Readonly<{ kind: "failed" }>
	| Readonly<{ kind: "unanswered" }>

/** Every failure a call can end in besides its contract's own errors. */
type CallFailure = ActionPayloadRefused | ActionFailed | ActionUnconfirmed

const rejectedAs = (rejection: ActionRejection): Effect.Effect<never, CallFailure> => {
	switch (rejection.kind) {
		case "signal":
			return Effect.die(rejection.signal)
		case "failed":
			return Effect.fail(ActionFailed.make({}))
		case "unanswered":
			return Effect.fail(ActionUnconfirmed.make({}))
	}
}

/**
 * The client for one host: a server action as the client's view of it, an Effect that fails with
 * the contract's own errors. An answered action decodes its Exit, refusals included. A rejected
 * action promise is whatever its host says it is (`ActionRejection`): the host recognizes its own
 * signals and its own server's error answers, so the contracts stay host-neutral.
 */
export const makeActionClient =
	(rejectionOf: (cause: unknown) => ActionRejection) =>
	<P extends WireSchema, S extends WireSchema, E extends WireSchema>(
		contract: ActionContract<P, S, E>,
		action: ServerAction<P>
	) => {
		const encodePayload = Schema.encodeEffect(contract.payload)
		const decodeExit = Schema.decodeUnknownEffect(exitCodecOf(contract))
		return (payload: P["Type"]): Effect.Effect<S["Type"], E["Type"] | CallFailure> =>
			encodePayload(payload).pipe(
				Effect.orDie,
				Effect.flatMap((encoded) =>
					Effect.tryPromise({ try: () => action(encoded), catch: rejectionOf })
				),
				Effect.catch(rejectedAs),
				Effect.flatMap((wire) => decodeExit(wire).pipe(Effect.orDie, Effect.flatten))
			)
	}
