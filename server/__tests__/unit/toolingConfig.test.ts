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

  it("scripts/test-db.mjs and the integration env helper default to the same database URL", () => {
    const urlOf = (text: string) => /"(postgres:\/\/[^"]+)"/.exec(text)?.[1];
    const script = urlOf(read("scripts/test-db.mjs"));
    const helper = urlOf(read("server/__tests__/integration/helpers/env.ts"));
    expect(script).toBeDefined();
    expect(script).toBe(helper);
  });
});
