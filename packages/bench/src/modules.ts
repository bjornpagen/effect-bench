import type { Workload } from "#workload.ts"
import { EDULLM_WORKLOADS } from "#workloads/edullm.ts"
import { EFFECT_XML_WORKLOADS } from "#workloads/effect-xml.ts"
import { GRIZZLE_WORKLOADS } from "#workloads/grizzle.ts"
import { OPENAPI_WORKLOADS } from "#workloads/openapi-cli-generator.ts"
import { QTI_PIE_WORKLOADS } from "#workloads/qti-pie.ts"
import { SUPERSTARTER_WORKLOADS } from "#workloads/superstarter.ts"
import { TESTING_WORKLOADS } from "#workloads/testing.ts"

/** Every bundled module, by the name its bundle and its AOT executables carry, with its roster. */
export const MODULES: ReadonlyArray<
	Readonly<{ module: string; workloads: ReadonlyArray<Workload> }>
> = [
	{ module: "testing", workloads: TESTING_WORKLOADS },
	{ module: "effect-xml", workloads: EFFECT_XML_WORKLOADS },
	{ module: "qti-pie", workloads: QTI_PIE_WORKLOADS },
	{ module: "grizzle", workloads: GRIZZLE_WORKLOADS },
	{ module: "openapi-cli-generator", workloads: OPENAPI_WORKLOADS },
	{ module: "edullm", workloads: EDULLM_WORKLOADS },
	{ module: "superstarter", workloads: SUPERSTARTER_WORKLOADS }
]
