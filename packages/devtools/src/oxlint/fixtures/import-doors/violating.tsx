import { Pool } from "pg" // violation
import type { PoolClient } from "pg" // violation
import "pg" // violation
import { makeActionClient } from "@effect-bench/todo-protocol/action" // violation
import * as action from "@effect-bench/todo-protocol/action" // violation
import { refusalsOf } from "@effect-bench/todo-protocol/action"
import type { ActionRejection } from "@effect-bench/todo-protocol/action"
export { makeActionClient as make } from "@effect-bench/todo-protocol/action" // violation
export { exitCodecOf } from "@effect-bench/todo-protocol/action"
export * from "@effect-bench/todo-protocol/action" // violation
export * as postgres from "pg" // violation
export type Rejection = ActionRejection
export type Client = PoolClient
export const used = [Pool, makeActionClient, action, refusalsOf]
