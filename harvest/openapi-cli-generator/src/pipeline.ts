import { Array as Arr, Data, Effect, Option, Schema } from "effect";
import { stringLiteral } from "./emit/escape.ts";
import { emitApi } from "./emit/api.ts";
import { emitCli } from "./emit/cli.ts";
import type { CliRefusal } from "./emit/cli.ts";
import { emitDomainSchemas } from "./emit/domain.ts";
import type { EmittedFile, } from "./emit/package.ts";
import { checkSpecText } from "./check/index.ts";
import { loadBytes } from "./load/index.ts";
import type { AuthorConfig } from "./model/author-config.ts";
import type { DocumentUri } from "./model/brands.ts";
import type { Diagnostic } from "./model/diagnostic.ts";
import {
  isDocumentRefusal,
  isRefusal,
  makeDiagnostic,
  sortDiagnostics,
} from "./model/diagnostic.ts";
import { Api } from "./model/entities.ts";
import type { Operation } from "./model/entities.ts";
import { planNames } from "./names/index.ts";
import type { NamePlan, PlannedCommand, PlannedGroup } from "./names/index.ts";
import { normalize } from "./normalize/index.ts";
import { distinctDiagnostics } from "./normalize/operations.ts";
import { normalizeSchemas } from "./normalize/schemas.ts";
import { boundOrigins } from "./normalize/servers.ts";
import { resolve } from "./resolve/index.ts";
import type { Resolution, } from "./resolve/index.ts";
import { lineOf, versionRefusal } from "./validate/dispatch.ts";
import type { UnsupportedOpenApiVersion } from "./validate/dispatch.ts";
import { patchVersion, specSectionUrl } from "./model/spec-section.ts";

type Document = typeof DocumentUri.Type;

/**
 * Nothing was written (design 8.1 exit 1): the author config cannot be used, the document is
 * refused, or `--strict` met a refusal. `diagnostics` are the run's diagnostics so far.
 */
export class GenerateRefused extends Data.TaggedError("GenerateRefused")<{
  readonly diagnostics: readonly Diagnostic[];
  readonly reason: "config" | "document" | "strict";
}> {}

const emitHints: Readonly<Record<CliRefusal["reason"], string | undefined>> = {
  "unsupported-body":
    "Text and form request bodies, and multipart bodies the runtime writer cannot send exactly, are not emitted yet.",
  "unsupported-flag": undefined,
  "unsupported-parameter": undefined,
};

const refused =
  (reason: GenerateRefused["reason"]) =>
  (diagnostics: readonly Diagnostic[]): GenerateRefused =>
    new GenerateRefused({ diagnostics, reason });

/**
 * `DOC-02`: an `openapi` value that names no supported line refuses the document, reported like
 * every other document refusal.
 */
export const versionRefused =
  (document: Document) =>
  (error: UnsupportedOpenApiVersion): Effect.Effect<never, GenerateRefused | Schema.SchemaError> =>
    versionRefusal(error, document).pipe(
      Effect.flatMap((diagnostic) => Effect.fail(refused("document")([diagnostic]))),
    );

const pathItemSite = /^\/paths\/[^/]+$/u;

const DeclaredOpenapi = Schema.Struct({ openapi: Schema.String });

/**
 * Design 3.3, `PTH-10`: a Path Item under `paths` whose `$ref` ends in another document of the set
 * is refused at element scope. Assembly and the spec-text checks walk the entry's sites only, so
 * without this its operations would be left out with no diagnostic.
 */
export const otherDocumentPathItems = (
  resolution: Resolution,
): Effect.Effect<readonly Diagnostic[]> => {
  const openapi = Option.match(Schema.decodeUnknownOption(DeclaredOpenapi)(resolution.value), {
    onNone: () => patchVersion[resolution.line],
    onSome: (found) => found.openapi,
  });
  const references = [...resolution.references.values()].filter(
    (reference) =>
      reference.kind === "pathItem" &&
      reference.site.document === resolution.document &&
      pathItemSite.test(reference.site.pointer) &&
      reference.target.document !== resolution.document,
  );

  return Effect.all(
    references.map((reference) =>
      makeDiagnostic({
        code: "PTH-10/other-document",
        document: resolution.document,
        element: "Path Item",
        hint: "Path Items are read from the entry document only; move this one into it.",
        message:
          "The Path Item is a reference into another document of the set; its operations are not generated.",
        openapi,
        pointer: reference.site.pointer,
        related: [reference.target],
        scope: "element",
        severity: "refusal",
        specSection: specSectionUrl(resolution.line, "path-item-ref"),
      }),
    ),
  );
};

