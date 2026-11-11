import { main } from "#main.ts"
import { WORKLOADS } from "#workloads/edullm.ts"

main(WORKLOADS, globalThis.process.argv.slice(2))
