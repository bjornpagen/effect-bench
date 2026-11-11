import { Schema } from "effect"
import { TodoId, TodoNotFound, TodoTitle } from "#todos.ts"
import { PostgresTransientFailure } from "#transient-failure.ts"

/** Inserts a todo and answers its new id. */
export const CreateTodo = {
	name: "todos.create",
	payload: TodoTitle,
	success: TodoId,
	error: PostgresTransientFailure
} as const

/** Sets a todo's completion to the value the person chose, so sending it again changes nothing. */
export const SetTodoCompleted = {
	name: "todos.set-completed",
	payload: Schema.Struct({ id: TodoId, completed: Schema.Boolean }),
	success: Schema.Void,
	error: Schema.Union([TodoNotFound, PostgresTransientFailure])
} as const

/** Deletes a todo. A todo that is already gone is deleted all the same. */
export const DeleteTodo = {
	name: "todos.delete",
	payload: TodoId,
	success: Schema.Void,
	error: PostgresTransientFailure
} as const
