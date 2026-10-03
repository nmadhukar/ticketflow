import fs from "fs";
import path from "path";

/**
 * Error contract sweep (Task 17): every 4xx/5xx a handler writes itself is
 * `{ error: <code>, message, details? }`. A body that carries `message` but no
 * `error` code is the old ad-hoc `{ message }` shape the clients cannot branch
 * on. Handlers use HttpError + next(error), or `fail(res, status, message)`
 * from server/http/errors.ts, which builds the same body.
 *
 * Also: no 500 may carry an exception's text.
 */
const SERVER_DIR = path.resolve(__dirname, "..", "..");
const ALLOWED_FILES = new Set([path.join("http", "errors.ts")]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  status: string;
  body: string;
}

/** Every `.status(<x>).json(<body>)` with the balanced body text. */
function jsonSites(): Site[] {
  const sites: Site[] = [];
  for (const file of walk(SERVER_DIR)) {
    const rel = path.relative(SERVER_DIR, file);
    if (ALLOWED_FILES.has(rel)) continue;
    const src = fs.readFileSync(file, "utf8");
    const re = /\.status\(([^)]*)\)\s*\.json\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length;
      let depth = 1;
      while (depth > 0 && i < src.length) {
        const c = src[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      }
      sites.push({
        file: rel.split(path.sep).join("/"),
        line: src.slice(0, m.index).split("\n").length,
        status: m[1].trim(),
        body: src.slice(m.index + m[0].length, i - 1).trim(),
      });
    }
  }
  return sites;
}

const isErrorStatus = (s: string) => !/^[23]\d\d$/.test(s);

describe("error contract sweep", () => {
  const sites = jsonSites();

  it("finds the handlers it is meant to police", () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it("no error response is a bare { message } without an error code", () => {
    const offenders = sites
      // `error: code` or the shorthand `{ error, message }` both carry the code.
      .filter((s) => isErrorStatus(s.status) && s.body.startsWith("{") && !/\berror\s*[:,}]/.test(s.body))
      .map((s) => `${s.file}:${s.line} status(${s.status}) ${s.body.replace(/\s+/g, " ").slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it("no hand-written 500 puts an exception's text in the response", () => {
    const offenders = sites
      .filter(
        (s) =>
          /^5\d\d$/.test(s.status) &&
          /(error|err|e)\??\.(message|stack)|\$\{\s*(error|err|e)\b|String\(\s*(error|err|e)\s*\)/.test(s.body)
      )
      .map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });

  it("routes never log a raw error object that can carry user or secret content", () => {
    const rawLog = /console\.error\(\s*["'`][^"'`]*["'`]\s*,\s*(error|err|e)\s*\)/;
    const offenders: string[] = [];
    for (const file of [
      path.join(SERVER_DIR, "routes", "index.ts"),
      path.join(SERVER_DIR, "services", "microsoftTeams.ts"),
    ]) {
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (rawLog.test(l)) offenders.push(`${path.relative(SERVER_DIR, file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
