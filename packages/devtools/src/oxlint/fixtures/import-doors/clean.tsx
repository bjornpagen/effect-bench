import { Pool } from "pg"
import * as driver from "pg"
import { makeActionClient } from "@effect-bench/todo-protocol/action"
export { makeActionClient as make } from "@effect-bench/todo-protocol/action"
export const used = [Pool, driver, makeActionClient]
