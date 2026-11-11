import { main } from "#main.ts"
import { WORKLOADS } from "#workloads/grizzle.ts"

main(WORKLOADS, globalThis.process.argv.slice(2))
