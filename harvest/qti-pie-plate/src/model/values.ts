/**
 * QTI values and NULL as the value model holds them: a base type, a cardinality and the values,
 * with the lexical parse and format of each base type and the equality `qti-match` uses. A record
 * is its own type, {@link RecordValue}: named fields, each a single, with no base type of its own.
 *
 * The session record, the engine and the form encoding all carry a {@link Value}, and a record
 * response's {@link RecordValue} beside it, so this module owns the one value representation, and
 * the one NCName rule the validator reuses.
 *
 * @module
 */
import { Data, Option, Result } from "effect";

/**
 * The base types the value model holds values of: every QTI base type but `file`.
 */
export const modelledBaseTypes = [
  "identifier",
  "boolean",
  "integer",
  "float",
  "string",
  "point",
  "pair",
  "directedPair",
  "duration",
  "uri",
] as const;

/**
 * A base type the value model holds values of.
 */
export type ModelledBaseType = (typeof modelledBaseTypes)[number];

/**
 * The cardinalities a {@link Value} holds. A record is its own type, {@link RecordValue}, since its
 * fields each carry their own base type.
 */
export const modelledCardinalities = ["single", "multiple", "ordered"] as const;

/**
 * Report whether the value model holds values of a base type.
 *
 * `file` is a valid QTI base type the value model does not hold, so its declarations are marked
 * unsupported rather than refused.
 *
 * @param baseType A `base-type` attribute value.
 * @returns Whether `baseType` is a {@link ModelledBaseType}.
 */
export const isModelled = (baseType: string): baseType is ModelledBaseType =>
  modelledBaseTypes.some((name) => name === baseType);

/**
 * A range of code points, its first and its last.
 */
type CodeRange = readonly [first: number, last: number];

/**
 * The body of a `u`-flag character class: each range of code points as `\u{…}-\u{…}`, so a range
 * holds exactly its code points whatever characters they are.
 *
 * @param ranges Ranges of code points, each its first and last.
 * @returns The class's body, which `[${…}]` encloses.
 */
const classBody = (ranges: readonly CodeRange[]): string =>
  ranges.map(([first, last]) => `\\u{${first.toString(16)}}-\\u{${last.toString(16)}}`).join("");

/**
 * The body of the character class of a `pattern-mask`'s `\i`: XML 1.0 (Fifth Edition)'s
 * `NameStartChar` without the colon, written as the inside of a `u`-flag character class, so
 * `[${nameStartClass}]` matches one such character. Each range is a range of code points.
 *
 * The XSD regular-expression translator builds `\i` from it, by reading 55's own decision that a
 * `pattern-mask` takes the later edition. An NCName does not (reading 94): {@link isNcName} reads
 * the Second Edition's tables.
 *
 * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-NameStartChar
 */
export const nameStartClass = String.raw`A-Z_a-z\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{2FF}\u{370}-\u{37D}\u{37F}-\u{1FFF}\u{200C}-\u{200D}\u{2070}-\u{218F}\u{2C00}-\u{2FEF}\u{3001}-\u{D7FF}\u{F900}-\u{FDCF}\u{FDF0}-\u{FFFD}\u{10000}-\u{EFFFF}`;

/**
 * The body of the character class of a `pattern-mask`'s `\c`: XML 1.0 (Fifth Edition)'s
 * `NameChar` without the colon, written as the inside of a `u`-flag character class, so
 * `[${nameClass}]` matches one such character. Each range is a range of code points.
 *
 * The XSD regular-expression translator builds `\c` from it, by reading 55's own decision, as it
 * builds `\i` from {@link nameStartClass}. An NCName does not take it (reading 94).
 *
 * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-NameChar
 */
export const nameClass = String.raw`-.0-9A-Z_a-z\u{B7}\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{37D}\u{37F}-\u{1FFF}\u{200C}-\u{200D}\u{203F}-\u{2040}\u{2070}-\u{218F}\u{2C00}-\u{2FEF}\u{3001}-\u{D7FF}\u{F900}-\u{FDCF}\u{FDF0}-\u{FFFD}\u{10000}-\u{EFFFF}`;

/**
 * XML 1.0 (Second Edition)'s `BaseChar` (Appendix B, production 85), as the specification lists
 * it. XML 1.0 (Fifth Edition) keeps the same tables in its Appendix B, no longer used for its own
 * names.
 *
 * @see https://www.w3.org/TR/2000/REC-xml-20001006#CharClasses
 */
