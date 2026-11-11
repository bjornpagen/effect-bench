/**
 * The block names of XML Schema 1.0 Part 2, Appendix F, with their code-point ranges: the names a
 * block escape such as `\p{IsBasicLatin}` may use.
 *
 * {@link generateBlocks} reads the rows from the Recommendation's HTML, and `scripts/blocks.ts`
 * writes them to `blocks.generated.json`, which {@link blocks} loads. The test proves the committed
 * file is what the generator reads from the cached Recommendation today, and that the cached file
 * is the one {@link xsdPart2Sha256} names. To regenerate, from the repository root:
 *
 * ```sh
 * node packages/plate/scripts/blocks.ts && pnpm exec vp fmt packages/plate/src/model/blocks.generated.json
 * ```
 *
 * The table is the Recommendation's, 85 rows over 84 names, not the Unicode Database's current
 * `Blocks.txt`. A browser module (rule `e2bd87f2`): it value-imports only `Data` and `Result`
 * from `effect`.
 *
 * @module
 * @see https://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#nt-IsBlock
 */
import { Data, Result } from "effect";
import committed from "#plate/model/blocks.generated.json" with { type: "json" };

/**
 * A block's code points, `first` to `last`, both included.
 */
export interface BlockRange {
  readonly first: number;
  readonly last: number;
}

/**
 * One row of the block table: a block name and its code points. A name the table lists twice
 * (`Specials`) has two rows.
 */
export interface BlockRow extends BlockRange {
  readonly name: string;
}

/**
 * The SHA-256 of the HTML the committed table was generated from: XML Schema Part 2: Datatypes
 * Second Edition, `xmlschema-2-20041028.html`.
 */
export const xsdPart2Sha256 = "980de872aa2c50013d5202176eb85eef3f183a7df635fdcb6b4aa34c1c12eb72";

/**
 * Where that HTML is cached, relative to `HOME`. Only `scripts/blocks.ts` and the test read it.
 */
export const xsdPart2CachePath = ".cache/gr8des/w3c/xmlschema-2-20041028.html";

/**
 * Group rows by block name, keeping the table's order of names and of each name's ranges.
 *
 * @param rows The table's rows.
 * @returns Each name's ranges.
 */
const byName = (rows: readonly BlockRow[]): ReadonlyMap<string, readonly BlockRange[]> => {
  const grouped = new Map<string, readonly BlockRange[]>();

  for (const { first, last, name } of rows) {
    grouped.set(name, [...(grouped.get(name) ?? []), { first, last }]);
  }

  return grouped;
};

/**
 * The committed block table, by name: each of the 84 names with its ranges, two for `Specials`.
 */
export const blocks: ReadonlyMap<string, readonly BlockRange[]> = byName(committed);

/**
 * What {@link generateBlocks} could not find: the `IsBlock` production, the block table after it,
 * or a row that reads as a start code, an end code and a block name.
 */
export type BlockTableReason = "production" | "row" | "table";

/**
 * What each {@link BlockTableReason} means, as the middle of a message.
 */
const problems: Readonly<Record<BlockTableReason, string>> = {
  production: 'has no IsBlock production (id="nt-IsBlock")',
  row: "has a block table row that is not a start code, an end code and a block name",
  table: 'has no block table (a table with a "Block Name" column) after the IsBlock production',
};

/**
 * The failure of reading the block table from an HTML text: the text is not XML Schema 1.0 Part 2,
 * or its table changed shape.
 *
 * `detail` is the row's cells for `row`, and empty otherwise.
 */
export class BlockTableUnreadable extends Data.TaggedError("BlockTableUnreadable")<{
  readonly detail: string;
  readonly reason: BlockTableReason;
}> {
  /**
   * What the text lacks and what to change.
   */
  override get message(): string {
    const detail = this.detail === "" ? "" : ` (${this.detail})`;

    return `The HTML ${problems[this.reason]}${detail}. Read XML Schema Part 2: Datatypes Second Edition, whose SHA-256 is ${xsdPart2Sha256}, or update generateBlocks in src/model/blocks.ts to the table's new shape.`;
  }
}

/**
 * The anchor of Appendix F's `IsBlock` production, which the block table follows.
 */
const productionAnchor = 'id="nt-IsBlock"';

/**
 * The block table's name column header, which tells it from the production's own table.
 */
