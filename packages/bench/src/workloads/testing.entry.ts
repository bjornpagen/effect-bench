import { main } from "#main.ts"
import { TESTING_WORKLOADS } from "#workloads/testing.ts"

main(TESTING_WORKLOADS, globalThis.process.argv.slice(2))
