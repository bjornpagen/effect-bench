import { main } from "#main.ts"
import { WORKLOADS } from "#workloads/testing.ts"

main(WORKLOADS, globalThis.process.argv.slice(2))
