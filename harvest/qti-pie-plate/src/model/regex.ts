/**
 * The XSD-regex reader: an XML Schema 1.0 regular expression, the language of `pattern-mask`, read
 * by Appendix F's grammar, then written as a JavaScript expression with the `v` flag
 * ({@link translate}) or compiled into an automaton matched in linear time ({@link compile},
 * {@link matches}).
 *
 * XML Schema anchors every expression at both ends and treats `^` and `$` as ordinary characters,
 * so the translation is `^(?:…)$` with any `^` or `$` of the pattern escaped. Its escapes keep
 * XML Schema's meanings, which JavaScript's differ from: `\s` is the four XML whitespace
 * characters (JavaScript's `\s` also takes U+00A0, U+FEFF and the `Zs` spaces), `\d` is every
 * decimal digit (`\p{Nd}`), and `\w` is everything but punctuation, separators and others. The `v`
 * flag gives class subtraction (`[a-z-[aeiou]]` is `[[a-z]--[aeiou]]`) and matches by code point.
 * Every character the translation writes is a letter, a digit or a `\u{…}` escape, so no
 * character of the pattern is read by JavaScript's own syntax.
 *
 * A block escape (`\p{IsBasicLatin}`, or its complement `\P{…}`) is the class of its block's code
 * points as XML Schema 1.0's own block table lists them ({@link blocks}), not the Unicode
 * Database's current blocks; a name the table lists twice (`Specials`) takes both its ranges.
 *
 * Anything outside the grammar is refused with its position, never approximated: back-references,
 * lazy and possessive quantifiers, `(?…)` groups, unbalanced brackets and parentheses, escapes
 * Appendix F does not define, and block names the table does not list. `{` and `}` are
 * metacharacters, as Appendix F's definition of a metacharacter and XML Schema 1.1 say, though
 * production [10] omits them, so an unescaped `{` that opens no repetition count is refused. Groups
 * and classes nest at most {@link maximumNesting} deep, a bound of this translator rather than of
 * the grammar.
 *
 * Two readings follow later standards than XML Schema 1.0 names (reading 55): a category escape
 * takes the Unicode version the engine ships rather than Unicode 3.1, as Appendix F encourages, and
 * `\i` and `\c` take XML 1.0 (Fifth Edition)'s name characters, from {@link nameStartClass} and
 * {@link nameClass}, with the colon added.
 *
 * A `pattern-mask` is author content and the value it checks is the candidate's, so the check must
 * not let either stall its host. A backtracking engine, JavaScript's `RegExp` among them, takes
 * time exponential in the value's length on nested or ambiguous quantifiers (`(a+)+b`, `(a|ab)*c`).
 * XML Schema regular expressions have no back-references or look-around, so each is a true regular
 * expression: {@link compile} builds a Thompson automaton from the same reading, and
 * {@link matches} runs it over the value once, visiting each state at most once per character.
 * The automaton holds at most {@link maximumStates}, 128 states, as a repetition count copies what
 * it repeats; {@link translate} and {@link compile} both refuse a larger pattern at the quantifier
 * or `|` that passes the limit, so its host shows the notice instead of checking it. A posted value
 * is as long as the host lets a request body be: plate sets no bound, and the dev playground's
 * server reads at most 1,048,576 bytes (`scripts/serve.ts`), so a value there holds at most about a
 * million characters. The worst case is 128 × 1,048,576, about 1.3 × 10^8 state visits. Most
 * patterns take 5 to 25 nanoseconds a visit in Node 26 on the Apple-silicon laptop they were
 * measured on, 0.7 to 3 seconds at that size. A visit that tests a class costs more, so the slowest
 * pattern the limit admits holds many distinct classes under `*`, where each character tests every
 * class: 63 of them, 127 states, took 6.4 seconds over a million characters there. Each optional
 * copy of a repeated class takes two states, so the limit admits the corpus's `pattern-mask` values
 * (at most 21 states) and `[0-9]{0,63}` (127), and refuses `[0-9]{0,64}`.
 *
 * A count is measured against the limit as written, before it becomes a number, and one above
 * 127, the most copies of one character the automaton holds, is refused at its quantifier whatever
 * it repeats. So `(){1000000000}` is refused though an empty group takes no state, and no count
 * past 127 reaches the reckoning, the builder or the translation. A count within it may still
 * repeat a group that matches only the empty text, and such groups nest 100 deep; the builder makes
 * one copy of such a group, as further copies change nothing, so `((){127}){127}` builds one empty
 * group, not 16,129. The two rules together: the refusal keeps the limit one sentence long, and the
 * single copy keeps nested counts within it from multiplying the work.
 *
 * The module is pure and synchronous, a browser module.
 *
 * @module
 * @see https://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#regexs
 * @see https://www.w3.org/TR/xmlschema11-2/#regexs
 */
import { Data, Option, Result } from "effect";
import { blocks } from "#plate/model/blocks.ts";
import { nameClass, nameStartClass } from "#plate/model/values.ts";

/**
 * The failure of reading a pattern as an XML Schema regular expression, or of one whose automaton
 * would pass {@link maximumStates}: the pattern, the index of the character the grammar refuses or
 * of the quantifier or `|` that passes the limit (in UTF-16 code units, so
 * `pattern.slice(position)` starts at it; the opening bracket or parenthesis for one never
 * closed), and the reason, which names what to change.
 */
export class RegexRefused extends Data.TaggedError("RegexRefused")<{
  readonly pattern: string;
  readonly position: number;
  readonly reason: string;
}> {
  /**
   * The pattern, the position and the reason, in one line.
   */
  override get message(): string {
    return `The pattern ${JSON.stringify(this.pattern)} is refused at position ${this.position}: ${this.reason}.`;
  }
}

/**
 * A pattern being read: its characters, by code point, and the index of the next one.
 */
interface Reader {
  /**
   * The pattern's characters, one code point each.
   */
  readonly chars: readonly string[];
  /**
   * The UTF-16 index of each character, and the pattern's length after the last.
   */
  readonly offsets: readonly number[];
  readonly pattern: string;
  /**
   * The index, in {@link Reader.chars}, of the next character to read.
   */
  at: number;
  /**
   * How many groups and classes enclose the next character, at most {@link maximumNesting}.
   */
  depth: number;
}

/**
 * What an escape names: one character, which can end a range, or a class, which cannot.
 */
type Escape =
  | { readonly codePoint: number; readonly kind: "character" }
  | { readonly kind: "class"; readonly source: string };

