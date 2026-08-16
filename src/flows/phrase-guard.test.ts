/**
 * Phrase-layer guard for the flow engine.
 *
 * Everything the caller hears comes from `language/*.json`, so no value a
 * flow returns in `response`/`smsContent`/`whatsappContent` may be written as
 * a literal in the code: a literal is English forever, and a caller mid-flow
 * in French hears it. This scans `src/flows/` for that shape rather than
 * testing a return value, because the violation is a hardcoded string at a
 * call site, not a wrong output - the next English default someone types is
 * caught here instead of in production.
 *
 * Literals nested inside a call are fine and expected: the phrase *key* in
 * `getFlowPhrase(language, "needMoreDetails")` is not caller-facing text.
 * Developer-facing text (thrown Error messages, log lines) is out of scope -
 * it never reaches a caller.
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
import { join } from "node:path";

const FLOWS = import.meta.dir;

/** The result fields a caller actually hears or reads. */
const CALLER_FACING_FIELDS = ["response", "smsContent", "whatsappContent"];

/**
 * Blank out comments so text written in prose is not scanned. The string and
 * template alternatives come first so a `//` or `/*` *inside* a string is
 * consumed as part of that string - without them, the `/*` in a route glob or
 * a URL blanks everything up to the next doc comment and the gate quietly
 * stops gating. Same reasoning as `src/seam-guards.test.ts`.
 */
function stripComments(source: string): string {
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

/** Every non-test .ts file under src/flows/, recursively. */
function flowSources(dir: string = FLOWS): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...flowSources(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
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

describe("flow responses come from the phrase files", () => {
  it("scans the whole flows directory, so the guard cannot pass vacuously", () => {
    const withResponses = flowSources().filter(
      (file) => callerFacingExpressions(readFileSync(file, "utf8")).length > 0,
    );
    expect(withResponses.length).toBeGreaterThan(0);
  });

  it("has no hardcoded caller-facing response anywhere in src/flows", () => {
    const violations: string[] = [];
    for (const file of flowSources()) {
      for (const expression of callerFacingExpressions(readFileSync(file, "utf8"))) {
        for (const literal of topLevelLiterals(expression)) {
          violations.push(`${file.slice(FLOWS.length + 1)}: ${literal}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