const baseChar: readonly CodeRange[] = [
  [0x41, 0x5a],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0xff],
  [0x1_00, 0x1_31],
  [0x1_34, 0x1_3e],
  [0x1_41, 0x1_48],
  [0x1_4a, 0x1_7e],
  [0x1_80, 0x1_c3],
  [0x1_cd, 0x1_f0],
  [0x1_f4, 0x1_f5],
  [0x1_fa, 0x2_17],
  [0x2_50, 0x2_a8],
  [0x2_bb, 0x2_c1],
  [0x3_86, 0x3_86],
  [0x3_88, 0x3_8a],
  [0x3_8c, 0x3_8c],
  [0x3_8e, 0x3_a1],
  [0x3_a3, 0x3_ce],
  [0x3_d0, 0x3_d6],
  [0x3_da, 0x3_da],
  [0x3_dc, 0x3_dc],
  [0x3_de, 0x3_de],
  [0x3_e0, 0x3_e0],
  [0x3_e2, 0x3_f3],
  [0x4_01, 0x4_0c],
  [0x4_0e, 0x4_4f],
  [0x4_51, 0x4_5c],
  [0x4_5e, 0x4_81],
  [0x4_90, 0x4_c4],
  [0x4_c7, 0x4_c8],
  [0x4_cb, 0x4_cc],
  [0x4_d0, 0x4_eb],
  [0x4_ee, 0x4_f5],
  [0x4_f8, 0x4_f9],
  [0x5_31, 0x5_56],
  [0x5_59, 0x5_59],
  [0x5_61, 0x5_86],
  [0x5_d0, 0x5_ea],
  [0x5_f0, 0x5_f2],
  [0x6_21, 0x6_3a],
  [0x6_41, 0x6_4a],
  [0x6_71, 0x6_b7],
  [0x6_ba, 0x6_be],
  [0x6_c0, 0x6_ce],
  [0x6_d0, 0x6_d3],
  [0x6_d5, 0x6_d5],
  [0x6_e5, 0x6_e6],
  [0x9_05, 0x9_39],
  [0x9_3d, 0x9_3d],
  [0x9_58, 0x9_61],
  [0x9_85, 0x9_8c],
  [0x9_8f, 0x9_90],
  [0x9_93, 0x9_a8],
  [0x9_aa, 0x9_b0],
  [0x9_b2, 0x9_b2],
  [0x9_b6, 0x9_b9],
  [0x9_dc, 0x9_dd],
  [0x9_df, 0x9_e1],
  [0x9_f0, 0x9_f1],
  [0xa_05, 0xa_0a],
  [0xa_0f, 0xa_10],
  [0xa_13, 0xa_28],
  [0xa_2a, 0xa_30],
  [0xa_32, 0xa_33],
  [0xa_35, 0xa_36],
  [0xa_38, 0xa_39],
  [0xa_59, 0xa_5c],
  [0xa_5e, 0xa_5e],
  [0xa_72, 0xa_74],
  [0xa_85, 0xa_8b],
  [0xa_8d, 0xa_8d],
  [0xa_8f, 0xa_91],
  [0xa_93, 0xa_a8],
  [0xa_aa, 0xa_b0],
  [0xa_b2, 0xa_b3],
  [0xa_b5, 0xa_b9],
  [0xa_bd, 0xa_bd],
  [0xa_e0, 0xa_e0],
  [0xb_05, 0xb_0c],
  [0xb_0f, 0xb_10],
  [0xb_13, 0xb_28],
  [0xb_2a, 0xb_30],
  [0xb_32, 0xb_33],
  [0xb_36, 0xb_39],
  [0xb_3d, 0xb_3d],
  [0xb_5c, 0xb_5d],
  [0xb_5f, 0xb_61],
  [0xb_85, 0xb_8a],
  [0xb_8e, 0xb_90],
  [0xb_92, 0xb_95],
  [0xb_99, 0xb_9a],
  [0xb_9c, 0xb_9c],
  [0xb_9e, 0xb_9f],
  [0xb_a3, 0xb_a4],
  [0xb_a8, 0xb_aa],
  [0xb_ae, 0xb_b5],
  [0xb_b7, 0xb_b9],
  [0xc_05, 0xc_0c],
  [0xc_0e, 0xc_10],
  [0xc_12, 0xc_28],
  [0xc_2a, 0xc_33],
  [0xc_35, 0xc_39],
  [0xc_60, 0xc_61],
  [0xc_85, 0xc_8c],
  [0xc_8e, 0xc_90],
  [0xc_92, 0xc_a8],
  [0xc_aa, 0xc_b3],
  [0xc_b5, 0xc_b9],
  [0xc_de, 0xc_de],
  [0xc_e0, 0xc_e1],
  [0xd_05, 0xd_0c],
  [0xd_0e, 0xd_10],
  [0xd_12, 0xd_28],
  [0xd_2a, 0xd_39],
  [0xd_60, 0xd_61],
  [0xe_01, 0xe_2e],
  [0xe_30, 0xe_30],
  [0xe_32, 0xe_33],
  [0xe_40, 0xe_45],
  [0xe_81, 0xe_82],
  [0xe_84, 0xe_84],
  [0xe_87, 0xe_88],
  [0xe_8a, 0xe_8a],
  [0xe_8d, 0xe_8d],
  [0xe_94, 0xe_97],
  [0xe_99, 0xe_9f],
  [0xe_a1, 0xe_a3],
  [0xe_a5, 0xe_a5],
  [0xe_a7, 0xe_a7],
  [0xe_aa, 0xe_ab],
  [0xe_ad, 0xe_ae],
  [0xe_b0, 0xe_b0],
  [0xe_b2, 0xe_b3],
  [0xe_bd, 0xe_bd],
  [0xe_c0, 0xe_c4],
  [0xf_40, 0xf_47],
  [0xf_49, 0xf_69],
  [0x10_a0, 0x10_c5],
  [0x10_d0, 0x10_f6],
  [0x11_00, 0x11_00],
  [0x11_02, 0x11_03],
  [0x11_05, 0x11_07],
  [0x11_09, 0x11_09],
  [0x11_0b, 0x11_0c],
  [0x11_0e, 0x11_12],
  [0x11_3c, 0x11_3c],
  [0x11_3e, 0x11_3e],
  [0x11_40, 0x11_40],
  [0x11_4c, 0x11_4c],
  [0x11_4e, 0x11_4e],
  [0x11_50, 0x11_50],
  [0x11_54, 0x11_55],
  [0x11_59, 0x11_59],
  [0x11_5f, 0x11_61],
  [0x11_63, 0x11_63],
  [0x11_65, 0x11_65],
  [0x11_67, 0x11_67],
  [0x11_69, 0x11_69],
  [0x11_6d, 0x11_6e],
  [0x11_72, 0x11_73],
  [0x11_75, 0x11_75],
  [0x11_9e, 0x11_9e],
  [0x11_a8, 0x11_a8],
  [0x11_ab, 0x11_ab],
  [0x11_ae, 0x11_af],
  [0x11_b7, 0x11_b8],
  [0x11_ba, 0x11_ba],
  [0x11_bc, 0x11_c2],
  [0x11_eb, 0x11_eb],
  [0x11_f0, 0x11_f0],
  [0x11_f9, 0x11_f9],
  [0x1e_00, 0x1e_9b],
  [0x1e_a0, 0x1e_f9],
  [0x1f_00, 0x1f_15],
  [0x1f_18, 0x1f_1d],
  [0x1f_20, 0x1f_45],
  [0x1f_48, 0x1f_4d],
  [0x1f_50, 0x1f_57],
  [0x1f_59, 0x1f_59],
  [0x1f_5b, 0x1f_5b],
  [0x1f_5d, 0x1f_5d],
  [0x1f_5f, 0x1f_7d],
  [0x1f_80, 0x1f_b4],
  [0x1f_b6, 0x1f_bc],
  [0x1f_be, 0x1f_be],
  [0x1f_c2, 0x1f_c4],
  [0x1f_c6, 0x1f_cc],
  [0x1f_d0, 0x1f_d3],
  [0x1f_d6, 0x1f_db],
  [0x1f_e0, 0x1f_ec],
  [0x1f_f2, 0x1f_f4],
  [0x1f_f6, 0x1f_fc],
  [0x21_26, 0x21_26],
  [0x21_2a, 0x21_2b],
  [0x21_2e, 0x21_2e],
  [0x21_80, 0x21_82],
  [0x30_41, 0x30_94],
  [0x30_a1, 0x30_fa],
  [0x31_05, 0x31_2c],
  [0xac_00, 0xd7_a3],
];