/**
 * One atom of a read pattern: a character, a class of single characters, or a group.
 *
 * A class carries its translation, a `v`-flag class source that matches exactly one code point:
 * a class expression, a class escape, a category or block escape, or the wildcard.
 */
type Atom =
  | { readonly codePoint: number; readonly kind: "character" }
  | { readonly kind: "class"; readonly source: string }
  | { readonly expression: Expression; readonly kind: "group" };

/**
 * How often a piece's atom repeats: `least` to `most` times, `most` none when unbounded. A piece
 * written without a quantifier repeats once. Each bound is at most {@link pieceBudget}, as
 * {@link quantifier} refuses a larger one.
 */
interface Count {
  readonly least: bigint;
  readonly most: Option.Option<bigint>;
  /**
   * The UTF-16 index of the quantifier, or of the atom when none is written: where a refusal of the
   * piece's size points.
   */
  readonly position: number;
  /**
   * The quantifier as the translation writes it, empty when none is written.
   */
  readonly source: string;
}

/**
 * A piece: an atom and how often it repeats.
 */
interface Piece {
  readonly atom: Atom;
  readonly count: Count;
}

/**
 * A branch: its pieces, in order, and the UTF-16 index of the `|` before it (of the expression's
 * start for the first branch).
 */
interface Branch {
  readonly pieces: readonly Piece[];
  readonly position: number;
}

/**
 * A read regular expression: its branches, of which a value matches any one.
 */
type Expression = readonly Branch[];

/**
 * An inclusive range of code points.
 */
interface CodeRange {
  readonly first: number;
  readonly last: number;
}

/**
 * The characters the translation writes as themselves; every other character is a `\u{…}` escape.
 */
const plainCharacter = /^[0-9A-Za-z]$/u;

/**
 * Write one code point as the translation spells it, valid inside and outside a `v`-flag class.
 *
 * @param codePoint The code point.
 * @returns The character itself when it is an ASCII letter or digit, otherwise `\u{…}`.
 */
const literal = (codePoint: number): string => {
  const character = String.fromCodePoint(codePoint);

  return plainCharacter.test(character)
    ? character
    : `\\u{${codePoint.toString(16).toUpperCase()}}`;
};

/**
 * Write a range of code points as a member of a `v`-flag class.
 *
 * @param range The range.
 * @returns One character when the range holds one, otherwise `first-last`.
 */
const rangeSource = (range: CodeRange): string =>
  range.first === range.last
    ? literal(range.first)
    : `${literal(range.first)}-${literal(range.last)}`;

/**
 * One atom of a `u`-flag class body: a `\u{…}` escape or one character.
 */
const bodyAtom = /\\u\{(?<hex>[0-9A-Fa-f]+)\}|[\s\S]/gu;

/**
 * Read a `u`-flag class body into ranges of code points.
 *
 * {@link nameStartClass} and {@link nameClass} are written for a `u`-flag class, where a leading
 * `-` is a literal dash; a `v`-flag class refuses an unescaped `-`, so the body is read into
 * ranges and written again by {@link rangeSource}.
 *
 * @param body The class body: characters, `\u{…}` escapes and `a-b` ranges.
 * @returns Its ranges, in order.
 */
const rangesOf = (body: string): readonly CodeRange[] => {
  const atoms = Array.from(body.matchAll(bodyAtom), (match) => {
    const hex = match.groups?.["hex"];

    return {
      codePoint: hex === undefined ? (match[0].codePointAt(0) ?? 0) : Number.parseInt(hex, 16),
      text: match[0],
    };
  });
  const ranges: CodeRange[] = [];
  let next = 0;

  for (const [index, first] of atoms.entries()) {
    const last = atoms[index + 2];
    const range = index >= next && atoms[index + 1]?.text === "-" && last !== undefined;

    if (index >= next) {
      ranges.push({ first: first.codePoint, last: range ? last.codePoint : first.codePoint });
      next = index + (range ? 3 : 1);
    }
  }

  return ranges;
};

/**
 * Write a class body from ranges and the colon, which XML 1.0's name characters include and the
 * NCName classes leave out.
 *
 * @param body A `u`-flag class body from `#plate/model/values.ts`.
 * @returns The `v`-flag class body of its ranges and `:`.
 */
const nameBody = (body: string): string =>
  [...rangesOf(body), { first: 0x3a, last: 0x3a }].map(rangeSource).join("");

/**
 * The class body of XML Schema's `\i`: XML 1.0 (Fifth Edition)'s `NameStartChar`, colon included.
 */
const initialNameBody = nameBody(nameStartClass);

/**
 * The class body of XML Schema's `\c`: XML 1.0 (Fifth Edition)'s `NameChar`, colon included.
 */
const nameCharacterBody = nameBody(nameClass);

/**
 * The class body of XML Schema's `\s`: space, tab, line feed and carriage return, and no other.
 */
const spaceBody = [0x09, 0x0a, 0x0d, 0x20].map(literal).join("");

/**
 * The class of punctuation, separators and others, whose complement is XML Schema's `\w`.
 */
const nonWordBody = String.raw`\p{General_Category=P}\p{General_Category=Z}\p{General_Category=C}`;

/**
 * XML Schema's wildcard `.`: any character but a line feed or a carriage return.
 */
const wildcard = `[^${literal(0x0a)}${literal(0x0d)}]`;

/**
 * The single character escapes, by the character after the backslash, and the code point each
 * names: `\n`, `\r` and `\t`, and each metacharacter, `|`, `-` and `^` escaped as itself.
 */
const singleCharacterEscapes: ReadonlyMap<string, number> = new Map([
  ["n", 0x0a],
  ["r", 0x0d],
  ["t", 0x09],
  ...Array.from("\\|.?*+(){}-[]^", (character): [string, number] => [
    character,
    character.codePointAt(0) ?? 0,
  ]),
]);

/**
 * The multi-character escapes, by the letter after the backslash, and the translation of each.
 */
const multiCharacterEscapes: ReadonlyMap<string, string> = new Map([
  ["s", `[${spaceBody}]`],
  ["S", `[^${spaceBody}]`],
  ["i", `[${initialNameBody}]`],
  ["I", `[^${initialNameBody}]`],
  ["c", `[${nameCharacterBody}]`],
  ["C", `[^${nameCharacterBody}]`],
  ["d", String.raw`\p{General_Category=Nd}`],
  ["D", String.raw`\P{General_Category=Nd}`],
  ["w", `[^${nonWordBody}]`],
  ["W", `[${nonWordBody}]`],
]);

