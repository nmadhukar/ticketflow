import fs from "fs";
import path from "path";

/**
 * R63: an error log carries the key or id and the error's TYPE (`describeError` / `logRouteError`
 * in server/http/errors.ts), never the caught object or its text. SDK, database and HTTP errors
 * hold request bodies, SQL parameters, emails and tokens.
 *
 * This scans server/**\/*.ts for `console.error(...)` / `console.warn(...)` calls with a bare
 * identifier argument that is a caught error (a `catch (x)` or a callback `(x) =>` binding in the
 * lines above), and fails with file:line.
 *
 * Skipped: comments; server/__tests__/**; server/seed/** (one-shot seed scripts run by hand, whose
 * output goes to the operator's terminal); and the one startup handler in server/index.ts
 * ("Server startup error:"), where the process is about to exit and the operator needs the real error.
 */
const SERVER_DIR = path.resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set(["__tests__", "node_modules", "seed"]);
const ALLOWED = new Set(["index.ts:Server startup error:"]);
const ERROR_NAME = /^(e|e\d|err|error|ex|exception|\w+Error|\w+Err)$/;

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

function isBound(lines: string[], lineIdx: number, id: string): boolean {
  const re = new RegExp(`catch\\s*\\(\\s*${id}\\b|\\(\\s*${id}\\s*(:[^)]*)?\\)\\s*=>|[(,\\s]${id}\\s*=>`);
  // A `const x =` found first (scanning upward) means x is a plain value, e.g. an OAuth query parameter.
  const declared = new RegExp(`\\b(const|let|var)\\s+${id}\\b`);
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 60); i--) {
    if (declared.test(lines[i])) return false;
    if (re.test(lines[i])) return true;
  }
  return false;
}

function rawErrorLogSites(): string[] {
  const found: string[] = [];
  for (const file of walk(SERVER_DIR)) {
    const rel = path.relative(SERVER_DIR, file).split(path.sep).join("/");
    const src = fs.readFileSync(file, "utf8");
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
      const raw = args.slice(1).filter((a) => /^[A-Za-z_$][\w$]*$/.test(a) && ERROR_NAME.test(a) && isBound(lines, lineIdx, a));
      if (raw.length === 0) continue;
      const label = String(args[0]).replace(/^["'`]|["'`]$/g, "");
      if (ALLOWED.has(`${rel}:${label}`)) continue;
      found.push(`${rel}:${lineIdx + 1}`);
    }
  }
  return found;
}

describe("raw error log sweep (R63)", () => {
  it("no console.error / console.warn logs a caught error object", () => {
    expect(rawErrorLogSites()).toEqual([]);
  });
});
