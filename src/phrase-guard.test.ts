/**
 * Phrase-layer guard for the whole package.
 *
 * Everything a caller hears or reads comes from `language/*.json`, so no
 * caller-facing text may be written as a literal in `src/`: a literal is
 * English forever, and a caller mid-conversation in French hears it. This
 * scans source for the shapes that put text (or a fixed language) at a
 * delivery point, rather than testing a return value, because the violation
 * is a call site, not a wrong output - the next English default someone
 * types is caught here instead of in production.
 *
 * Four rules, each covering a different way the phrase layer gets bypassed:
 *
 * 1. **Caller-facing result fields.** A flow result's
 *    `response`/`smsContent`/`whatsappContent` is delivered verbatim, so it
 *    may not be a literal.
 * 2. **Inline TwiML.** TwiML markup may only be written in `core/twiml.ts`.
 *    Hand-rolling a `<Say>` elsewhere skips the phrase lookup, the
 *    configured voice and `escapeXml` all at once - which is exactly how the
 *    rate-limit 429 shipped an untranslated, unescaped English line.
 * 3. **Literal text into a TwiML builder.** The spoken/sent argument of
 *    `sayTwiml` and friends must come from a phrase lookup, not a quote.
 * 4. **Literal language into a phrase lookup.** `getPhrase("en", ...)`
 *    passes the guard for rules 1-3 and still hands every caller English.
 *    The detected language reaches a phrase call through
 *    `resolveLanguage(phoneNumber)`; `DEFAULT_LANGUAGE` is the named
 *    exception for the one turn before detection can have run.
 *
 * Literals nested deeper in an expression are fine and expected: the phrase
 * *key* in `getFlowPhrase(language, "needMoreDetails")` is not caller-facing
 * text. Developer-facing text (thrown Error messages, log lines) is out of
 * scope - it never reaches a caller.
 *
 * What it deliberately does not catch: a literal hoisted into a `const` and
 * referenced by name, shorthand (`{ response }`), or assignment after the
 * object is built. It is a gate against the easy mistake, not a proof; the
 * invariant itself is still enforced in review.
 *
 * See `docs/ARCHITECTURE.md`'s "Phrase-file-only user-facing strings".
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = import.meta.dir;

/** The result fields a caller actually hears or reads. */
const CALLER_FACING_FIELDS = ["response", "smsContent", "whatsappContent"];

/**
 * TwiML element openers. `<?xml` is included because every TwiML document
 * starts with it, so a hand-rolled response is caught even if its verbs are
 * assembled some other way. Deliberately not just `<Response` - that also
 * appears as the TypeScript type in `Promise<Response>`.
 */
const TWIML_MARKERS = ["<?xml", "<Say", "<Gather", "<Message>", "<Redirect", "<Hangup", "<Dial>"];

/** The one module allowed to write TwiML, relative to `src/`. */
const TWIML_MODULE = join("core", "twiml.ts");

/**
 * TwiML builders, and the argument index of the text a caller hears. The
 * language-first builders take the message last because it is optional (they
 * look the phrase up themselves when it is omitted).
 */
const TWIML_BUILDERS: Array<{ name: string; messageArg: number }> = [
  { name: "gatherTwiml", messageArg: 0 },
  { name: "sayTwiml", messageArg: 0 },
  { name: "messageTwiml", messageArg: 0 },
  { name: "transferTwiml", messageArg: 2 },
  { name: "acknowledgmentTwiml", messageArg: 2 },
  { name: "farewellTwiml", messageArg: 2 },
];

/** Phrase lookups, and the argument index of the language code. */
const PHRASE_LOOKUPS: Array<{ name: string; languageArg: number }> = [
  { name: "loadPhrases", languageArg: 0 },
  { name: "getPhrase", languageArg: 0 },
  { name: "getFarewellPhrase", languageArg: 0 },
  { name: "getFlowPhrase", languageArg: 0 },
  { name: "getVoicePhrase", languageArg: 0 },
  { name: "getCancellationKeywords", languageArg: 0 },
  { name: "getSmsPhrase", languageArg: 0 },
  { name: "getWhatsAppPhrase", languageArg: 0 },
  { name: "getChannelPhrase", languageArg: 1 },
];

/**
 * Blank out comments so text written in prose is not scanned. The string and
 * template alternatives come first so a `//` or `/*` *inside* a string is
 * consumed as part of that string - without them, the `/*` in a route glob or
 * a URL blanks everything up to the next doc comment and the gate quietly
 * stops gating. Same reasoning as `src/seam-guards.test.ts`.
 */
export function stripComments(source: string): string {
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (match) =>
      match.startsWith("//") || match.startsWith("/*") ? match.replace(/[^\n]/g, " ") : match,
  );
}

/**
 * The source text of every caller-facing field's value in a file, each cut at
 * the comma that closes it. Tracks bracket depth and quoting so a comma
 * inside a call's arguments or inside a string does not end it early.
 */