/**
 * The General_Category values a category escape names (Appendix F, productions [28] to [35]).
 * JavaScript's `General_Category` takes each of them as a value alias.
 */
const categories: ReadonlySet<string> = new Set([
  "L",
  "Lu",
  "Ll",
  "Lt",
  "Lm",
  "Lo",
  "M",
  "Mn",
  "Mc",
  "Me",
  "N",
  "Nd",
  "Nl",
  "No",
  "P",
  "Pc",
  "Pd",
  "Ps",
  "Pe",
  "Pi",
  "Pf",
  "Po",
  "Z",
  "Zs",
  "Zl",
  "Zp",
  "S",
  "Sm",
  "Sc",
  "Sk",
  "So",
  "C",
  "Cc",
  "Cf",
  "Co",
  "Cn",
]);

/**
 * A block escape's property: `Is` and a block name (Appendix F, production [36]).
 */
const blockProperty = /^Is[-0-9A-Za-z]+$/u;

/**
 * The deepest a pattern may nest groups and classes, together: 100.
 *
 * The reader recurses once per group, `(…)`, and once per class, `[…]` or a subtraction's `-[…]`,
 * and `pattern-mask` is author text read inside `open`, so a pattern nested thousands deep would
 * exhaust the call stack (Node's default stack holds about 560 nested groups) and throw instead of
 * being refused. The bound refuses such a pattern at the opening that passes it, keeping the
 * reader's stack under a fifth of Node's whatever the pattern. It is no smaller than real patterns
 * need: the `xs:pattern` facets of the QTI 3.0 XSD nest at most 4 deep and the corpus's
 * `pattern-mask` values 2.
 */
const maximumNesting = 100;

/**
 * Refuse the pattern at a character.
 *
 * @param reader The pattern being read.
 * @param at The character's index in {@link Reader.chars}.
 * @param reason What is wrong there, and what to change.
 * @returns The refusal, with the character's UTF-16 index.
 */
const refuse = (reader: Reader, at: number, reason: string): Result.Result<never, RegexRefused> =>
  Result.fail(
    new RegexRefused({
      pattern: reader.pattern,
      position: reader.offsets[at] ?? reader.pattern.length,
      reason,
    }),
  );

/**
 * Enter a group or a class whose opening character is the next one, refusing it when it would
 * nest the pattern past {@link maximumNesting}.
 *
 * @param reader The pattern being read, at the `(` or `[`; its depth rises by one on success.
 * @returns Nothing, or the refusal at the opening character.
 */
const enter = (reader: Reader): Result.Result<void, RegexRefused> => {
  if (reader.depth >= maximumNesting) {
    return refuse(
      reader,
      reader.at,
      `this ${reader.chars[reader.at] ?? ""} nests groups and classes ${maximumNesting + 1} deep, and this translator reads at most ${maximumNesting}; flatten the pattern so no group or class sits inside more than ${maximumNesting - 1} others`,
    );
  }

  reader.depth += 1;

  return Result.void;
};

/**
 * Read the run of decimal digits that starts at a character.
 *
 * @param reader The pattern being read.
 * @param from The index of the first character to read.
 * @returns The digits, empty when the character is not one.
 */
const digitsFrom = (reader: Reader, from: number): string => {
  let end = from;

  while (/^[0-9]$/u.test(reader.chars[end] ?? "")) {
    end += 1;
  }

  return reader.chars.slice(from, end).join("");
};

/**
 * Say why an escape is not one Appendix F defines, and what to write instead.
 *
 * @param letter The character after the backslash.
 * @returns The reason.
 */
const undefinedEscape = (letter: string): string => {
  if (/^[1-9]$/u.test(letter)) {
    return `\\${letter} is a back-reference, which XML Schema regular expressions do not have; write out the text it would repeat`;
  }

  if (letter === "k") {
    return String.raw`\k is a named back-reference, which XML Schema regular expressions do not have; write out the text it would repeat`;
  }

  return /^[0-9A-Za-z]$/u.test(letter)
    ? `\\${letter} is not an escape XML Schema defines; use \\n, \\r, \\t, \\s, \\S, \\i, \\I, \\c, \\C, \\d, \\D, \\w, \\W, \\p{…}, \\P{…}, or a backslash before one of . \\ ? * + { } ( ) [ ] | - ^`
    : `\\${letter} is not an escape XML Schema defines; write ${letter} without the backslash`;
};

/**
 * Read a category escape or a block escape, `\p{…}` or `\P{…}`, whose backslash is the next
 * character.
 *
 * A block escape is written as a `v`-flag class of its block's ranges, which reads the same inside
 * a class (as a nested class) and outside one.
 *
 * @param reader The pattern being read.
 * @param negated Whether the escape is `\P`, the complement.
 * @returns The class the escape names, or the refusal of an unknown category or block.
 */
const categoryEscape = (reader: Reader, negated: boolean): Result.Result<Escape, RegexRefused> => {
  const start = reader.at;
  const letter = negated ? "P" : "p";

  if (reader.chars[start + 2] !== "{") {
    return refuse(
      reader,
      start,
      `\\${letter} takes a category in braces, such as \\${letter}{Lu}; write \\${letter}{…}`,
    );
  }

  const close = reader.chars.indexOf("}", start + 3);

  if (close === -1) {
    return refuse(reader, start, `\\${letter}{ is never closed; end the category with }`);
  }

  const property = reader.chars.slice(start + 3, close).join("");

  if (categories.has(property)) {
    reader.at = close + 1;

    return Result.succeed({
      kind: "class",
      source: `\\${letter}{General_Category=${property}}`,
    });
  }

  const isBlock = blockProperty.test(property);
  const ranges = isBlock ? blocks.get(property.slice("Is".length)) : undefined;

  if (ranges !== undefined) {
    reader.at = close + 1;

    return Result.succeed({
      kind: "class",
      source: `[${negated ? "^" : ""}${ranges.map(rangeSource).join("")}]`,
    });
  }

  return refuse(
    reader,
    start,
    isBlock
      ? `${property} names no block in XML Schema's block table; use a block name the table lists, such as IsBasicLatin or IsGreek, spelled as the table spells it`
      : `${JSON.stringify(property)} is not a category XML Schema names; use one of ${[...categories].join(", ")}`,
  );
};

/**
 * Read an escape whose backslash is the next character.
 *
 * @param reader The pattern being read.
 * @returns The character or class it names, or the refusal of an escape Appendix F does not define.
 */
