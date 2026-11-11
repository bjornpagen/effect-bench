import { main } from "#main.ts"
import { WORKLOADS } from "#workloads/openapi-cli-generator.ts"

main(WORKLOADS, globalThis.process.argv.slice(2))
