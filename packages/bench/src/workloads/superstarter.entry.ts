import { main } from "#main.ts"
import { WORKLOADS } from "#workloads/superstarter.ts"

main(WORKLOADS, globalThis.process.argv.slice(2))
