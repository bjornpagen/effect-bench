import { main } from "#main.ts"
import { SUPERSTARTER_WORKLOADS } from "#workloads/superstarter.ts"

main(SUPERSTARTER_WORKLOADS, globalThis.process.argv.slice(2))