/**
 * XML 1.0 (Second Edition)'s `Ideographic` (Appendix B, production 86).
 */
const ideographic: readonly CodeRange[] = [
  [0x4e_00, 0x9f_a5],
  [0x30_07, 0x30_07],
  [0x30_21, 0x30_29],
];

/**
 * XML 1.0 (Second Edition)'s `CombiningChar` (Appendix B, production 87).
 */
const combiningChar: readonly CodeRange[] = [
  [0x3_00, 0x3_45],
  [0x3_60, 0x3_61],
  [0x4_83, 0x4_86],
  [0x5_91, 0x5_a1],
  [0x5_a3, 0x5_b9],
  [0x5_bb, 0x5_bd],
  [0x5_bf, 0x5_bf],
  [0x5_c1, 0x5_c2],
  [0x5_c4, 0x5_c4],
  [0x6_4b, 0x6_52],
  [0x6_70, 0x6_70],
  [0x6_d6, 0x6_dc],
  [0x6_dd, 0x6_df],
  [0x6_e0, 0x6_e4],
  [0x6_e7, 0x6_e8],
  [0x6_ea, 0x6_ed],
  [0x9_01, 0x9_03],
  [0x9_3c, 0x9_3c],
  [0x9_3e, 0x9_4c],
  [0x9_4d, 0x9_4d],
  [0x9_51, 0x9_54],
  [0x9_62, 0x9_63],
  [0x9_81, 0x9_83],
  [0x9_bc, 0x9_bc],
  [0x9_be, 0x9_be],
  [0x9_bf, 0x9_bf],
  [0x9_c0, 0x9_c4],
  [0x9_c7, 0x9_c8],
  [0x9_cb, 0x9_cd],
  [0x9_d7, 0x9_d7],
  [0x9_e2, 0x9_e3],
  [0xa_02, 0xa_02],
  [0xa_3c, 0xa_3c],
  [0xa_3e, 0xa_3e],
  [0xa_3f, 0xa_3f],
  [0xa_40, 0xa_42],
  [0xa_47, 0xa_48],
  [0xa_4b, 0xa_4d],
  [0xa_70, 0xa_71],
  [0xa_81, 0xa_83],
  [0xa_bc, 0xa_bc],
  [0xa_be, 0xa_c5],
  [0xa_c7, 0xa_c9],
  [0xa_cb, 0xa_cd],
  [0xb_01, 0xb_03],
  [0xb_3c, 0xb_3c],
  [0xb_3e, 0xb_43],
  [0xb_47, 0xb_48],
  [0xb_4b, 0xb_4d],
  [0xb_56, 0xb_57],
  [0xb_82, 0xb_83],
  [0xb_be, 0xb_c2],
  [0xb_c6, 0xb_c8],
  [0xb_ca, 0xb_cd],
  [0xb_d7, 0xb_d7],
  [0xc_01, 0xc_03],
  [0xc_3e, 0xc_44],
  [0xc_46, 0xc_48],
  [0xc_4a, 0xc_4d],
  [0xc_55, 0xc_56],
  [0xc_82, 0xc_83],
  [0xc_be, 0xc_c4],
  [0xc_c6, 0xc_c8],
  [0xc_ca, 0xc_cd],
  [0xc_d5, 0xc_d6],
  [0xd_02, 0xd_03],
  [0xd_3e, 0xd_43],
  [0xd_46, 0xd_48],
  [0xd_4a, 0xd_4d],
  [0xd_57, 0xd_57],
  [0xe_31, 0xe_31],
  [0xe_34, 0xe_3a],
  [0xe_47, 0xe_4e],
  [0xe_b1, 0xe_b1],
  [0xe_b4, 0xe_b9],
  [0xe_bb, 0xe_bc],
  [0xe_c8, 0xe_cd],
  [0xf_18, 0xf_19],
  [0xf_35, 0xf_35],
  [0xf_37, 0xf_37],
  [0xf_39, 0xf_39],
  [0xf_3e, 0xf_3e],
  [0xf_3f, 0xf_3f],
  [0xf_71, 0xf_84],
  [0xf_86, 0xf_8b],
  [0xf_90, 0xf_95],
  [0xf_97, 0xf_97],
  [0xf_99, 0xf_ad],
  [0xf_b1, 0xf_b7],
  [0xf_b9, 0xf_b9],
  [0x20_d0, 0x20_dc],
  [0x20_e1, 0x20_e1],
  [0x30_2a, 0x30_2f],
  [0x30_99, 0x30_99],
  [0x30_9a, 0x30_9a],
];

/**
 * XML 1.0 (Second Edition)'s `Digit` (Appendix B, production 88).
 */