function callerFacingExpressions(source: string): string[] {
  const stripped = stripComments(source);
  const expressions: string[] = [];
  const fields = new RegExp(`\\b(?:${CALLER_FACING_FIELDS.join("|")}):`, "g");

  for (const match of stripped.matchAll(fields)) {
    let depth = 0;
    let quote = "";
    let end = match.index + match[0].length;
    for (; end < stripped.length; end++) {
      const char = stripped[end] as string;
      if (quote) {
        if (char === "\\") end++;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if ("([{".includes(char)) depth++;
      else if (")]}".includes(char)) {
        if (depth === 0) break; // the object literal closed without a comma
        depth--;
      } else if (char === "," && depth === 0) break;
    }
    expressions.push(stripped.slice(match.index + match[0].length, end).trim());
  }

  return expressions;
}

/**
 * The argument expressions of every call to `name`, one array per call site.
 * Splits on commas at the call's own paren depth, using the same
 * depth-and-quote walk as `callerFacingExpressions`.
 *
 * A declaration (`function sayTwiml(message: string, ...)`) matches too, and
 * that is harmless: a parameter list holds annotations and names, never the
 * literal shapes the rules below look for.
 */
export function callArguments(source: string, name: string): string[][] {
  const stripped = stripComments(source);
  const calls: string[][] = [];
  // `[.\w]` before the name would make this match `a.sayTwiml(` too; the
  // guard is about direct calls to our own helpers, so require a boundary
  // that is not a property access.
  const pattern = new RegExp(`(?<![.\\w$])${name}\\s*\\(`, "g");

  for (const match of stripped.matchAll(pattern)) {
    const args: string[] = [];
    let depth = 0;
    let quote = "";
    let start = match.index + match[0].length;
    let index = start;
    for (; index < stripped.length; index++) {
      const char = stripped[index] as string;
      if (quote) {
        if (char === "\\") index++;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if ("([{".includes(char)) depth++;
      else if (")]}".includes(char)) {
        if (depth === 0) break; // the call's own closing paren
        depth--;
      } else if (char === "," && depth === 0) {
        args.push(stripped.slice(start, index).trim());
        start = index + 1;
      }
    }
    const last = stripped.slice(start, index).trim();
    if (last.length > 0 || args.length > 0) args.push(last);
    calls.push(args);
  }

  return calls;
}

/**
 * Non-empty string and template literals written at the top level of an
 * expression - the shape that puts caller-facing text in the code. Literals
 * inside a call's arguments sit at depth > 0 and are skipped.
 */
function topLevelLiterals(expression: string): string[] {
  const literals: string[] = [];
  let depth = 0;

  for (let index = 0; index < expression.length; index++) {
    const char = expression[index] as string;
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === '"' || char === "'" || char === "`") {
      const start = index;
      for (index++; index < expression.length; index++) {
        if (expression[index] === "\\") index++;
        else if (expression[index] === char) break;
      }
      const content = expression.slice(start + 1, index);
      if (depth === 0 && content.trim().length > 0) literals.push(content);
    }
  }

  return literals;
}

/** Every non-test .ts file under src/, recursively. */
function sources(dir: string = SRC): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sources(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

/** `src`-relative path, for readable violation messages. */
function label(file: string): string {
  return relative(SRC, file).split(sep).join("/");
}

describe("callerFacingExpressions", () => {
  it("cuts an expression at the comma that closes it", () => {
    expect(callerFacingExpressions("{ response: result.say, flowCompleted: true }")).toEqual([
      "result.say",
    ]);
  });

  it("keeps a call's arguments, commas and all, in one expression", () => {
    expect(
      callerFacingExpressions('{ response: getFlowPhrase(lang, "error", dir), error: true }'),
    ).toEqual(['getFlowPhrase(lang, "error", dir)']);
  });

  it("spans the line breaks of a wrapped expression", () => {
    const source = "{\n  response:\n    a.b ||\n    c(d, e),\n  flowCompleted: false,\n}";
    expect(callerFacingExpressions(source)).toEqual(["a.b ||\n    c(d, e)"]);
  });

  it("ends at the closing brace when the value is last in the object", () => {
    expect(callerFacingExpressions("{ response: phrase }")).toEqual(["phrase"]);
  });

  it("ignores a response mentioned in a comment", () => {
    expect(callerFacingExpressions('// response: "hardcoded"\nconst x = 1;')).toEqual([]);
  });

  it("finds the messaging fields too, not just the spoken one", () => {
    const source = '{ smsContent: "sms", whatsappContent: "whatsapp" }';
    expect(callerFacingExpressions(source)).toEqual(['"sms"', '"whatsapp"']);
  });

  // A `/*` inside a string must not be read as the start of a comment, or
  // everything up to the next doc comment stops being scanned at all.
  it("keeps scanning after a string containing a comment opener", () => {
    const source = [
      'const glob = "/call/*";',
      'const r = { response: "Hardcoded." };',
      "/** A doc comment, whose terminator would end the mistaken comment. */",
    ].join("\n");
    expect(callerFacingExpressions(source)).toEqual(['"Hardcoded."']);
  });

  it("keeps a URL literal intact instead of cutting it at the scheme", () => {
    expect(callerFacingExpressions('{ response: "https://example.com/help" }')).toEqual([
      '"https://example.com/help"',
    ]);
  });
});

describe("callArguments", () => {
  it("splits a call's arguments at its own depth", () => {
    expect(callArguments("sayTwiml(message, language, config)", "sayTwiml")).toEqual([
      ["message", "language", "config"],
    ]);
  });

  it("keeps a nested call's commas inside one argument", () => {
    expect(callArguments('getPhrase(resolveLanguage(a, b), "error", dir)', "getPhrase")).toEqual([
      ["resolveLanguage(a, b)", '"error"', "dir"],
    ]);
  });

  it("keeps a comma inside a string literal in one argument", () => {
    expect(callArguments('sayTwiml("one, two", language, config)', "sayTwiml")).toEqual([
      ['"one, two"', "language", "config"],
    ]);
  });

  it("spans a call wrapped over several lines", () => {
    const source = 'getChannelPhrase(\n  channel,\n  language,\n  "greeting",\n  dir,\n)';
    expect(callArguments(source, "getChannelPhrase")).toEqual([
      ["channel", "language", '"greeting"', "dir", ""],
    ]);
  });

  it("finds every call site, not just the first", () => {
    expect(callArguments("sayTwiml(a, b, c); sayTwiml(d, e, f);", "sayTwiml")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("reports no arguments for a zero-argument call", () => {
    expect(callArguments("getPhrase()", "getPhrase")).toEqual([[]]);
  });

  it("ignores a method call that merely ends in the same name", () => {
    expect(callArguments("phrases.getPhrase(a)", "getPhrase")).toEqual([]);
  });

  it("ignores a call written in a comment", () => {
    expect(callArguments('// getPhrase("en", "error")\nconst x = 1;', "getPhrase")).toEqual([]);
  });
});

describe("topLevelLiterals", () => {
  it("flags a bare literal", () => {
    expect(topLevelLiterals('"Could you provide more details?"')).toEqual([
      "Could you provide more details?",
    ]);
  });

  it("flags a literal used as a fallback", () => {
    expect(topLevelLiterals('extraction.nextPrompt || "Say more."')).toEqual(["Say more."]);
  });

  it("ignores a phrase key passed to a lookup", () => {
    expect(topLevelLiterals('getFlowPhrase(language, "needMoreDetails", dir)')).toEqual([]);
  });

  it("ignores the empty string, which delivers nothing to the caller", () => {
    expect(topLevelLiterals('""')).toEqual([]);
  });

  it("flags a template literal with content", () => {
    // Assembled rather than written inline so the placeholder stays literal.
    const interpolated = `Thanks, $${"{name}"}.`;
    expect(topLevelLiterals(`\`${interpolated}\``)).toEqual([interpolated]);
  });
});

describe("caller-facing text comes from the phrase files", () => {
  it("scans the whole src tree, so the guard cannot pass vacuously", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(20);
    // The rules only bite where the shapes they look for exist, so pin that
    // each one actually has something to scan.
    expect(files.some((f) => callerFacingExpressions(readFileSync(f, "utf8")).length > 0)).toBe(
      true,
    );
    expect(
      files.some((f) =>
        TWIML_BUILDERS.some((b) => callArguments(readFileSync(f, "utf8"), b.name).length > 0),
      ),
    ).toBe(true);
    expect(
      files.some((f) =>
        PHRASE_LOOKUPS.some((l) => callArguments(readFileSync(f, "utf8"), l.name).length > 0),
      ),
    ).toBe(true);
  });

  it("has no hardcoded response, smsContent or whatsappContent anywhere in src", () => {
    const violations: string[] = [];
    for (const file of sources()) {
      for (const expression of callerFacingExpressions(readFileSync(file, "utf8"))) {
        for (const literal of topLevelLiterals(expression)) {
          violations.push(`${label(file)}: ${literal}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("writes TwiML only in core/twiml.ts, so nothing bypasses the phrase and escaping layer", () => {
    const violations: string[] = [];
    for (const file of sources()) {
      if (label(file) === TWIML_MODULE.split(sep).join("/")) continue;
      const stripped = stripComments(readFileSync(file, "utf8"));
      for (const marker of TWIML_MARKERS) {
        if (stripped.includes(marker)) violations.push(`${label(file)}: ${marker}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("passes no literal message into a TwiML builder", () => {
    const violations: string[] = [];
    for (const file of sources()) {
      const source = readFileSync(file, "utf8");
      for (const { name, messageArg } of TWIML_BUILDERS) {
        for (const args of callArguments(source, name)) {
          const argument = args[messageArg];
          if (!argument) continue;
          for (const literal of topLevelLiterals(argument)) {
            violations.push(`${label(file)}: ${name}(... ${literal} ...)`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("passes no literal language into a phrase lookup, so detection reaches every phrase", () => {
    const violations: string[] = [];
    for (const file of sources()) {
      const source = readFileSync(file, "utf8");
      for (const { name, languageArg } of PHRASE_LOOKUPS) {
        for (const args of callArguments(source, name)) {
          const argument = args[languageArg];
          if (!argument) continue;
          for (const literal of topLevelLiterals(argument)) {
            violations.push(`${label(file)}: ${name}("${literal}", ...)`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
