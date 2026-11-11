import { main } from "#main.ts"
import { EDULLM_WORKLOADS } from "#workloads/edullm.ts"

main(EDULLM_WORKLOADS, globalThis.process.argv.slice(2))
