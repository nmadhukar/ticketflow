/**
 * Guards for the build/test tooling itself, read as text because the jest
 * config and scripts/test-db.mjs are ES modules the CommonJS test runtime
 * cannot import.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("e2e guards", () => {
  const preload = path.join(root, "e2e", "no-egress.cjs");
  const runNode = (script: string, log: string) =>
    spawnSync(process.execPath, ["--require", preload, "-e", script], {
      encoding: "utf8",
      env: { ...process.env, E2E_EGRESS_LOG: log },
      timeout: 20000,
    });

  it("the no-egress preload refuses a non-loopback connection, records it, and allows loopback", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "egress-"));
    const log = path.join(dir, "egress.log");
    try {
      // A loopback server answers; an external connect must throw before any DNS or network use.
      const script = `
        const net = require("node:net");
        const srv = net.createServer((s) => s.end("ok")).listen(0, "127.0.0.1", () => {
          const c = net.connect(srv.address().port, "127.0.0.1");
          c.on("data", () => { console.log("LOOPBACK_OK"); srv.close(); });
          let blocked = false;
          try { net.connect(443, "bedrock-runtime.us-east-1.amazonaws.com"); } catch (e) { blocked = /E2E_EGRESS_BLOCKED/.test(String(e)); }
          console.log(blocked ? "EXTERNAL_BLOCKED" : "EXTERNAL_ALLOWED");
        });`;
      const res = runNode(script, log);
      expect(res.stdout).toContain("LOOPBACK_OK");
      expect(res.stdout).toContain("EXTERNAL_BLOCKED");
      expect(readFileSync(log, "utf8")).toContain("E2E_EGRESS_BLOCKED bedrock-runtime.us-east-1.amazonaws.com:443");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the no-egress preload allows exactly the DATABASE_URL host:port and refuses any other non-loopback peer", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "egress-"));
    const log = path.join(dir, "egress.log");
    try {
      const script = `
        const net = require("node:net");
        const attempt = (host, port) => {
          try { const s = net.connect(port, host); s.on("error", () => {}); s.destroy(); return "ALLOWED"; }
          catch (e) { return /E2E_EGRESS_BLOCKED/.test(String(e)) ? "BLOCKED" : "OTHER"; }
        };
        console.log("db=" + attempt("db.egress-test.invalid", 5432));
        console.log("otherPort=" + attempt("db.egress-test.invalid", 5433));
        console.log("otherHost=" + attempt("bedrock-runtime.us-east-1.amazonaws.com", 443));
      `;
      const res = spawnSync(process.execPath, ["--require", preload, "-e", script], {
        encoding: "utf8",
        env: { ...process.env, E2E_EGRESS_LOG: log, DATABASE_URL: "postgres://u:p@db.egress-test.invalid:5432/ticketflow_test" },
        timeout: 20000,
      });
      expect(res.stdout).toContain("db=ALLOWED");
      expect(res.stdout).toContain("otherPort=BLOCKED");
      expect(res.stdout).toContain("otherHost=BLOCKED");
      const logged = readFileSync(log, "utf8");
      expect(logged).not.toContain("db.egress-test.invalid:5432");
      expect(logged).toContain("E2E_EGRESS_BLOCKED bedrock-runtime.us-east-1.amazonaws.com:443");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("the no-egress preload reads DATABASE_URL defensively (R54)", () => {
    // Prints ALLOWED/BLOCKED/OTHER per target. A target that is allowed really starts a connect
    // (to an address nothing answers) and destroys it at once, so no packet needs to be answered.
    const probe = (databaseUrl: string | undefined, targets: Array<[string, number]>) => {
      const dir = mkdtempSync(path.join(tmpdir(), "egress-"));
      const log = path.join(dir, "egress.log");
      try {
        const script = `
          const net = require("node:net");
          const attempt = (host, port) => {
            try { const s = net.connect(port, host); s.on("error", () => {}); s.destroy(); return "ALLOWED"; }
            catch (e) { return /E2E_EGRESS_BLOCKED/.test(String(e)) ? "BLOCKED" : "OTHER"; }
          };
          for (const [h, p] of ${JSON.stringify(targets)}) console.log(h + ":" + p + "=" + attempt(h, p));
        `;
        const env: NodeJS.ProcessEnv = { ...process.env, E2E_EGRESS_LOG: log };
        if (databaseUrl === undefined) delete env.DATABASE_URL;
        else env.DATABASE_URL = databaseUrl;
        const res = spawnSync(process.execPath, ["--require", preload, "-e", script], { encoding: "utf8", env, timeout: 20000 });
        return { status: res.status, out: res.stdout, err: res.stderr };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it("an empty DATABASE_URL loads without throwing and allows loopback only", () => {
      const r = probe("", [["127.0.0.1", 5432], ["db.egress-test.invalid", 5432]]);
      expect(r.status).toBe(0);
      expect(r.out).toContain("127.0.0.1:5432=ALLOWED");
      expect(r.out).toContain("db.egress-test.invalid:5432=BLOCKED");
    });

    it("an unparsable DATABASE_URL loads without throwing and allows loopback only", () => {
      const r = probe("not a url at all", [["localhost", 5432], ["db.egress-test.invalid", 5432]]);
      expect(r.status).toBe(0);
      expect(r.out).toContain("localhost:5432=ALLOWED");
      expect(r.out).toContain("db.egress-test.invalid:5432=BLOCKED");
    });

    it("a DATABASE_URL without a port allows the given host on 5432 and nothing else", () => {
      const r = probe("postgres://u:p@db.egress-test.invalid/ticketflow_test", [
        ["db.egress-test.invalid", 5432],
        ["db.egress-test.invalid", 5433],
        ["other.egress-test.invalid", 5432],
      ]);
      expect(r.status).toBe(0);
      expect(r.out).toContain("db.egress-test.invalid:5432=ALLOWED");
      expect(r.out).toContain("db.egress-test.invalid:5433=BLOCKED");
      expect(r.out).toContain("other.egress-test.invalid:5432=BLOCKED");
    });

    it("an IPv6 host in DATABASE_URL allows exactly that host and port, bracketed or not", () => {
      const r = probe("postgresql://u:p@[fd00::1]:6543/db", [
        ["fd00::1", 6543],
        ["[fd00::1]", 6543],
        ["fd00::1", 5432],
        ["[fd00::1]", 5432],
        ["fd00::2", 6543],
      ]);
      expect(r.status).toBe(0);
      expect(r.out).toContain("fd00::1:6543=ALLOWED");
      expect(r.out).toContain("[fd00::1]:6543=ALLOWED");
      expect(r.out).toContain("fd00::1:5432=BLOCKED");
      expect(r.out).toContain("[fd00::1]:5432=BLOCKED");
      expect(r.out).toContain("fd00::2:6543=BLOCKED");
    });
  });

  it("the playwright config rejects an invalid E2E_PORT with a clear message", () => {
    for (const bad of ["80", "70000", "abc", "5055.5"]) {
      const res = spawnSync("npx", ["playwright", "test", "--list"], {
        cwd: root,
        shell: true,
        encoding: "utf8",
        env: {
          ...process.env,
          E2E_PORT: bad,
          TEST_DATABASE_URL: "postgres://test:test@localhost:55433/ticketflow_test",
        },
        timeout: 60000,
      });
      expect(res.status).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toContain("E2E_PORT must be an integer from 1024 to 65535");
    }
  }, 240000);
});

describe("tooling config", () => {
  it("jest's ts transform pattern escapes the dot, so only .ts and .tsx files match", () => {
    const source = read("jest.config.mjs");
    const literal = /'(\^\.\+[^']*tsx\?\$)'/.exec(source)?.[1];
    expect(literal).toBeDefined();
    // The literal in the file is a JS string: "\\." there is "\." in the regex.
    const pattern = new RegExp(literal!.replace(/\\\\/g, "\\"));
    expect(pattern.test("a.ts")).toBe(true);
    expect(pattern.test("a.tsx")).toBe(true);
    // An unescaped dot would also match these.
    expect(pattern.test("atsx")).toBe(false);
    expect(pattern.test("a-ts")).toBe(false);
  });

  it("the Dockerfile CMD and the docker-compose app command run the same three steps in the same order (R66)", () => {
    const steps = (command: string) => command.split("&&").map((s) => s.trim());
    const expected = ["npm run db:migrate-sql", "npm run db:push", "node dist/index.js"];

    // CMD ["sh", "-c", "..."] is a JSON array; take the last CMD instruction.
    const cmdLines = read("Dockerfile").split(/\r?\n/).filter((l) => /^\s*CMD\s/.test(l));
    expect(cmdLines).toHaveLength(1);
    const cmd: string[] = JSON.parse(cmdLines[0].replace(/^\s*CMD\s+/, ""));
    expect(cmd.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(steps(cmd[2])).toEqual(expected);

    const compose = read("docker-compose.yml").split(/\r?\n/).find((l) => /^\s+command:\s/.test(l));
    expect(compose).toBeDefined();
    const composeCommand = /command:\s*sh -c "([^"]+)"/.exec(compose!)?.[1];
    expect(composeCommand).toBeDefined();
    expect(steps(composeCommand!)).toEqual(expected);
  });

  it("scripts/test-db.mjs and the integration env helper default to the same database URL", () => {
    const urlOf = (text: string) => /"(postgres:\/\/[^"]+)"/.exec(text)?.[1];
    const script = urlOf(read("scripts/test-db.mjs"));
    const helper = urlOf(read("server/__tests__/integration/helpers/env.ts"));
    expect(script).toBeDefined();
    expect(script).toBe(helper);
  });
});