const xmlDigit: readonly CodeRange[] = [
  [0x30, 0x39],
  [0x6_60, 0x6_69],
  [0x6_f0, 0x6_f9],
  [0x9_66, 0x9_6f],
  [0x9_e6, 0x9_ef],
  [0xa_66, 0xa_6f],
  [0xa_e6, 0xa_ef],
  [0xb_66, 0xb_6f],
  [0xb_e7, 0xb_ef],
  [0xc_66, 0xc_6f],
  [0xc_e6, 0xc_ef],
  [0xd_66, 0xd_6f],
  [0xe_50, 0xe_59],
  [0xe_d0, 0xe_d9],
  [0xf_20, 0xf_29],
];

/**
 * XML 1.0 (Second Edition)'s `Extender` (Appendix B, production 89).
 */
const extender: readonly CodeRange[] = [
  [0xb7, 0xb7],
  [0x2_d0, 0x2_d0],
  [0x2_d1, 0x2_d1],
  [0x3_87, 0x3_87],
  [0x6_40, 0x6_40],
  [0xe_46, 0xe_46],
  [0xe_c6, 0xe_c6],
  [0x30_05, 0x30_05],
  [0x30_31, 0x30_35],
  [0x30_9d, 0x30_9e],
  [0x30_fc, 0x30_fe],
];

/**
 * The characters an NCName may start with: the Second Edition's `Letter` (`BaseChar |
 * Ideographic`, production 84) and `_`.
 */
const ncNameStart: readonly CodeRange[] = [...baseChar, ...ideographic, [0x5f, 0x5f]];

/**
 * The characters an NCName may hold after its first, Namespaces in XML 1.0's `NCNameChar`: a
 * `Letter`, a `Digit`, `.`, `-`, `_`, a `CombiningChar` or an `Extender`.
 */
const ncNameCharacter: readonly CodeRange[] = [
  ...ncNameStart,
  ...xmlDigit,
  ...combiningChar,
  ...extender,
  [0x2d, 0x2e],
];

/**
 * An NCName as XML Schema 1.0 reads `xs:NCName`: Namespaces in XML 1.0's `(Letter | '_')
 * (NCNameChar)*` over XML 1.0 (Second Edition)'s tables, reading 94 ("An `xs:NCName` takes its
 * name characters from XML 1.0 Second Edition, as XML Schema 1.0 reads them, and the production
 * states no length"). XML Schema Part 2 defines `\i` and `\c` by that edition (Appendix F.1.1), so
 * the Fifth Edition's wider ranges are no part of it: a letter Unicode assigned after version 2.0
 * (U+3400), a supplementary character (U+10000), a letter the Second Edition leaves out (U+0132),
 * and a digit, combining character or extender written first (U+0660, U+02D0) are refused, as
 * libxml2's `xmllint` refuses them. The `u` flag makes each range a range of code points, so a
 * character outside the Basic Multilingual Plane is one character and a lone surrogate matches no
 * range.
 *
 * @see https://www.w3.org/TR/1999/REC-xml-names-19990114/#NT-NCName
 * @see https://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#NCName
 */
const ncName = new RegExp(`^[${classBody(ncNameStart)}][${classBody(ncNameCharacter)}]*$`, "u");

/**
 * Report whether text is an XML NCName, the lexical space of a QTI identifier and of every type
 * derived from `xs:NCName`, read by XML 1.0 (Second Edition)'s tables (reading 94). A value that is
 * not one names nothing (reading 152, "A value names something only where it is an NCName").
 *
 * @param text The text as written; no whitespace is removed first.
 * @returns Whether `text` is an NCName.
 */
export const isNcName = (text: string): boolean => ncName.test(text);

/**
 * The 26 grandfathered tags of RFC 5646's `irregular` and `regular` productions (section 2.1,
 * Figure 1), in lower case, the case {@link isLanguageTag} compares in.
 */
const grandfatheredTags = [
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "art-lojban",
  "cel-gaulish",
  "no-bok",
  "no-nyn",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
];

/**
 * RFC 5646's `Language-Tag` (section 2.1, Figure 1) over lower-case ASCII: a `langtag` (a
 * language, then an optional script and region, variants, extensions and a private-use part), a
 * `privateuse` tag, or a grandfathered one. Its repetitions are unbounded, as the ABNF's `*` is.
 * Each subtag ends at a hyphen or the end and its length and kind decide which production takes
 * it, so a failed match backtracks over a bounded few choices per subtag.
 *
 * @see https://www.rfc-editor.org/rfc/rfc5646#section-2.1
 */
const languageTag = new RegExp(
  [
    "^(?:",
    "(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})",
    "(?:-[a-z]{4})?",
    "(?:-(?:[a-z]{2}|[0-9]{3}))?",
    "(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*",
    "(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*",
    "(?:-x(?:-[a-z0-9]{1,8})+)?",
    "|x(?:-[a-z0-9]{1,8})+",
    `|${grandfatheredTags.join("|")}`,
    ")$",
  ].join(""),
  "u",
);

/**
 * The characters a language tag is written in: ASCII letters, digits and hyphens. Checked before
 * the text is put in lower case, since lower case maps a few other characters to ASCII letters:
 * KELVIN SIGN (U+212A) becomes `k`.
 */
const languageTagCharacters = /^[-0-9A-Za-z]*$/u;

/**
 * Report whether text is a well-formed BCP 47 language tag, as RFC 5646 defines one, reading 129
 * ("`xml:lang`, `lang` and a track's `srclang` hold BCP 47 language tags, well-formed as RFC 5646
 * defines them"): a `langtag`, a private-use tag such as `x-none`, or one of the 26 grandfathered
 * tags. Tags "are to be treated as case insensitive" (section 2.1.1), so `EN-us` is one, and
 * "Whitespace is not permitted in a language tag" (section 2.1), so `en ` is not.
 *
 * Well-formedness is the whole check. A tag is valid when its subtags are in the IANA Language
 * Subtag Registry and it repeats no variant or singleton (section 2.2.9); that is reading 129's
 * stated limit, so `qq-ZZ` and `de-1996-1996` are tags. The empty string is no tag: an attribute
 * that may be empty, such as `xml:lang`, admits it before asking this.
 *
 * @param text The text as written; no whitespace is removed first.
 * @returns Whether `text` is a well-formed language tag.
 * @see https://www.rfc-editor.org/rfc/rfc5646#section-2.2.9
 */