const sameKey = (operation: Operation, method: string, path: string): boolean =>
  operation.key.method === method && operation.key.path === path;

// Operations an operation-scope spec-text refusal names (PTH-03, PTH-04, PTH-08, PTH-28, STY-44
// and the rest of design 3.4) are absent from the model, as normalize's own refusals are (2.4).
const withoutRefused = (api: Api, checked: readonly Diagnostic[]): Api => {
  const named = checked.flatMap((diagnostic) =>
    isRefusal(diagnostic) && diagnostic.scope === "operation" && diagnostic.operation !== undefined
      ? [diagnostic.operation]
      : [],
  );
  const operations = api.operations.filter(
    (operation) => !named.some((key) => sameKey(operation, key.method, key.path)),
  );

  return operations.length === api.operations.length
    ? api
    : new Api({
        documents: api.documents,
        entry: api.entry,
        info: api.info,
        informational: api.informational,
        line: api.line,
        openapi: api.openapi,
        operations,
        origin: api.origin,
        rows: api.rows,
        schemas: api.schemas,
        securitySchemes: api.securitySchemes,
        servers: api.servers,
        tags: api.tags,
      });
};

// The code-generation copy's roots (design 3.5): every schema a request parameter or body uses.
const requestRoots = (api: Api): readonly string[] =>
  Arr.dedupe(
    api.operations.flatMap((operation) => [
      ...operation.parameters.flatMap((parameter) => [
        parameter.schema.key,
        ...(parameter.serialization.kind === "content" ? [parameter.serialization.schema.key] : []),
      ]),
      ...(operation.body?.alternatives ?? []).flatMap((alternative) => [
        ...(alternative.schema === undefined ? [] : [alternative.schema.key]),
        ...(alternative.itemSchema === undefined ? [] : [alternative.itemSchema.key]),
      ]),
    ]),
  );

interface CommandAt {
  readonly command: PlannedCommand;
  readonly path: readonly string[];
}

// Every planned command with its visible path, in the order `--describe` walks the tree (design
// 8.3): top-level groups in plan order, each group's commands before its child groups, then the
// root's commands.
const commandOrder = (plan: NamePlan): readonly CommandAt[] => {
  const byTag = new Map(plan.groups.map((group) => [group.tag, group]));
  const namesOf = (group: PlannedGroup): readonly string[] => {
    const parent = group.parent === undefined ? undefined : byTag.get(group.parent);

    return [...(parent === undefined ? [] : namesOf(parent)), group.name];
  };
  const walk = (group: PlannedGroup): readonly CommandAt[] => [
    ...group.commands.map((command) => ({ command, path: [...namesOf(group), command.name] })),
    ...plan.groups.filter((child) => child.parent === group.tag).flatMap(walk),
  ];

  return [
    ...plan.groups.filter((group) => group.parent === undefined).flatMap(walk),
    ...plan.root.map((command) => ({ command, path: [command.name] })),
  ];
};

// `emitCli` refuses each command of an operation alone, and an operation's commands share its
// flags, so its primary and alias commands are refused for one reason: keep the first of each.
const refusedOperations = (refusals: readonly CliRefusal[]): readonly CliRefusal[] =>
  Arr.dedupeWith(
    refusals,
    (left, right) =>
      left.operation.method === right.operation.method &&
      left.operation.path === right.operation.path &&
      left.reason === right.reason &&
      left.subject === right.subject,
  );

