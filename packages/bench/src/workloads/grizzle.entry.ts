import { main } from "#main.ts"
import { GRIZZLE_WORKLOADS } from "#workloads/grizzle.ts"

main(GRIZZLE_WORKLOADS, globalThis.process.argv.slice(2))