export const isLanguageTag = (text: string): boolean =>
  languageTagCharacters.test(text) && languageTag.test(text.toLowerCase());

/**
 * Report whether a character is XML whitespace: space, tab, carriage return or line feed. No other
 * character counts, so a no-break space stays part of the value it pads.
 *
 * @param character One character of the text.
 * @returns Whether it is one of the four.
 */
const isXmlSpace = (character: string): boolean =>
  character === " " || character === "\t" || character === "\n" || character === "\r";

/**
 * Remove outer XML whitespace from text, stepping in from each end once, so the time is linear in
 * the length of the text.
 *
 * Element text sheds it before {@link parseElementText} reads a value, and an XSD-typed attribute
 * value before its lexical check.
 *
 * @param text The text as written.
 * @returns The text without its leading and trailing XML whitespace.
 */
export const trimXmlSpace = (text: string): string => {
  let start = 0;
  let end = text.length;
  while (start < end && isXmlSpace(text.charAt(start))) {
    start += 1;
  }

  while (end > start && isXmlSpace(text.charAt(end - 1))) {
    end -= 1;
  }

  return text.slice(start, end);
};

/**
 * Two runs of non-whitespace separated by XML whitespace: the lexical form of a pair, before each
 * side is checked as an NCName.
 */
const pairLexical = /^(?<source>[^\t\n\r ]+)[\t\n\r ]+(?<destination>[^\t\n\r ]+)$/u;

/**
 * The lexical form of a point: two integers, each as {@link integerLexical} writes one, separated
 * by XML whitespace, the horizontal coordinate first.
 *
 * QTI 3.0 calls a point an integer tuple and states no range for its coordinates, so each is held
 * exactly at any size, as an integer is (reading 45).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Enumerated_BaseTypeEnum
 */
const pointLexical = /^(?<x>[+-]?[0-9]+)[\t\n\r ]+(?<y>[+-]?[0-9]+)$/u;

/**
 * The lexical space of a QTI integer, and of `xs:integer`: an optional sign and ASCII digits, as
 * many as written.
 *
 * QTI 3.0 states no range for its integer base type (the integer primitive type is "derived from
 * the decimal data-type"), so the value model holds every integer exactly, as a `bigint`
 * (operator reading A).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#AppA1
 * @see https://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#integer
 */
export const integerLexical = /^[+-]?[0-9]+$/u;

/**
 * The lexical space of `xs:decimal`: an optional sign and digits with at most one decimal point,
 * at least one digit in all.
 *
 * @see https://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#decimal
 */
export const decimalLexical = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u;

/**
 * The lexical space of `xs:double` (XML Schema 1.0), which a QTI float uses: a decimal with an
 * optional exponent, `INF`, `-INF` or `NaN`.
 *
 * @see https://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#double
 */
export const doubleLexical =
  /^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?|-?INF|NaN)$/u;

/**
 * One QTI value, tagged by its base type: a string for `identifier`, `string` and `uri`; a
 * `bigint` for `integer`; a number for `float`; a boolean for `boolean`; two `bigint`s for `point`,
 * the horizontal coordinate first; two identifiers for `pair` and `directedPair`, the source
 * first; and a number of seconds for `duration`.
 *
 * An integer, and each coordinate of a point, is exact at any size. A float is an xs:double. A
 * duration is its seconds in an xs:double, never truncated (readings 29 and 68; G-R3, pending: a
 * duration is a number of seconds, written as a float is). It is not numerical (G-R1, pending): no
 * arithmetic takes one. `SingleSchema` in `#plate/codec/values.ts` checks and encodes this type at
 * the boundaries.
 */
export type Single =
  | { readonly baseType: "identifier"; readonly value: string }
  | { readonly baseType: "boolean"; readonly value: boolean }
  | { readonly baseType: "integer"; readonly value: bigint }
  | { readonly baseType: "float"; readonly value: number }
  | { readonly baseType: "string"; readonly value: string }
  | { readonly baseType: "point"; readonly value: readonly [bigint, bigint] }
  | { readonly baseType: "pair"; readonly value: readonly [string, string] }
  | { readonly baseType: "directedPair"; readonly value: readonly [string, string] }
  | { readonly baseType: "duration"; readonly value: number }
  | { readonly baseType: "uri"; readonly value: string };

/**
 * A QTI value of a modelled base type, as the session record, the engine and the form encoding
 * carry it: a base type, a cardinality and its values, none for NULL.
 *
 * NULL is `values: []` at any cardinality, because QTI treats an empty string and an empty
 * container as NULL; there is no other spelling of NULL, so an empty string is never one of the
 * values. A `single` holds at most one value, and every value carries the value's own base type.
 * `ValueSchema` in `#plate/codec/values.ts` checks these rules at the boundaries.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Variables
 */
export interface Value {
  readonly baseType: ModelledBaseType;
  readonly cardinality: (typeof modelledCardinalities)[number];
  readonly values: readonly Single[];
}

/**
 * One field of a {@link RecordValue}: its identifier, an NCName, and its value, a single of a
 * modelled base type. A NULL field is no field, so a field always holds a value.
 */
export interface RecordField {
  readonly identifier: string;
  readonly value: Single;
}

/**
 * A QTI value of cardinality `record`, as a record response holds it: its fields, each named once.
 *
 * A record has no base type of its own; each field carries its own. A NULL field is no field, and a
 * record with no field is NULL, so there is one spelling of NULL here too. The order of the fields
 * means nothing ({@link sameRecord}). `RecordValueSchema` in `#plate/codec/values.ts` checks these
 * rules at the boundaries.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Variables
 */
export interface RecordValue {
  readonly cardinality: "record";
  readonly fields: readonly RecordField[];
}

