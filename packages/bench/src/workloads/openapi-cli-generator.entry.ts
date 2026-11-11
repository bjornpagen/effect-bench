import { main } from "#main.ts"
import { OPENAPI_WORKLOADS } from "#workloads/openapi-cli-generator.ts"

main(OPENAPI_WORKLOADS, globalThis.process.argv.slice(2))
