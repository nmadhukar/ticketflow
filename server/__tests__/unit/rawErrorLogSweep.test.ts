import fs from "fs";
import path from "path";

/**
 * R63: an error log carries the key or id and the error's TYPE (`describeError` / `logRouteError`
 * in server/http/errors.ts), never the caught object or its text. SDK, database and HTTP errors
 * hold request bodies, SQL parameters, emails and tokens.
 *
 * This scans server/**\/*.ts for `console.error(...)` / `console.warn(...)` calls and fails with
 * file:line when an argument carries a caught error or its text. An error is a name bound by
 * `catch (x)` or by a callback `(x) =>` in the 60 lines above. The forms caught:
 *   - the bare error (`console.error("x", err)`), for a catch binding of any name and for a callback
 *     parameter with an error-like name (`err`, `error`, `reason`, `arg0`, ...);
 *   - `.message` / `.stack` of any bound name, wherever it sits (a ternary, a template literal);
 *   - a template literal that interpolates the bound name (`${err}` is its text);
 *   - an object literal that carries it, shorthand (`{ err }`) or keyed (`{ error: err }`);
 *   - a shortcut variable (`const msg = err.message; ... console.error("x", msg)`, `let` too).
 * The detector is checked against fixtures below so none of these forms can silently stop
 * being detected.
 *
 * Skipped: comments; server/__tests__/**; server/seed/** (one-shot seed scripts run by hand, whose
 * output goes to the operator's terminal); and the one startup handler in server/index.ts
 * ("Server startup error:"), where the process is about to exit and the operator needs the real error.
 */
const SERVER_DIR = path.resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set(["__tests__", "node_modules", "seed"]);
const ALLOWED = new Set(["index.ts:Server startup error:"]);
const ERROR_LIKE = /^(e|e\d|err|error|ex|exc|exception|reason|cause|failure|arg\d*|\w+Error|\w+Err)$/;
const IDENT = "[A-Za-z_$][\\w$]*";
const LOOKBACK = 60;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Top-level comma split of an argument list. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += text[++i] ?? "";
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

type Binding = "caught" | "param" | "value";

/** What `id` is at `lineIdx`: the nearest binding or declaration in the lines above wins. */
function bindingOf(lines: string[], lineIdx: number, id: string): { kind: Binding; line: number } | null {
  const escaped = id.replace(/\$/g, "\\$");
  const caught = new RegExp(`catch\\s*\\(\\s*${escaped}\\b`);
  const param = new RegExp(`\\(\\s*${escaped}\\s*(:[^)]*)?\\)\\s*=>|[(,\\s]${escaped}\\s*=>`);
  const declared = new RegExp(`\\b(const|let|var)\\s+${escaped}\\b`);
  for (let i = lineIdx; i >= Math.max(0, lineIdx - LOOKBACK); i--) {
    if (caught.test(lines[i])) return { kind: "caught", line: i };
    if (param.test(lines[i])) return { kind: "param", line: i };
    if (declared.test(lines[i])) return { kind: "value", line: i };
  }
  return null;
}

/** Every name bound by `catch (x)` or a callback `(x) =>` in the lookback window. */
function boundErrorNames(lines: string[], lineIdx: number): string[] {
  const names = new Set<string>();
  const patterns = [
    new RegExp(`catch\\s*\\(\\s*(${IDENT})`, "g"),
    new RegExp(`\\(\\s*(${IDENT})\\s*(?::[^)]*)?\\)\\s*=>`, "g"),
    new RegExp(`(?:^|[(,\\s])(${IDENT})\\s*=>`, "g"),
  ];
  for (let i = lineIdx; i >= Math.max(0, lineIdx - LOOKBACK); i--) {
    for (const re of patterns) for (const m of Array.from(lines[i].matchAll(re))) names.add(m[1]);
  }
  return Array.from(names);
}

/** True when `expr` is, or carries the text of, one of `names`. `shortcut` resolves a plain variable. */
function carriesError(expr: string, names: string[], shortcut: (id: string) => boolean): boolean {
  const e = expr.trim();
  for (const n of names) {
    const id = n.replace(/\$/g, "\\$");
    if (new RegExp(`(?<![\\w$.])${id}\\s*\\??\\.\\s*(message|stack)\\b`).test(e)) return true; // err.message, err?.stack
    if (new RegExp(`\\$\\{\\s*${id}\\s*\\}`).test(e)) return true; // `${err}`
    if (e.startsWith("{") && new RegExp(`[{,]\\s*${id}\\s*(?=[,}])|:\\s*${id}\\s*(?=[,}])`).test(e)) return true; // { err } / { error: err }
  }
  const bare = /^[A-Za-z_$][\w$]*$/.test(e);
  return bare && shortcut(e);
}