/**
 * The value a response holds: a {@link Value} of a modelled base type and cardinality, or a
 * {@link RecordValue}.
 */
export type ResponseValue = Value | RecordValue;

/**
 * Report whether a response's value is a record.
 *
 * @param value The value to test.
 * @returns Whether `value` is a {@link RecordValue}.
 */
export const isRecordValue = (value: ResponseValue): value is RecordValue =>
  value.cardinality === "record";

/**
 * Construct the NULL value of a base type and cardinality.
 *
 * @param baseType The value's base type.
 * @param cardinality The value's cardinality.
 * @returns The value with no values.
 */
export const nullOf = (baseType: ModelledBaseType, cardinality: Value["cardinality"]): Value => ({
  baseType,
  cardinality,
  values: [],
});

/**
 * The NULL record: a record with no field, since a NULL field is no field.
 */
export const nullRecord: RecordValue = { cardinality: "record", fields: [] };

/**
 * Report whether a value is NULL.
 *
 * @param value The value to test.
 * @returns Whether `value` holds no values.
 */
export const isNull = (value: Value): boolean => value.values.length === 0;

/**
 * Report whether a response's value is NULL: a {@link Value} with no values, or a record with no
 * field.
 *
 * @param value The value to test.
 * @returns Whether `value` holds nothing.
 */
export const isNullResponse = (value: ResponseValue): boolean =>
  isRecordValue(value) ? value.fields.length === 0 : isNull(value);

/**
 * Say what to write for a duration: its seconds as an xs:double, never an ISO 8601 duration. A
 * parse failure ({@link InvalidValue}) and a `value-type` refusal's wording say it in these words,
 * so the two say one thing.
 *
 * @param literal How to write each literal the words name, such as `90.5`: as given in a plain
 *   message, or in a code span in Markdown.
 * @returns The words, which follow "write".
 */
export const durationForm = (literal: (text: string) => string): string =>
  `its seconds as a decimal or exponent number such as ${literal("90.5")}, or ${literal("INF")}, ${literal("-INF")} or ${literal("NaN")}, never an ISO 8601 duration such as ${literal("PT1M30.5S")}`;

/**
 * The lexical form each base type takes, in the words a parse failure uses to say what to write.
 */
const expected = {
  boolean: "true or false",
  directedPair: "two NCNames separated by whitespace, such as A B",
  duration: durationForm((text) => text),
  float: "a decimal or exponent number such as 2.5 or 1E3, or INF, -INF or NaN",
  identifier: "an NCName: a letter or _ first, then letters, digits, -, _ or .",
  integer: "decimal digits with an optional sign, such as -12",
  pair: "two NCNames separated by whitespace, such as A B",
  point: "two integers separated by whitespace, x then y, such as 102 113",
  string: "any text",
  uri: "any text",
} satisfies Record<ModelledBaseType, string>;

/**
 * The failure of reading text as a value of a base type: the text is outside the base type's
 * lexical space. A document that holds it is invalid.
 */
export class InvalidValue extends Data.TaggedError("InvalidValue")<{
  readonly baseType: ModelledBaseType;
  readonly lexical: string;
}> {
  /**
   * The text and the lexical form its base type takes, in one line.
   */
  override get message(): string {
    return `${JSON.stringify(this.lexical)} is not a ${this.baseType} value; write ${expected[this.baseType]}`;
  }
}

/**
 * Give a value when a lexical check holds.
 *
 * @param holds Whether the text is in the base type's lexical space.
 * @param single The value the text names.
 * @returns `single` when `holds`, otherwise none.
 */
const valueIf = (holds: boolean, single: Single): Option.Option<Single> =>
  holds ? Option.some(single) : Option.none();

/**
 * Read an xs:double lexical form, which {@link doubleLexical} has already admitted, as a number.
 *
 * XML Schema 1.0 maps a decimal to the value of the basic value space closest to it, and the
 * infinities are special values outside that space that only `INF` and `-INF` name. So a decimal
 * beyond the largest double, such as `1e400`, reads as the largest finite double of its sign, where
 * `Number` would round it to an infinity: reading 56 ("An `xs:double` literal beyond the largest
 * finite double names the largest finite double of its sign"), which plate keeps for a float or
 * duration value. {@link readIeeeDouble} reads a literal by reading 144 instead.
 *
 * @param lexical The lexical form.
 * @returns The number it names; `INF` and `-INF` are the infinities and `NaN` is NaN.
 * @see https://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#double
 */
const readDouble = (lexical: string): number => {
  if (lexical === "INF") {
    return Number.POSITIVE_INFINITY;
  }

  if (lexical === "-INF") {
    return Number.NEGATIVE_INFINITY;
  }

  const number = Number(lexical);
  if (number === Number.POSITIVE_INFINITY) {
    return Number.MAX_VALUE;
  }

  return number === Number.NEGATIVE_INFINITY ? -Number.MAX_VALUE : number;
};

/**
 * Read text in xs:double's lexical space as its IEEE double, reading 144 ("A bounded `xs:double` is
 * judged on its IEEE value"): the literal rounded to the nearest double, ties to even, as XML
 * Schema 1.1's doubleLexicalMap reads it (Part 2, section 3.3.5.2). A magnitude past the midpoint
 * between the largest finite double and 2^1024, such as `1e400`, is an infinity of its sign; one
 * below 2^-1075, half the least subnormal, such as `1e-400`, is a zero of its sign. `INF` and
 * `-INF` are the infinities and `NaN` is NaN. `Number` rounds a decimal exactly so.
 *
 * {@link readDouble} reads a float or duration value differently, by reading 56: `1e400` there is
 * the largest finite double. This reader is for what reading 144 governs, a literal compared or
 * judged by its double, such as a bound or a float map key.
 *
 * The lexical space is XML Schema 1.0's ({@link doubleLexical}), so `+INF`, `Infinity` and padded
 * text are outside it.
 *
 * @param lexical The text, as written; no whitespace is removed first.
 * @returns The double it names, or none when the text is outside xs:double's lexical space.
 * @see https://www.w3.org/TR/xmlschema11-2/#f-doubleLexmap
 */
