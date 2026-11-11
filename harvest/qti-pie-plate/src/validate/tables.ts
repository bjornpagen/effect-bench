/**
 * The tables of the QTI 3.0 ASI XSD, committed as `tables.generated.json` so that validation never
 * reads or parses the XSD at run time.
 *
 * `scripts/tables.ts` reads the cached XSD at `xsdPath` (`src/validate/xsd.ts`), generates the
 * tables with `generateTables` and writes the JSON, which {@link tables} loads. The test proves the
 * committed file is what the generator builds from that XSD today, and that the XSD is the one
 * {@link xsdSha256} names. To regenerate, from the repository root:
 *
 * ```sh
 * node packages/plate/scripts/tables.ts && pnpm exec vp fmt packages/plate/src/validate/tables.generated.json
 * ```
 *
 * @module
 */
import { Schema } from "effect";
import committed from "#plate/validate/tables.generated.json" with { type: "json" };
import { Tables } from "#plate/validate/xsd.ts";

/**
 * The SHA-256 of the XSD the committed tables were generated from: the full QTI 3.0 ASI XSD,
 * `imsqti_asiv3p0p1_v1p0.xsd`, which D4 rules the only source of the tables.
 */
export const xsdSha256 = "bd82f6df3c7acec951fffc78548325a01e9e9bc91d5768d7415bdcbdc018341d";

/**
 * Decode a tables file, throwing on one that is not {@link Tables}.
 */
const decodeTables = Schema.decodeUnknownSync(Tables);

/**
 * The committed tables, `tables.generated.json`, decoded: one element table per local name the XSD
 * declares in the QTI namespace.
 */
export const tables: Tables = decodeTables(committed);