const escape = (reader: Reader): Result.Result<Escape, RegexRefused> => {
  const start = reader.at;
  const letter = reader.chars[start + 1];

  if (letter === undefined) {
    return refuse(
      reader,
      start,
      String.raw`the pattern ends in a lone \; write \\ to match a backslash`,
    );
  }

  const codePoint = singleCharacterEscapes.get(letter);

  if (codePoint !== undefined) {
    reader.at = start + 2;

    return Result.succeed({ codePoint, kind: "character" });
  }

  const source = multiCharacterEscapes.get(letter);

  if (source !== undefined) {
    reader.at = start + 2;

    return Result.succeed({ kind: "class", source });
  }

  return letter === "p" || letter === "P"
    ? categoryEscape(reader, letter === "P")
    : refuse(reader, start, undefinedEscape(letter));
};

/**
 * Read one character or escape of a class: the start or end of a range, or a class escape.
 *
 * @param reader The pattern being read, at a character that is not `-`, `[` or `]`.
 * @returns What it names.
 */
const classCharacter = (reader: Reader): Result.Result<Escape, RegexRefused> => {
  const character = reader.chars[reader.at] ?? "";

  if (character === "\\") {
    return escape(reader);
  }

  reader.at += 1;

  return Result.succeed({ codePoint: character.codePointAt(0) ?? 0, kind: "character" });
};

/**
 * Read one member of a class: a character, a range `s-e`, or a class escape.
 *
 * @param reader The pattern being read, at a character that is not `-`, `[` or `]`.
 * @returns The member as a `v`-flag class member.
 */
const classMember = (reader: Reader): Result.Result<string, RegexRefused> =>
  Result.gen(function* readClassMember() {
    const start = reader.at;
    const first = yield* classCharacter(reader);

    if (first.kind === "class") {
      return first.source;
    }

    const dash = reader.at;
    const end = reader.chars[dash + 1];

    if (reader.chars[dash] !== "-" || end === undefined || end === "]" || end === "[") {
      return literal(first.codePoint);
    }

    if (end === "-") {
      return yield* refuse(
        reader,
        dash + 1,
        String.raw`a range cannot end in an unescaped -; write \- to end it at a dash`,
      );
    }

    reader.at = dash + 1;

    const last = yield* classCharacter(reader);

    if (last.kind === "class") {
      return yield* refuse(
        reader,
        dash + 1,
        "a range ends in one character, and this escape names a class; end the range in a character, or put the escape outside the range",
      );
    }

    if (last.codePoint < first.codePoint) {
      return yield* refuse(
        reader,
        start,
        "this range runs from a higher code point to a lower one; write its lower end first",
      );
    }

    return rangeSource({ first: first.codePoint, last: last.codePoint });
  });

/**
 * Read a character group, the inside of `[…]`: a positive or negative group, and a subtraction
 * `-[…]` at its end.
 *
 * Appendix F reads `-` as a character only at the start or end of a group, and `^` as negation
 * only first; every other `-` is a range's or a subtraction's.
 *
 * @param reader The pattern being read, after the `[`.
 * @returns The group as a `v`-flag class, `[…]`; the reader stops at the closing `]` or at the
 *   end of the pattern, which the caller refuses.
 */
const characterGroup = (reader: Reader): Result.Result<string, RegexRefused> =>
  Result.gen(function* readCharacterGroup() {
    const negation = reader.chars[reader.at] === "^" ? "^" : "";
    const members: string[] = [];

    reader.at += negation.length;

    while (reader.at < reader.chars.length && reader.chars[reader.at] !== "]") {
      const { at } = reader;
      const character = reader.chars[at];
      const next = reader.chars[at + 1];

      if (character === "[") {
        return yield* refuse(
          reader,
          at,
          String.raw`a [ inside a class is written \[; a subtraction is written -[…] at the end of the class`,
        );
      }

      if (character === "-" && next === "[") {
        if (members.length === 0) {
          return yield* refuse(
            reader,
            at,
            String.raw`-[…] subtracts a class from the characters before it, and there are none; put characters before the -, or write \- to match a dash`,
          );
        }

        reader.at = at + 1;

        // oxlint-disable-next-line eslint/no-use-before-define -- `characterGroup` and `classExpression` are mutually recursive, as a subtraction's class nests; the call runs only after both are defined.
        const subtrahend = yield* classExpression(reader);

        if (reader.at < reader.chars.length && reader.chars[reader.at] !== "]") {
          return yield* refuse(
            reader,
            reader.at,
            "a subtraction -[…] ends its class; close the class with ] straight after it",
          );
        }

        return `[[${negation}${members.join("")}]--${subtrahend}]`;
      }

      if (character === "-") {
        if (members.length > 0 && next !== "]") {
          return yield* refuse(
            reader,
            at,
            String.raw`a - inside a class starts it, ends it, joins the two ends of a range or begins a subtraction -[…]; write \- to match a dash`,
          );
        }

        reader.at = at + 1;
        members.push(literal(0x2d));
      } else {
        members.push(yield* classMember(reader));
      }
    }

    if (members.length === 0 && reader.at < reader.chars.length) {
      return yield* refuse(
        reader,
        reader.at,
        String.raw`a class holds at least one character, range or escape; write \[ and \] to match the brackets themselves`,
      );
    }

    return `[${negation}${members.join("")}]`;
  });

/**
 * Read a character class expression, `[…]`, whose `[` is the next character.
 *
 * @param reader The pattern being read.
 * @returns The class as a `v`-flag class.
 */
const classExpression = (reader: Reader): Result.Result<string, RegexRefused> =>
  Result.gen(function* readClassExpression() {
    const open = reader.at;

    yield* enter(reader);
    reader.at += 1;

    const source = yield* characterGroup(reader);

    if (reader.chars[reader.at] !== "]") {
      return yield* refuse(
        reader,
        open,
        String.raw`this [ is never closed; end the class with ], or write \[ to match a bracket`,
      );
    }

    reader.at += 1;
    reader.depth -= 1;

    return source;
  });

/**
 * Read a parenthesised group, `(…)`, whose `(` is the next character.
 *
 * @param reader The pattern being read.
 * @returns The group; XML Schema's groups capture nothing a match reads.
 */