export const readIeeeDouble = (lexical: string): Option.Option<number> => {
  if (!doubleLexical.test(lexical)) {
    return Option.none();
  }

  if (lexical === "INF") {
    return Option.some(Number.POSITIVE_INFINITY);
  }

  return Option.some(lexical === "-INF" ? Number.NEGATIVE_INFINITY : Number(lexical));
};

/**
 * Read a QTI integer lexical form as the exact integer it names, at any size.
 *
 * `BigInt` reads only text {@link integerLexical} has admitted, which it always accepts, so it
 * never throws.
 *
 * @param lexical The lexical form.
 * @returns The integer it names, or none when the text is not an integer.
 */
const readInteger = (lexical: string): Option.Option<Single> =>
  integerLexical.test(lexical)
    ? Option.some({ baseType: "integer", value: BigInt(lexical) })
    : Option.none();

/**
 * Read the lexical form of a point as its two exact coordinates.
 *
 * `BigInt` reads only text {@link pointLexical} has admitted as an integer, which it always
 * accepts, so it never throws.
 *
 * @param lexical The lexical form, with no outer whitespace removed.
 * @returns The point, x then y, or none when the text is not two integers separated by whitespace.
 */
const readPoint = (lexical: string): Option.Option<Single> => {
  const coordinates = pointLexical.exec(lexical)?.groups;
  const x = coordinates?.["x"];
  const y = coordinates?.["y"];

  return x === undefined || y === undefined
    ? Option.none()
    : Option.some({ baseType: "point", value: [BigInt(x), BigInt(y)] });
};

/**
 * Read the lexical form of a pair or directed pair.
 *
 * @param baseType Which of the two to read.
 * @param lexical The lexical form, with no outer whitespace removed.
 * @returns The two identifiers in written order, or none when the text is not two NCNames
 *   separated by whitespace.
 */
const readPair = (baseType: "pair" | "directedPair", lexical: string): Option.Option<Single> => {
  const sides = pairLexical.exec(lexical)?.groups;
  const source = sides?.["source"] ?? "";
  const destination = sides?.["destination"] ?? "";

  return valueIf(isNcName(source) && isNcName(destination), {
    baseType,
    value: [source, destination],
  });
};

/**
 * How each base type reads its lexical form: the value it names, or none when the text is outside
 * the lexical space.
 *
 * A duration reads as a float does, its seconds in xs:double's lexical space: `90.5`, `INF`,
 * `-INF`, `NaN` and a negative are durations, and an ISO 8601 duration such as `PT1M30.5S` is
 * outside it (reading 68).
 */
const readers = {
  boolean: (lexical: string) =>
    valueIf(lexical === "true" || lexical === "false", {
      baseType: "boolean",
      value: lexical === "true",
    }),
  directedPair: (lexical: string) => readPair("directedPair", lexical),
  duration: (lexical: string) =>
    valueIf(doubleLexical.test(lexical), { baseType: "duration", value: readDouble(lexical) }),
  float: (lexical: string) =>
    valueIf(doubleLexical.test(lexical), { baseType: "float", value: readDouble(lexical) }),
  identifier: (lexical: string) =>
    valueIf(isNcName(lexical), { baseType: "identifier", value: lexical }),
  integer: readInteger,
  pair: (lexical: string) => readPair("pair", lexical),
  point: readPoint,
  string: (lexical: string) => valueIf(true, { baseType: "string", value: lexical }),
  uri: (lexical: string) => valueIf(true, { baseType: "uri", value: lexical }),
} satisfies Record<ModelledBaseType, (lexical: string) => Option.Option<Single>>;

/**
 * Read text as a value of a base type, exactly as written.
 *
 * No whitespace is removed, so a padded attribute value is refused, as spec reading 7 rules for
 * typed values in attributes.
 *
 * A boolean is `true` or `false` only; `1` and `0` are refused (reading 34). The QTI XSD does not
 * decide: it types `qti-value` as `xs:normalizedString` and `qti-base-value` as `xs:string`. The
 * information model does: its boolean base type is "the same as the set of values defined by the
 * boolean primitiveType" (`info.txt:72950`), the primitive "with permitted values of "true" and
 * "false"" (`info.txt:74908`). XML Schema's `1` and `0` belong only to the attributes the XSD types
 * `xs:boolean`, which `xsBooleanOf` in `#plate/model/attributes.ts` reads.
 *
 * @param baseType The base type to read.
 * @param lexical The text, as written.
 * @returns The value the text names, or a failure with {@link InvalidValue} when the text is
 *   outside the base type's lexical space.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Enumerated_BaseTypeEnum
 */
export const parseLexical = (
  baseType: ModelledBaseType,
  lexical: string,
): Result.Result<Single, InvalidValue> =>
  Result.fromOption(readers[baseType](lexical), () => new InvalidValue({ baseType, lexical }));

/**
 * Read the text content of an element, such as `qti-value`, as a value of a base type.
 *
 * Spec reading 7: outer XML whitespace is formatting for every base type but `string`, so it is
 * removed before the text is read, in time linear in the text; for `string` it is part of the
 * value. An empty `string` is NULL, not a value.
 *
 * @param baseType The base type to read.
 * @param text The element's text content, as written.
 * @returns The value the text names, none for NULL, or a failure with {@link InvalidValue} when
 *   the trimmed text is outside the base type's lexical space.
 */
export const parseElementText = (
  baseType: ModelledBaseType,
  text: string,
): Result.Result<Option.Option<Single>, InvalidValue> =>
  baseType === "string"
    ? Result.succeed(valueIf(text !== "", { baseType, value: text }))
    : Result.map(parseLexical(baseType, trimXmlSpace(text)), Option.some);

