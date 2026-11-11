import { main } from "#main.ts"
import { EFFECT_XML_WORKLOADS } from "#workloads/effect-xml.ts"

main(EFFECT_XML_WORKLOADS, globalThis.process.argv.slice(2))