const group = (reader: Reader): Result.Result<Atom, RegexRefused> =>
  Result.gen(function* readGroup() {
    const open = reader.at;

    yield* enter(reader);
    reader.at += 1;

    if (reader.chars[reader.at] === "?") {
      return yield* refuse(
        reader,
        reader.at,
        "(? opens a group XML Schema does not have (non-capturing, look-around, named or with flags); write a plain (…) group",
      );
    }

    // oxlint-disable-next-line eslint/no-use-before-define -- `group` and `regularExpression` are mutually recursive, as groups nest; the call runs only after both are defined.
    const expression = yield* regularExpression(reader);

    if (reader.chars[reader.at] !== ")") {
      return yield* refuse(
        reader,
        open,
        String.raw`this ( is never closed; close the group with ), or write \( to match a parenthesis`,
      );
    }

    reader.at += 1;
    reader.depth -= 1;

    return { expression, kind: "group" } as const;
  });

/**
 * Read an atom: a normal character, a class, an escape, the wildcard or a group.
 *
 * @param reader The pattern being read, at a character that is not `|` or `)`.
 * @returns The atom.
 */
const atom = (reader: Reader): Result.Result<Atom, RegexRefused> => {
  const { at } = reader;
  const character = reader.chars[at] ?? "";

  switch (character) {
    case "(": {
      return group(reader);
    }
    case "[": {
      return Result.map(classExpression(reader), (source) => ({ kind: "class", source }) as const);
    }
    case "\\": {
      return Result.map(escape(reader), (named): Atom =>
        named.kind === "character" ? named : { kind: "class", source: named.source },
      );
    }
    case ".": {
      reader.at += 1;

      return Result.succeed({ kind: "class", source: wildcard });
    }
    case "?":
    case "*":
    case "+":
    case "{": {
      return refuse(
        reader,
        at,
        `${character} repeats what comes before it, and nothing does here; write \\${character} to match it`,
      );
    }
    case "}":
    case "]": {
      return refuse(
        reader,
        at,
        `${character} closes nothing here; write \\${character} to match it`,
      );
    }
    default: {
      reader.at += 1;

      return Result.succeed({ codePoint: character.codePointAt(0) ?? 0, kind: "character" });
    }
  }
};

/**
 * The most states a pattern's automaton holds, its accepting state included: 128.
 *
 * {@link matches} visits each state at most once per character, so a match costs at most 128 state
 * visits per character of the value whatever the pattern; the module doc gives the reckoning
 * against the longest value a host posts.
 */
export const maximumStates = 128;

/**
 * The most states a pattern's own pieces may take: {@link maximumStates} less the accepting state.
 */
const pieceBudget = BigInt(maximumStates - 1);

/**
 * The digits of {@link pieceBudget}, which a count's digits are measured against.
 */
const budgetDigits = String(pieceBudget);

/**
 * Whether a run of digits names a count past {@link pieceBudget}, the most copies any repetition
 * count may make.
 *
 * It measures the digits before they become a number: without its leading zeros, a run with more
 * digits than the budget's is past it however long, and one with as many compares as text. So a
 * count of a million digits costs a look at its length, never a conversion.
 *
 * @param digits The digits as written, empty for the missing bound of `{n,}`, which passes nothing.
 * @returns Whether the count passes the budget.
 */
const pastBudget = (digits: string): boolean => {
  const significant = digits.replace(/^0+(?=[0-9])/u, "");

  return (
    significant.length > budgetDigits.length ||
    (significant.length === budgetDigits.length && significant > budgetDigits)
  );
};

/**
 * Read an optional quantifier: `?`, `*`, `+`, `{n}`, `{n,}` or `{n,m}`.
 *
 * The counts are decimal integers written with any number of digits. One above
 * {@link pieceBudget} is refused, whatever it repeats, measured by its digits before it becomes a
 * number; the rest are written back without leading zeros and compared exactly: `{n,m}` needs n at
 * most m.
 *
 * @param reader The pattern being read, after an atom.
 * @param start The UTF-16 index of the atom, where a piece without a quantifier points.
 * @returns The count, once when no quantifier follows.
 */
const quantifier = (reader: Reader, start: number): Result.Result<Count, RegexRefused> => {
  const { at } = reader;
  const position = reader.offsets[at] ?? reader.pattern.length;
  const character = reader.chars[at];

  if (character === "?" || character === "*" || character === "+") {
    reader.at += 1;

    return Result.succeed({
      least: character === "+" ? 1n : 0n,
      most: character === "?" ? Option.some(1n) : Option.none(),
      position,
      source: character,
    });
  }

  if (character !== "{") {
    return Result.succeed({ least: 1n, most: Option.some(1n), position: start, source: "" });
  }

  const least = digitsFrom(reader, at + 1);
  const afterLeast = at + 1 + least.length;
  const bounded = reader.chars[afterLeast] !== ",";
  const most = bounded ? least : digitsFrom(reader, afterLeast + 1);
  const close = bounded ? afterLeast : afterLeast + 1 + most.length;

  if (least === "" || reader.chars[close] !== "}") {
    return refuse(
      reader,
      at,
      String.raw`a { after an atom opens a repetition count; write {n}, {n,} or {n,m} in whole numbers, or \{ to match a brace`,
    );
  }

  if (pastBudget(least) || pastBudget(most)) {
    return refuse(
      reader,
      at,
      `this repetition count is above ${pieceBudget}, the most a matcher of ${maximumStates} states takes whatever it repeats; lower it to ${pieceBudget} or less, or check the length another way`,
    );
  }

  if (most !== "" && BigInt(least) > BigInt(most)) {
    return refuse(
      reader,
      at,
      `the repetition count {${least},${most}} has its least above its most; write the smaller number first`,
    );
  }

  reader.at = close + 1;

  const fewest = BigInt(least);
  const upTo = most === "" ? Option.none() : Option.some(BigInt(most));

  return Result.succeed({
    least: fewest,
    most: upTo,
    position,
    source: bounded
      ? `{${fewest}}`
      : Option.match(upTo, { onNone: () => `{${fewest},}`, onSome: (top) => `{${fewest},${top}}` }),
  });
};

/**
 * Read a piece: an atom and its optional quantifier, which no second quantifier may follow.
 *
 * @param reader The pattern being read, at a character that is not `|` or `)`.
 * @returns The piece.
 */
const piece = (reader: Reader): Result.Result<Piece, RegexRefused> =>
  Result.gen(function* readPiece() {
    const start = reader.offsets[reader.at] ?? reader.pattern.length;
    const read = yield* atom(reader);
    const count = yield* quantifier(reader, start);
    const next = reader.chars[reader.at];

    if (count.source !== "" && (next === "?" || next === "+")) {
      return yield* refuse(
        reader,
        reader.at,
        `a quantifier followed by ${next} is ${next === "?" ? "lazy" : "possessive"}, which XML Schema does not have; remove the ${next}, or write \\${next} to match it`,
      );
    }

    if (count.source !== "" && (next === "*" || next === "{")) {
      return yield* refuse(
        reader,
        reader.at,
        "a quantifier cannot follow another; put the repeated piece in a group, (…), and quantify the group",
      );
    }

    return { atom: read, count };
  });