// Design 8.4 `EMT-1`: one operation-scope refusal per operation `emitCli` could not express,
// naming every command of the operation that is not generated.
const emitRefusal = (
  api: Api,
  refusal: CliRefusal,
  order: readonly CommandAt[],
): Effect.Effect<Diagnostic> =>
  Effect.gen(function* map() {
    const operation = api.operations.find((candidate) =>
      sameKey(candidate, refusal.operation.method, refusal.operation.path),
    );
    if (operation === undefined) {
      return yield* Effect.die("emitCli refused an operation the model does not hold");
    }

    const { method, path } = operation.key;
    const names = order.flatMap((entry) =>
      sameKey(entry.command.operation, method, path) ? [stringLiteral(entry.path.join(" "))] : [],
    );
    const needs = stringLiteral(refusal.subject);
    const message =
      names.length > 1
        ? `The commands ${names.join(", ")} are not generated: they need ${needs}.`
        : `The command is not generated: it needs ${needs}.`;
    const key =
      operation.operationId === undefined
        ? { method, path }
        : { method, operationId: operation.operationId, path };

    return yield* makeDiagnostic({
      code: `EMT-1/${refusal.reason}`,
      document: operation.origin.document,
      element: "Emitted command",
      hint: emitHints[refusal.reason],
      message,
      openapi: api.openapi,
      operation: key,
      pointer: operation.origin.pointer,
      scope: refusal.scope,
      severity: "refusal",
      specSection: specSectionUrl(api.line, "operation-object"),
    });
  });

/**
 * The generator's stages on one in-memory document, as `generate` runs them (design 3) but without the
 * filesystem: load, resolve, check and normalize, then plan names, import the schemas and emit the
 * `domain/`, `api/` and `cli/` files. Harvested for benchmarking: the hyperjump validator, the scaffold,
 * the generation report and the writer are cut, and the document set is the entry document alone.
 */
export const pipeline = (
  bytes: Uint8Array,
  document: Document,
  config: AuthorConfig,
  configDocument: Document,
) =>
  Effect.gen(function* pipelineGen() {
    const documents = [document, configDocument];
    const order = (diagnostics: readonly Diagnostic[]) =>
      sortDiagnostics(documents, distinctDiagnostics(diagnostics));
    const loaded = yield* loadBytes(bytes, { document }).pipe(
      Effect.mapError((refusal) => refused("document")([refusal.diagnostic])),
    );
    const line = yield* lineOf(loaded.value).pipe(
      Effect.catchTag("UnsupportedOpenApiVersion", versionRefused(document)),
    );
    const resolution = yield* resolve({ document, line, members: [], value: loaded.value }).pipe(
      Effect.mapError((refusal) => refused("document")(order([refusal.diagnostic]))),
    );
    const checked = yield* checkSpecText(resolution);
    const outside = yield* otherDocumentPathItems(resolution);
    const early = [...resolution.diagnostics, ...checked, ...outside];
    if (early.some(isDocumentRefusal)) {
      return yield* refused("document")(order(early));
    }
    const normalized = yield* normalize(resolution, { checkFindings: checked, config, configDocument });
    const api = withoutRefused(normalized.api, checked);
    const analyzed = order([...early, ...normalized.diagnostics]);
    if (analyzed.some(isDocumentRefusal)) {
      return yield* refused("document")(analyzed);
    }
    const serversContext = { config, configDocument, document, openapi: api.openapi };
    const bound = boundOrigins(api.servers, serversContext);
    const plan = yield* planNames(api, { config, configDocument, strict: false });
    const planned = order([...analyzed, ...bound.diagnostics, ...plan.diagnostics]);
    if (planned.some(isDocumentRefusal)) {
      return yield* refused("document")(planned);
    }
    const schemas = yield* normalizeSchemas(resolution);
    const domain = yield* emitDomainSchemas(
      schemas.validation.definitions,
      requestRoots(api),
      plan.domain,
    );
    const apiFiles = yield* emitApi({
      api,
      boundOrigins: (servers) => boundOrigins(servers, serversContext).origins,
      plan,
    });
    const cli = yield* emitCli({
      api,
      config,
      plan: { ...plan, diagnostics: planned },
      validationEdits: schemas.validation.edits,
    });
    const commands = commandOrder(plan);
    const emitted = yield* Effect.all(
      refusedOperations(cli.refusals).map((refusal) => emitRefusal(api, refusal, commands)),
    );
    const files: readonly EmittedFile[] = [domain, ...apiFiles, ...cli.files];
    return { diagnostics: order([...planned, ...emitted]), files };
  });
