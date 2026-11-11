import { main } from "#main.ts"
import { WORKLOADS } from "#workloads/qti-pie.ts"

main(WORKLOADS, globalThis.process.argv.slice(2))