/**
 * Read a regular expression: branches separated by `|`, each a run of pieces.
 *
 * @param reader The pattern being read.
 * @returns The expression; the reader stops at a `)` or at the end of the pattern.
 */
const regularExpression = (reader: Reader): Result.Result<Expression, RegexRefused> =>
  Result.gen(function* readRegularExpression() {
    const branches: Branch[] = [];
    let position = reader.offsets[reader.at] ?? reader.pattern.length;
    let pieces: Piece[] = [];

    while (reader.at < reader.chars.length && reader.chars[reader.at] !== ")") {
      if (reader.chars[reader.at] === "|") {
        branches.push({ pieces, position });
        position = reader.offsets[reader.at] ?? reader.pattern.length;
        pieces = [];
        reader.at += 1;
      } else {
        pieces.push(yield* piece(reader));
      }
    }

    branches.push({ pieces, position });

    return branches;
  });

/**
 * Refuse a pattern whose automaton would pass {@link maximumStates}.
 *
 * @param pattern The pattern.
 * @param position The UTF-16 index of the quantifier or `|` that takes it past the limit.
 * @returns The refusal.
 */
const tooManyStates = (pattern: string, position: number): Result.Result<never, RegexRefused> =>
  Result.fail(
    new RegexRefused({
      pattern,
      position,
      reason: `here the pattern needs more than the ${maximumStates} states a matcher holds, as a repetition count copies what it repeats once per repetition; lower the count, repeat a shorter piece, or check the length another way`,
    }),
  );

/**
 * Count the states an atom's automaton takes.
 *
 * @param pattern The pattern, for a refusal.
 * @param read The atom.
 * @returns One for a character or a class, a group's own count, or the refusal of a group past
 *   the limit.
 */
const atomStates = (pattern: string, read: Atom): Result.Result<bigint, RegexRefused> =>
  // oxlint-disable-next-line eslint/no-use-before-define -- `atomStates` and `expressionStates` are mutually recursive, as groups nest; the call runs only after both are defined.
  read.kind === "group" ? expressionStates(pattern, read.expression) : Result.succeed(1n);

/**
 * Count the states a piece's automaton takes, its atom copied once per repetition.
 *
 * An atom of `a` states repeated `{n,m}` takes `n·a` for its required copies and `a + 1` for each
 * optional one, the extra state choosing between the copy and what follows; repeated `{n,}` it
 * takes `n·a + 1` (`a + 1` when n is 0), its last copy looping back through one choice. These are
 * the states {@link buildPiece} makes.
 *
 * @param pattern The pattern, for a refusal.
 * @param read The piece.
 * @returns The count, or the refusal at the quantifier when it passes the limit.
 */
const pieceStates = (pattern: string, read: Piece): Result.Result<bigint, RegexRefused> =>
  Result.flatMap(atomStates(pattern, read.atom), (one) => {
    const { least, most, position } = read.count;
    const states = Option.match(most, {
      onNone: () => (least > 0n ? least : 1n) * one + 1n,
      onSome: (top) => least * one + (top - least) * (one + 1n),
    });

    return states > pieceBudget ? tooManyStates(pattern, position) : Result.succeed(states);
  });

/**
 * Count the states an expression's automaton takes: its pieces' and one choice for each branch
 * after the first.
 *
 * @param pattern The pattern, for a refusal.
 * @param expression The expression.
 * @returns The count, or the refusal at the first piece or `|` that takes the running count past
 *   the limit.
 */
const expressionStates = (
  pattern: string,
  expression: Expression,
): Result.Result<bigint, RegexRefused> =>
  Result.gen(function* countExpression() {
    let total = 0n;

    for (const [index, branch] of expression.entries()) {
      total += index === 0 ? 0n : 1n;

      if (total > pieceBudget) {
        return yield* tooManyStates(pattern, branch.position);
      }

      for (const read of branch.pieces) {
        total += yield* pieceStates(pattern, read);

        if (total > pieceBudget) {
          return yield* tooManyStates(pattern, read.count.position);
        }
      }
    }

    return total;
  });

/**
 * Read a pattern by Appendix F's grammar, and refuse one whose automaton would pass
 * {@link maximumStates}.
 *
 * {@link translate} and {@link compile} both read through it, so they accept and refuse the same
 * patterns, at the same positions.
 *
 * @param pattern The pattern as the attribute holds it.
 * @returns The expression and its automaton's state count, the accepting state included, or the
 *   refusal.
 */
const parse = (
  pattern: string,
): Result.Result<{ readonly expression: Expression; readonly states: number }, RegexRefused> => {
  const chars: string[] = [];
  const offsets: number[] = [];
  let offset = 0;

  // A string iterates by code point, so a character outside the Basic Multilingual Plane is one.
  for (const character of pattern) {
    chars.push(character);
    offsets.push(offset);
    offset += character.length;
  }

  offsets.push(offset);

  const reader: Reader = { at: 0, chars, depth: 0, offsets, pattern };

  return Result.flatMap(regularExpression(reader), (expression) =>
    reader.at < chars.length
      ? refuse(
          reader,
          reader.at,
          String.raw`this ) closes no group; remove it, or write \) to match a parenthesis`,
        )
      : Result.map(expressionStates(pattern, expression), (states) => ({
          expression,
          states: Number(states) + 1,
        })),
  );
};

/**
 * Write an expression as the body of a `v`-flag JavaScript expression.
 *
 * @param expression The expression.
 * @returns Its translation, branches joined by `|`, each group non-capturing.
 */
const write = (expression: Expression): string =>
  expression
    .map(({ pieces }) =>
      pieces
        .map(({ atom: read, count }) => {
          switch (read.kind) {
            case "character": {
              return literal(read.codePoint) + count.source;
            }
            case "class": {
              return read.source + count.source;
            }
            case "group": {
              return `(?:${write(read.expression)})${count.source}`;
            }
            default: {
              return read satisfies never;
            }
          }
        })
        .join(""),
    )
    .join("|");

/**
 * Compile a translation, with the `v` flag unless other flags are given.
 *
 * The translation is valid ECMAScript by construction; an engine that still refuses it (one
 * without the `v` flag, or with a limit on repetition counts) fails as a refusal at the start of
 * the pattern, carrying the engine's message, so no exception leaves the translator.
 *
 * @param pattern The pattern, for the refusal.
 * @param source The translation.
 * @param flags The flags: `v` for a whole translation, and `vy` for a character class
 *   {@link matches} tests at one position through `lastIndex`.
 * @returns The expression, or the engine's refusal.
 */