const nameHeader = "<th>Block Name</th>";

/**
 * The column headers of one start code, end code and block name triple.
 */
const tripleHeaders = ["Start Code", "End Code", "Block Name"] as const;

/**
 * A table cell, `<td>` or `<th>`, empty (`<td/>`) or with its text.
 */
const cellPattern = /<t(?<kind>[dh])(?:\s[^>]*?)?(?:\/>|>(?<text>[\s\S]*?)<\/t\k<kind>>)/gu;

/**
 * A code point as the table writes it: `#x` and hexadecimal digits.
 */
const codePoint = /^#x(?<hex>[\dA-Fa-f]{1,6})$/u;

/**
 * A block name, the part of an `IsBlock` after `Is`: `[a-zA-Z0-9#x2D]+`.
 */
const blockName = /^[\dA-Za-z-]+$/u;

/**
 * One table cell.
 */
interface Cell {
  readonly header: boolean;
  readonly text: string;
}

/**
 * Read a table row's cells, each with its text trimmed.
 *
 * @param row The row's HTML.
 * @returns Its cells, in order.
 */
const cellsOf = (row: string): readonly Cell[] =>
  [...row.matchAll(cellPattern)].map((match) => ({
    header: match.groups?.["kind"] === "h",
    text: (match.groups?.["text"] ?? "").trim(),
  }));

/**
 * Read one start code, end code and block name triple.
 *
 * @param cells The triple's three cell texts.
 * @returns Nothing when all three are empty, the row when they read, or the failure.
 */
const readTriple = (
  cells: readonly string[],
): Result.Result<readonly BlockRow[], BlockTableUnreadable> => {
  const [start = "", end = "", name = ""] = cells;
  const first = codePoint.exec(start)?.groups?.["hex"];
  const last = codePoint.exec(end)?.groups?.["hex"];

  if (start === "" && end === "" && name === "") {
    return Result.succeed([]);
  }

  if (first === undefined || last === undefined || !blockName.test(name)) {
    return Result.fail(new BlockTableUnreadable({ detail: cells.join(" "), reason: "row" }));
  }

  const row = { first: Number.parseInt(first, 16), last: Number.parseInt(last, 16), name };

  return row.first <= row.last
    ? Result.succeed([row])
    : Result.fail(new BlockTableUnreadable({ detail: cells.join(" "), reason: "row" }));
};

/**
 * Read the block table of XML Schema 1.0 Part 2 from the Recommendation's HTML.
 *
 * It anchors on the `IsBlock` production (`id="nt-IsBlock"`) and reads the first table after it
 * with a "Block Name" column, never a line number. Each row holds one or more start code, end
 * code and block name triples, which the header row places; the rows come in the table's order,
 * row by row and left to right, and an empty triple is skipped.
 *
 * @param html The Recommendation's HTML.
 * @returns The table's rows, or the failure naming what the text lacks.
 */
export const generateBlocks = (
  html: string,
): Result.Result<readonly BlockRow[], BlockTableUnreadable> => {
  const production = html.indexOf(productionAnchor);

  if (production === -1) {
    return Result.fail(new BlockTableUnreadable({ detail: "", reason: "production" }));
  }

  const header = html.indexOf(nameHeader, production);
  const start = html.lastIndexOf("<table", header);
  const end = html.indexOf("</table>", header);
  const located = header !== -1 && start > production && end !== -1;
  const rows = located
    ? html
        .slice(start, end)
        .split(/<tr[\s>]/u)
        .slice(1)
        .map(cellsOf)
    : [];
  const headers =
    rows.find((cells) => cells.length > 0 && cells.every((cell) => cell.header)) ?? [];
  const triples = headers.flatMap((_, index) =>
    tripleHeaders.every((text, offset) => headers[index + offset]?.text === text) ? [index] : [],
  );

  if (triples.length === 0) {
    return Result.fail(new BlockTableUnreadable({ detail: "", reason: "table" }));
  }

  return Result.all(
    rows
      .filter((cells) => !cells.some((cell) => cell.header))
      .flatMap((cells) =>
        triples.map((index) =>
          readTriple(cells.slice(index, index + tripleHeaders.length).map((cell) => cell.text)),
        ),
      ),
  ).pipe(Result.map((read) => read.flat()));
};
