/**
 * The plain-HTML host: one page around one item, composed from plate's public surface alone, as an
 * author with no framework composes it (rule `a9d04969` point 5).
 *
 * The page links plate's sheet and holds the host's own `form method="post"` and submit button
 * around `render(redact(…))`. A post is decoded, checked with `checkResponses` and scored with
 * `score`, and the page comes back with the Status part above the form. The host is stateless: it
 * keeps no record, so each post is scored as a first attempt, and it sets no attempt limit.
 *
 * It keeps the duty the README states for a form that holds a Choice: the form carries
 * `autocomplete="off"` and every page it answers sends `Cache-Control: no-store`, so a browser
 * restores no Choice's checked state from its form cache or its back-forward cache over what the
 * host rendered.
 *
 * It imports only `#plate/index.ts`, so it uses nothing a host outside the package could not. The
 * dev playground mounts it at `/hosts/html` and serves the sheet at `/styles.css`; the core never
 * reaches it (`src/boundary.test.ts` forbids `#plate/hosts/`).
 *
 * @module
 */
import {
  checkResponses,
  configure,
  decode,
  open,
  partition,
  postings,
  redact,
  render,
  renderStatus,
  score,
} from "#plate/index.ts";
import type {
  Accepted,
  Configuration,
  Entry,
  Options,
  ResponseValue,
  StatusInput,
  StoredRecord,
  ValidationMessage,
} from "#plate/index.ts";

/**
 * A Fetch handler: it answers one request with the page, or with a short page saying why not.
 *
 * @param request The request, whose path is the host's own once its mount strips its prefix.
 * @returns The response, which never rejects for a request the host refuses.
 */
export type HtmlHost = (request: Request) => Promise<Response>;

/**
 * The instance token every render here uses. The host serves one item per page and keeps no
 * state, so a fixed token lets a post name the entries the page it came from wrote.
 */
const instance = "q1";

/**
 * Where the page links plate's sheet: the path the dev playground serves `src/styles.css` at.
 */
const sheet = "/styles.css";

/**
 * The headers of every page the host answers with: `no-store`, so a browser keeps no page to
 * restore a Choice's checked state from.
 */
const pageHeaders = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
} as const;

/**
 * Escape a string for HTML text or a double-quoted attribute value.
 *
 * @param value The string.
 * @returns The string with `&`, `<`, `>` and `"` written as references.
 */
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Construct a page response: a whole HTML document around the host's own markup.
 *
 * @param status The HTTP status.
 * @param page The page's parts.
 * @param page.lang The page's language, the configuration's locale.
 * @param page.title The page's title, as text.
 * @param page.main The markup `main` holds, already HTML.
 * @param headers Headers beyond {@link pageHeaders}.
 * @returns The response.
 */