const expressionOf = (
  pattern: string,
  source: string,
  flags = "v",
): Result.Result<RegExp, RegexRefused> =>
  Result.try({
    catch: (error) =>
      new RegexRefused({
        pattern,
        position: 0,
        reason: `this engine cannot compile its translation (${String(error)}); use an engine with the v flag, or lower the pattern's repetition counts`,
      }),
    try: () => new RegExp(source, flags),
  });

/**
 * Translate an XML Schema regular expression into a JavaScript expression that matches the same
 * strings: the whole pattern, anchored at both ends, with the `v` flag.
 *
 * It refuses every pattern {@link compile} refuses, those past {@link maximumStates} included, so a
 * pattern it accepts is one {@link matches} can check.
 *
 * @example
 *   translate("[0-9.]{0,6}"); // an expression that takes "12.5" and refuses "1234567"
 *
 * @param pattern The pattern as the attribute holds it, such as a `pattern-mask` value.
 * @returns The expression, or {@link RegexRefused} at the first character Appendix F's grammar
 *   refuses, or at the quantifier or `|` that takes its automaton past {@link maximumStates}.
 */
export const translate = (pattern: string): Result.Result<RegExp, RegexRefused> =>
  Result.flatMap(parse(pattern), ({ expression }) =>
    expressionOf(pattern, `^(?:${write(expression)})$`),
  );

/**
 * What a state of a {@link Matcher} does, by the number {@link Matcher.kinds} holds for it: take
 * one character equal to its code point, take one character in its class, choose between two
 * states, or accept.
 */
const kind = { accept: 3, character: 0, choice: 2, class: 1 } as const;

/**
 * The number of one of {@link kind}'s kinds of state.
 */
type Kind = (typeof kind)[keyof typeof kind];

/**
 * A compiled pattern: a Thompson automaton over code points, which {@link matches} simulates.
 *
 * State `i` is of kind `kinds[i]`. A character or class state goes to `next[i]` when it takes the
 * character: a character state when the character's code point is `operands[i]`, a class state
 * when `classes[operands[i]]` matches it. A choice state goes to both `next[i]` and
 * `alternatives[i]` without taking a character. The accepting state, `accepting`, goes nowhere;
 * the automaton starts at `start`. Only {@link matches} reads the fields.
 */
export interface Matcher {
  readonly accepting: number;
  readonly alternatives: Int32Array;
  /**
   * Each distinct class of the pattern, as a sticky expression that matches one code point at its
   * `lastIndex`; the copies a repetition count makes share one. {@link matches} sets `lastIndex`
   * before each test.
   */
  readonly classes: readonly RegExp[];
  readonly kinds: Uint8Array;
  readonly next: Int32Array;
  readonly operands: Int32Array;
  readonly pattern: string;
  readonly start: number;
  /**
   * How many states the automaton holds, the accepting state included: at most
   * {@link maximumStates}.
   */
  readonly states: number;
}

/**
 * An automaton being built: its states so far, and each class's index.
 */
interface Builder {
  readonly alternatives: number[];
  readonly classes: Map<string, number>;
  readonly kinds: Kind[];
  readonly next: number[];
  readonly operands: number[];
}

/**
 * Add a state.
 *
 * @param builder The automaton being built.
 * @param of What the state does.
 * @param operand Its code point or class index, 0 for a choice or the accepting state.
 * @param next The state it goes to, -1 for the accepting state or a choice whose first target is
 *   set later.
 * @param alternative A choice's second state, -1 otherwise.
 * @returns The new state's index.
 */
const add = (
  builder: Builder,
  of: Kind,
  operand: number,
  next: number,
  alternative: number,
): number => {
  builder.kinds.push(of);
  builder.operands.push(operand);
  builder.next.push(next);
  builder.alternatives.push(alternative);

  return builder.kinds.length - 1;
};

/**
 * Build an atom's states, ending at a state already built.
 *
 * @param builder The automaton being built.
 * @param read The atom.
 * @param next The state the atom goes to once it matches.
 * @returns The atom's first state.
 */
const buildAtom = (builder: Builder, read: Atom, next: number): number => {
  switch (read.kind) {
    case "character": {
      return add(builder, kind.character, read.codePoint, next, -1);
    }
    case "class": {
      const index = builder.classes.get(read.source) ?? builder.classes.size;

      builder.classes.set(read.source, index);

      return add(builder, kind.class, index, next, -1);
    }
    case "group": {
      // oxlint-disable-next-line eslint/no-use-before-define -- `buildAtom` and `buildExpression` are mutually recursive, as groups nest; the call runs only after both are defined.
      return buildExpression(builder, read.expression, next);
    }
    default: {
      return read satisfies never;
    }
  }
};

/**
 * Build a piece's states, one copy of its atom per repetition, ending at a state already built.
 *
 * `{n,m}` is n required copies then m − n optional ones, each optional copy behind a choice that
 * skips to `next`; `{n,}` loops its last copy back through a choice. {@link pieceStates} counts
 * the states this makes.
 *
 * Neither bound passes {@link pieceBudget} ({@link quantifier} refuses it), so each converts to a
 * number exactly and each loop runs at most 127 times. Each optional copy adds its choice, so the
 * state limit bounds those. A required copy of an atom that takes no state, a group that matches
 * only the empty text such as `()`, adds nothing and returns the state it was given, so the copies
 * after it would change nothing and are skipped: groups of that kind nested 100 deep under `{127}`
 * would otherwise be copied 127^100 times.
 *
 * @param builder The automaton being built.
 * @param read The piece.
 * @param next The state the piece goes to once it matches.
 * @returns The piece's first state.
 */
const buildPiece = (builder: Builder, read: Piece, next: number): number => {
  const least = Number(read.count.least);
  let first = next;
  let required = least;

  if (Option.isNone(read.count.most)) {
    const loop = add(builder, kind.choice, 0, -1, next);
    const body = buildAtom(builder, read.atom, loop);

    builder.next[loop] = body;
    first = least === 0 ? loop : body;
    required = Math.max(least - 1, 0);
  } else {
    for (let optional = Number(read.count.most.value) - least; optional > 0; optional -= 1) {
      first = add(builder, kind.choice, 0, buildAtom(builder, read.atom, first), next);
    }
  }

  for (; required > 0; required -= 1) {
    const built = builder.kinds.length;

    first = buildAtom(builder, read.atom, first);

    if (builder.kinds.length === built) {
      break;
    }
  }

  return first;
};

