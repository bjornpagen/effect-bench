import { main } from "#main.ts"
import { WORKLOADS } from "#workloads/effect-xml.ts"

main(WORKLOADS, globalThis.process.argv.slice(2))
