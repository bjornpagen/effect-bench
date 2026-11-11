/**
 * The XSD defaults of `qti-item-session-control`'s boolean attributes, in a module that loads no
 * other.
 *
 * {@link sessionControlDefaults} belongs with the closed tables of `#plate/vocabulary.ts`, which
 * re-exports it. It lives here so that `#plate/session/control.ts`, a browser module, reads it
 * without loading the vocabulary's other tables.
 *
 * @module
 */

/**
 * The XSD defaults of the six boolean attributes of `qti-item-session-control`, as its attributes
 * spell them (`imsqti_asiv3p0_v1p0.xsd:34079-34084`, `imsqti_asiv3p0p1_v1p0.xsd:34313-34318`).
 *
 * The seventh, `max-attempts`, has no XSD default and so no entry: an item none of its enclosing
 * elements limits has one attempt when it is not adaptive.
 */
export const sessionControlDefaults = {
  "allow-comment": false,
  "allow-review": true,
  "allow-skipping": true,
  "show-feedback": false,
  "show-solution": false,
  "validate-responses": false,
} as const;