/**
 * Build an expression's states, ending at a state already built.
 *
 * @param builder The automaton being built.
 * @param expression The expression.
 * @param next The state the expression goes to once it matches.
 * @returns The expression's first state: its one branch's, or a choice among its branches'.
 */
const buildExpression = (builder: Builder, expression: Expression, next: number): number => {
  const firsts = expression.map(({ pieces }) => {
    let after = next;

    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      const read = pieces[index];

      after = read === undefined ? after : buildPiece(builder, read, after);
    }

    return after;
  });
  let first = firsts.at(-1) ?? next;

  for (let index = firsts.length - 2; index >= 0; index -= 1) {
    first = add(builder, kind.choice, 0, firsts[index] ?? next, first);
  }

  return first;
};

/**
 * Compile an XML Schema regular expression into a {@link Matcher}, which {@link matches} runs in
 * time linear in the value's length.
 *
 * It reads the pattern as {@link translate} does and refuses the same patterns, those whose
 * automaton would pass {@link maximumStates} included.
 *
 * @example
 *   Result.map(compile("(a+)+b"), (matcher) => matches(matcher, "a".repeat(100_000))); // succeed(false), at once
 *
 * @param pattern The pattern as the attribute holds it, such as a `pattern-mask` value.
 * @returns The matcher, or {@link RegexRefused} at the first character Appendix F's grammar
 *   refuses, or at the quantifier or `|` that takes its automaton past {@link maximumStates}.
 */
export const compile = (pattern: string): Result.Result<Matcher, RegexRefused> =>
  Result.gen(function* compilePattern() {
    const { expression } = yield* parse(pattern);
    const builder: Builder = {
      alternatives: [],
      classes: new Map(),
      kinds: [],
      next: [],
      operands: [],
    };
    const accepting = add(builder, kind.accept, 0, -1, -1);
    const start = buildExpression(builder, expression, accepting);
    const classes = yield* Result.all(
      Array.from(builder.classes.keys(), (source) => expressionOf(pattern, source, "vy")),
    );

    return {
      accepting,
      alternatives: Int32Array.from(builder.alternatives),
      classes,
      kinds: Uint8Array.from(builder.kinds),
      next: Int32Array.from(builder.next),
      operands: Int32Array.from(builder.operands),
      pattern,
      start,
      states: builder.kinds.length,
    };
  });

/**
 * Add a state and every state its choices reach without taking a character to a list, skipping
 * those already marked in this generation.
 *
 * @param matcher The automaton.
 * @param scratch The marks and the stack: `marks` holds each state's generation when last added,
 *   and `pending` the states still to follow, one slot per state.
 * @param scratch.marks Each state's generation when last added.
 * @param scratch.pending The states still to follow, one slot per state.
 * @param list The list, whose first `length` entries are taken.
 * @param length How many entries of `list` are taken.
 * @param from The state to add.
 * @param generation The current generation.
 * @returns How many entries of `list` are taken after the character and class states reached.
 */
const close = (
  matcher: Matcher,
  { marks, pending }: { readonly marks: Uint32Array; readonly pending: Int32Array },
  list: Int32Array,
  length: number,
  from: number,
  generation: number,
): number => {
  const { alternatives, kinds, next } = matcher;
  let taken = length;
  let top = 0;

  if (marks[from] !== generation) {
    marks[from] = generation;
    pending[top] = from;
    top += 1;
  }

  while (top > 0) {
    top -= 1;

    const state = pending[top] ?? 0;
    const of = kinds[state];

    if (of === kind.choice) {
      const first = next[state] ?? 0;
      const second = alternatives[state] ?? 0;

      if (marks[first] !== generation) {
        marks[first] = generation;
        pending[top] = first;
        top += 1;
      }

      if (marks[second] !== generation) {
        marks[second] = generation;
        pending[top] = second;
        top += 1;
      }
    } else if (of !== kind.accept) {
      list[taken] = state;
      taken += 1;
    }
  }

  return taken;
};

/**
 * Report whether a value matches a compiled pattern as a whole, the pattern anchored at both ends.
 *
 * The value is read once, by code point, keeping the set of states the characters so far reach, so
 * it takes at most {@link Matcher.states} steps per character and never backtracks: `(a+)+b`
 * against 100,000 `a`s answers at once. A class is tested at most once per character however many
 * states share it.
 *
 * @example
 *   Result.map(compile("[0-9.]{0,6}"), (matcher) => matches(matcher, "12.5")); // succeed(true)
 *
 * @param matcher The compiled pattern.
 * @param value The text to match.
 * @returns Whether the whole value matches.
 */
export const matches = (matcher: Matcher, value: string): boolean => {
  const { classes, kinds, next, operands } = matcher;
  const scratch = {
    marks: new Uint32Array(matcher.states),
    pending: new Int32Array(matcher.states),
  };
  const { marks } = scratch;
  const tested = new Uint32Array(classes.length);
  const taken = new Uint8Array(classes.length);
  let current = new Int32Array(matcher.states);
  let following = new Int32Array(matcher.states);
  let generation = 1;
  let length = close(matcher, scratch, current, 0, matcher.start, generation);

  for (let at = 0; at < value.length; at += 1) {
    if (length === 0) {
      return false;
    }

    generation += 1;

    const codePoint = value.codePointAt(at) ?? 0;
    let reached = 0;

    for (let index = 0; index < length; index += 1) {
      const state = current[index] ?? 0;
      const operand = operands[state] ?? 0;
      const target = next[state] ?? 0;

      if (kinds[state] !== kind.character && tested[operand] !== generation) {
        const expression = classes[operand];

        tested[operand] = generation;

        if (expression !== undefined) {
          expression.lastIndex = at;
          taken[operand] = expression.test(value) ? 1 : 0;
        }
      }

      if (
        marks[target] !== generation &&
        (kinds[state] === kind.character ? operand === codePoint : taken[operand] === 1)
      ) {
        if (kinds[target] === kind.character || kinds[target] === kind.class) {
          marks[target] = generation;
          following[reached] = target;
          reached += 1;
        } else {
          reached = close(matcher, scratch, following, reached, target, generation);
        }
      }
    }

    [current, following] = [following, current];
    length = reached;
    at += codePoint > 0xff_ff ? 1 : 0;
  }

  return marks[matcher.accepting] === generation;
};
