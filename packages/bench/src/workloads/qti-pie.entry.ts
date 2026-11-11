import { main } from "#main.ts"
import { QTI_PIE_WORKLOADS } from "#workloads/qti-pie.ts"

main(QTI_PIE_WORKLOADS, globalThis.process.argv.slice(2))