/** 1-based lines of console.error / console.warn calls in `src` that log a caught error or its text. */
export function rawErrorLogLines(src: string, rel = "x.ts"): number[] {
  const found: number[] = [];
  const lines = src.split("\n");
  const re = /console\.(error|warn)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineIdx = src.slice(0, m.index).split("\n").length - 1;
    const before = lines[lineIdx].slice(0, lines[lineIdx].indexOf("console."));
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[lineIdx]) || before.includes("//")) continue;
    let i = m.index + m[0].length;
    let depth = 1;
    let quote = "";
    while (depth > 0 && i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    const args = splitArgs(src.slice(m.index + m[0].length, i - 1));
    const names = boundErrorNames(lines, lineIdx);

    const shortcut = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const b = bindingOf(lines, lineIdx, id);
      if (!b) return false;
      if (b.kind === "caught") return true;
      if (b.kind === "param") return ERROR_LIKE.test(id);
      // A plain `const x = <expr>` (an OAuth query parameter, say) is clean unless <expr> carries an error.
      const tail = lines.slice(b.line, b.line + 4).join("\n");
      const decl = new RegExp(`\\b(const|let|var)\\s+${id.replace(/\$/g, "\\$")}\\b[^=]*=([^;]*)`).exec(tail);
      return !!decl && carriesError(decl[2], names, (other) => shortcut(other, seen));
    };

    const hit = args.some((a, n) => {
      // The label (first argument) is text; only a template literal in it can carry an error.
      if (n === 0 && /^["'`]/.test(a)) return a.startsWith("`") && carriesError(a, names, () => false);
      return carriesError(a, names, shortcut);
    });
    if (!hit) continue;
    const label = String(args[0]).replace(/^["'`]|["'`]$/g, "");
    if (ALLOWED.has(`${rel}:${label}`)) continue;
    found.push(lineIdx + 1);
  }
  return found;
}

function rawErrorLogSites(): string[] {
  const found: string[] = [];
  for (const file of walk(SERVER_DIR)) {
    const rel = path.relative(SERVER_DIR, file).split(path.sep).join("/");
    for (const line of rawErrorLogLines(fs.readFileSync(file, "utf8"), rel)) found.push(`${rel}:${line}`);
  }
  return found;
}

describe("raw error log sweep (R63)", () => {
  it("no console.error / console.warn logs a caught error object or its text", () => {
    expect(rawErrorLogSites()).toEqual([]);
  });

  describe("detector (fixtures, one per form)", () => {
    const flagged = (body: string) => rawErrorLogLines(body).length;

    it.each([
      ["bare catch binding", `try { f(); } catch (e) { console.error("x:", e); }`],
      ["bare catch binding with any name", `try { f(); } catch (whatever) { console.error("x:", whatever); }`],
      ["callback parameter named arg0", `p.catch((arg0) => console.error("x:", arg0));`],
      ["callback parameter, no parentheses", `p.catch(reason => console.warn("x:", reason));`],
      ["ternary on .message", `try { f(); } catch (error) { console.error("x:", error instanceof Error ? error.message : "unknown"); }`],
      ["optional-chained .message", `try { f(); } catch (error) { console.error("x:", error?.message); }`],
      ["stack", `try { f(); } catch (error) { console.error("x:", error.stack); }`],
      ["template literal with .message", "try { f(); } catch (err) { console.error(`x: ${err.message}`); }"],
      ["template literal with the error", "try { f(); } catch (err) { console.error(`x: ${err}`); }"],
      ["shorthand object", `try { f(); } catch (err) { console.error("x", { err }); }`],
      ["keyed object", `try { f(); } catch (err) { console.error("x", { error: err }); }`],
      ["object with .message", `try { f(); } catch (err) { console.error("x", { reason: err.message }); }`],
      ["const shortcut", `try { f(); } catch (err) {\n  const msg = err.message;\n  console.error("x", msg);\n}`],
      ["let shortcut with a ternary", `try { f(); } catch (err) {\n  let text = err instanceof Error ? err.message : String(err);\n  console.warn("x", text);\n}`],
      ["const shortcut of a template literal", "try { f(); } catch (err) {\n  const msg = `failed: ${err}`;\n  console.error(msg);\n}"],
      ["chained shortcut", `try { f(); } catch (err) {\n  const a = err.message;\n  const b = a;\n  console.error("x", b);\n}`],
    ])("flags %s", (_name, body) => {
      expect(flagged(body)).toBe(1);
    });

    it.each([
      ["describeError", `try { f(); } catch (err) { console.error("x", describeError(err)); }`],
      ["logRouteError-style template", "try { f(); } catch (err) { console.error(`x [${describeError(err)}]`); }"],
      ["error name only", `try { f(); } catch (err) { console.error("x", err instanceof Error ? err.name : "unknown"); }`],
      ["a plain value named error", `const error = req.query.error;\nconsole.warn("oauth", error);`],
      ["a callback value that is not an error", `items.forEach((item) => console.warn("skipped", item));`],
      ["a message that is not from an error", `const msg = "hello";\nconsole.error("x", msg);`],
      ["a commented-out call", `try { f(); } catch (err) {\n  // console.error("x", err.message);\n}`],
    ])("does not flag %s", (_name, body) => {
      expect(flagged(body)).toBe(0);
    });
  });
});