const pageResponse = (
  status: number,
  page: { readonly lang: string; readonly main: readonly string[]; readonly title: string },
  headers: Readonly<Record<string, string>> = {},
): Response =>
  new Response(
    [
      "<!doctype html>",
      `<html lang="${escapeHtml(page.lang)}">`,
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(page.title)}</title>`,
      `<link rel="stylesheet" href="${sheet}">`,
      "</head>",
      "<body>",
      "<main>",
      ...page.main,
      "</main>",
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    { headers: { ...pageHeaders, ...headers }, status },
  );

/**
 * Construct a page that says one thing in a paragraph, for a request the host does not serve.
 *
 * @param status The HTTP status.
 * @param title The page's title and heading.
 * @param detail What the paragraph says.
 * @param headers Headers beyond {@link pageHeaders}.
 * @returns The response.
 */
const notePage = (
  status: number,
  title: string,
  detail: string,
  headers: Readonly<Record<string, string>> = {},
): Response =>
  pageResponse(
    status,
    { lang: "en", main: [`<h1>${escapeHtml(title)}</h1>`, `<p>${escapeHtml(detail)}</p>`], title },
    headers,
  );

/**
 * Read a stored float: a JSON number, or the name a stored record writes a float JSON has no
 * number for.
 *
 * @param stored The float as the record stores it.
 * @returns The float.
 */
const floatOf = (stored: number | "-0" | "-INF" | "INF" | "NaN"): number => {
  switch (stored) {
    case "-0": {
      return -0;
    }
    case "-INF": {
      return Number.NEGATIVE_INFINITY;
    }
    case "INF": {
      return Number.POSITIVE_INFINITY;
    }
    case "NaN": {
      return Number.NaN;
    }
    default: {
      return stored;
    }
  }
};

/**
 * Write the score a stored record holds, as the candidate reads it in the locale. A duration is
 * written as its seconds, as a float is.
 *
 * @param accepted The accepted item.
 * @param stored The record `score` returned.
 * @param locale The locale.
 * @returns The single value of `SCORE`, or none when the item has no response processing or
 *   `SCORE` is absent or NULL, which makes the page say the response was recorded.
 */
const scoreText = (
  accepted: Accepted,
  stored: StoredRecord,
  locale: string,
): string | undefined => {
  const [single] = stored.outcomes["SCORE"]?.values ?? [];
  if (accepted.item.processing._tag === "None" || single === undefined) {
    return undefined;
  }

  switch (single.baseType) {
    case "duration":
    case "float": {
      return new Intl.NumberFormat(locale).format(floatOf(single.value));
    }
    case "integer": {
      return new Intl.NumberFormat(locale).format(BigInt(single.value));
    }
    case "directedPair":
    case "pair":
    case "point": {
      return single.value.join(" ");
    }
    case "boolean":
    case "identifier":
    case "string":
    case "uri": {
      return String(single.value);
    }
    default: {
      return single satisfies never;
    }
  }
};

/**
 * Construct the host's handler for one accepted item: {@link htmlHost}'s handler once `open` has
 * accepted the item. Exported for its test, which hands it an item built by hand; the package's
 * `src/index.ts` does not export it.
 *
 * @param accepted The item `open` accepted.
 * @param configuration The configuration every render and check reads.
 * @returns The handler: `GET /` answers the page, `POST /` scores the form's post, any other path
 *   is a 404 and any other method a 405.
 */
export const itemHost = (accepted: Accepted, configuration: Configuration): HtmlHost => {
  const redacted = redact(accepted, undefined, configuration);
  const bindings = postings(redacted, instance);

  /**
   * Construct the page around the item: the Status part when a post gave one, then the host's
   * form around the rendered item and the host's submit button. The form carries
   * `autocomplete="off"`, which HTML does not allow on a Choice's radio or checkbox, so the
   * browser restores none of their checked states; the Text Entry and Extended Text Controls say
   * `off` on their own.
   *
   * @param options What `render` shows: the posted values, or a refused post's strings and
   *   messages.
   * @param status What the Status part shows, none before a post.
   * @returns The response.
   */
  const itemPage = (options: Options, status?: StatusInput): Response => {
    const rendered = render(redacted, configuration, { ...options, instance });
    const shown = status === undefined ? undefined : renderStatus(status, configuration);
    if (rendered._tag === "Failure") {
      return notePage(500, "Host error", rendered.failure.message);
    }

    if (shown?._tag === "Failure") {
      return notePage(500, "Host error", shown.failure.message);
    }

    return pageResponse(200, {
      lang: configuration.locale,
      main: [
        ...(shown === undefined ? [] : [shown.success.html]),
        '<form method="post" autocomplete="off">',
        rendered.success.html,
        '<button type="submit">Submit</button>',
        "</form>",
      ],
      title: redacted.title,
    });
  };

  /**
   * Score a form post: decode each response the item posts, an integer in the base its
   * interaction declares, check them, then score them, and answer with the page after the submit.
   *
   * @param body The post's form-urlencoded body.
   * @returns The page: refused, with the post's strings and messages, or scored.
   */
  const submitted = (body: string): Response => {
    const entries = Array.from(new URLSearchParams(body), ([name, value]): Entry => [name, value]);
    const { own } = partition(entries, instance);
    const decoded = bindings.map(({ binding, identifier, options }) => ({
      identifier,
      result: decode(own, binding, options),
    }));
    const posted = Object.fromEntries(
      bindings.map(({ binding, identifier }) => [
        identifier,
        own.flatMap(([name, value]) =>
          name !== binding.name || value instanceof Blob ? [] : [value],
        ),
      ]),
    );
    const messages = checkResponses(
      accepted,
      Object.fromEntries(
        decoded.map(({ identifier, result }) => [
          identifier,
          result._tag === "Success" ? result.success : result.failure,
        ]),
      ),
      configuration,
    );
    /**
     * Answer a refused post: the item with the post's strings and the messages, and the Status
     * part headed "Not accepted" with `autofocus`.
     *
     * @param refusals The messages that refuse the post.
     * @returns The page.
     */
    const refused = (refusals: readonly ValidationMessage[]): Response =>
      itemPage(
        { messages: refusals, posted },
        { autofocus: true, heading: "notAccepted", instance, messages: refusals },
      );
    if (messages.length > 0) {
      return refused(messages);
    }

    const values: Readonly<Record<string, ResponseValue>> = Object.fromEntries(
      decoded.flatMap(({ identifier, result }) =>
        result._tag === "Success" ? [[identifier, result.success] as const] : [],
      ),
    );
    const stored = score(accepted, values);
    if (stored._tag === "Failure") {
      return stored.failure._tag === "ResponsesRefused"
        ? refused(stored.failure.messages)
        : notePage(500, "Host error", stored.failure.message);
    }

    const written = scoreText(accepted, stored.success, configuration.locale);

    return itemPage(
      { values },
      written === undefined
        ? { autofocus: true, heading: "responseRecorded", instance }
        : { autofocus: true, heading: "scored", instance, score: written },
    );
  };

  return (request) => {
    if (new URL(request.url).pathname !== "/") {
      return Promise.resolve(notePage(404, "Not found", "This host serves one page, at /."));
    }

    if (request.method === "GET") {
      return Promise.resolve(itemPage({}));
    }

    if (request.method !== "POST") {
      return Promise.resolve(
        notePage(405, "Method not allowed", "Open the page with GET, or post its form.", {
          allow: "GET, POST",
        }),
      );
    }

    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded") {
      return Promise.resolve(
        notePage(
          415,
          "Not a form post",
          "Post the page's form, which sends its answers form-urlencoded.",
        ),
      );
    }

    return request
      .text()
      .then(submitted, () =>
        notePage(
          400,
          "Unreadable post",
          "The post's body could not be read; submit the form again.",
        ),
      );
  };
};

/**
 * Build the plain-HTML host for one item, from its location and its bytes as the caller read
 * them.
 *
 * It opens the item with `open` and decodes the default configuration with `configure`. It is a
 * generator that yields those Effects rather than an Effect, so the host imports nothing but
 * `#plate/index.ts`: delegate to it from an Effect generator, `yield* htmlHost(location, bytes)`.
 * A document `open` does not accept as an item, a refused or unchecked one or an accepted test,
 * section or stimulus, gives a handler that answers every request with a 500 page naming the
 * verdict and the document's kind.
 *
 * @example
 *   Effect.gen(function* serve() {
 *     const handler = yield* htmlHost(location, yield* readCorpusFile(location));
 *
 *     return yield* Effect.promise(() => handler(new Request("http://host/")));
 *   });
 *
 * @param location The item's location, which `open` puts on its verdict.
 * @param bytes The item's bytes.
 * @yields {Effect} The Effects of `open` and `configure`, which the delegating Effect generator
 *   runs.
 * @returns The host's Fetch handler.
 */
export const htmlHost = function* htmlHost(location: string, bytes: Uint8Array) {
  const verdict = yield* open(location, bytes);
  const configuration = yield* configure({});
  if (
    (verdict.verdict === "accepted" || verdict.verdict === "accepted-with-unsupported") &&
    verdict.kind === "item"
  ) {
    return itemHost(verdict.accepted, configuration);
  }

  const { kind, verdict: said } = verdict;
  const refused: HtmlHost = () =>
    Promise.resolve(
      notePage(
        500,
        "Item not accepted",
        `plate's verdict on ${location} is ${said}, for a document of kind ${kind}, so this host has no item to serve. Give it an item plate accepts.`,
      ),
    );

  return refused;
};