/**
 * Write a float in the lexical space of xs:double.
 *
 * `String` already writes the shortest digits that read back to the same number, in a form
 * xs:double admits (`2.5`, `1e+21`); the infinities, NaN and negative zero are written by name.
 *
 * @param number The float to write.
 * @returns Its lexical form, which {@link parseLexical} reads back to the same number.
 */
const formatFloat = (number: number): string => {
  if (Number.isNaN(number)) {
    return "NaN";
  }

  if (number === Number.POSITIVE_INFINITY) {
    return "INF";
  }

  if (number === Number.NEGATIVE_INFINITY) {
    return "-INF";
  }

  return Object.is(number, -0) ? "-0" : String(number);
};

/**
 * Write a value in its base type's lexical form.
 *
 * `String` writes the exact decimal digits of an integer of any size, never an exponent: no `+`,
 * no leading zeros, and `0` for a written `-0`. A point's coordinates are written the same way. A
 * duration is written as its seconds, as a float is.
 *
 * @param single The value to write.
 * @returns The lexical form, which {@link parseLexical} reads back to the same value; a pair is its
 *   two identifiers, and a point its two coordinates, separated by one space.
 */
export const format = (single: Single): string => {
  if (single.baseType === "boolean") {
    return single.value ? "true" : "false";
  }

  if (single.baseType === "integer") {
    return String(single.value);
  }

  if (single.baseType === "float" || single.baseType === "duration") {
    return formatFloat(single.value);
  }

  if (single.baseType === "point") {
    return `${String(single.value[0])} ${String(single.value[1])}`;
  }

  if (single.baseType === "pair" || single.baseType === "directedPair") {
    return `${single.value[0]} ${single.value[1]}`;
  }

  return single.value;
};

/**
 * Report whether two singles are equal, as {@link match} compares two single values.
 *
 * @param left One single.
 * @param right The other single.
 * @returns Whether they share a base type and are equal: a `pair` in either order, a
 *   `directedPair` in order, a `point` when both coordinates are equal, integers, floats and
 *   durations by value (`===` compares two bigints by value) and strings by code point.
 */
export const sameSingle = (left: Single, right: Single): boolean => {
  if (left.baseType === "pair" && right.baseType === "pair") {
    const [a, b] = left.value;
    const [c, d] = right.value;

    return (a === c && b === d) || (a === d && b === c);
  }

  if (left.baseType === "directedPair" && right.baseType === "directedPair") {
    return left.value[0] === right.value[0] && left.value[1] === right.value[1];
  }

  if (left.baseType === "point" && right.baseType === "point") {
    return left.value[0] === right.value[0] && left.value[1] === right.value[1];
  }

  return left.baseType === right.baseType && left.value === right.value;
};

/**
 * Give a record's fields by identifier, in linear time. A record names each identifier once
 * (`RecordValueSchema` refuses one that does not); where one built by hand names an identifier
 * twice, its first field is the one kept, as a record keeps the first written.
 *
 * @param record The record.
 * @returns Each field's value by its identifier.
 */
const fieldsOf = (record: RecordValue): ReadonlyMap<string, Single> => {
  const fields = new Map<string, Single>();
  for (const field of record.fields) {
    if (!fields.has(field.identifier)) {
      fields.set(field.identifier, field.value);
    }
  }

  return fields;
};

/**
 * Report whether two records hold the same fields, in any order.
 *
 * @param left One record.
 * @param right The other record.
 * @returns Whether they name the same set of identifiers and, for each, fields of one base type
 *   that are equal as {@link sameSingle} compares them. Two NULL records name no identifier, so
 *   they are the same; `qti-match`'s NULL rule is its caller's.
 */
export const sameRecord = (left: RecordValue, right: RecordValue): boolean => {
  const leftFields = fieldsOf(left);
  const rightFields = fieldsOf(right);

  return (
    leftFields.size === rightFields.size &&
    [...leftFields].every(([identifier, single]) => {
      const other = rightFields.get(identifier);

      return other !== undefined && sameSingle(single, other);
    })
  );
};

/**
 * Report whether two equally long lists hold the same values as multisets.
 *
 * @param left One list.
 * @param right The other list, of the same length.
 * @returns Whether each value of `left` pairs with its own equal value of `right`.
 */
const sameMultiset = (left: readonly Single[], right: readonly Single[]): boolean => {
  const unmatched = [...right];

  return left.every((single) => {
    const index = unmatched.findIndex((other) => sameSingle(single, other));
    if (index === -1) {
      return false;
    }

    unmatched.splice(index, 1);

    return true;
  });
};

/**
 * Report whether two values match, as `qti-match` and `match_correct` compare a response with its
 * correct response.
 *
 * The values must share a base type and a cardinality. `single` compares the one value, `multiple`
 * compares as a multiset (repeats count), and `ordered` as a sequence.
 *
 * @param left One value.
 * @param right The other value.
 * @returns Whether they match; false when either is NULL.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMatch
 */
export const match = (left: Value, right: Value): boolean => {
  if (
    isNull(left) ||
    isNull(right) ||
    left.baseType !== right.baseType ||
    left.cardinality !== right.cardinality ||
    left.values.length !== right.values.length
  ) {
    return false;
  }

  return left.cardinality === "multiple"
    ? sameMultiset(left.values, right.values)
    : left.values.every((single, index) => {
        const other = right.values[index];

        return other !== undefined && sameSingle(single, other);
      });
};

/**
 * Report whether a response's value is its default, as skipping and Results Reporting's answered
 * status read it: a value that matches it ({@link match}), or a record that holds the same fields
 * in any order ({@link sameRecord}). A value is never a record's default, nor a record a value's.
 *
 * @param value The value given, not NULL.
 * @param fallback The response's default.
 * @returns Whether `value` is `fallback`.
 */
export const atDefault = (value: ResponseValue, fallback: ResponseValue): boolean =>
  isRecordValue(value)
    ? isRecordValue(fallback) && sameRecord(value, fallback)
    : !isRecordValue(fallback) && match(value, fallback);
