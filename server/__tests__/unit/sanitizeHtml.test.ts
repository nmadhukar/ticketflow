import { spawnSync } from "node:child_process";
import path from "node:path";
import express from "express";
import request from "supertest";
import { sanitizeRichHtml } from "../../security/sanitizeHtml";
import { installRequestPipeline, contentSecurityDirectives } from "../../security/pipeline";
import { sanitizeDeep } from "../../security/validation";
import { isDevelopmentEnv, unsetNodeEnvBootProblem } from "../../env";
import { escapeLike, containsPattern } from "../../utils/like";

describe("sanitizeRichHtml", () => {
  it("drops handlers and scripts and keeps allowed markup", () => {
    expect(
      sanitizeRichHtml('<img src=x onerror=alert(1)><script>alert(2)</script><p>ok</p>'),
    ).toBe('<img src="x" /><p>ok</p>');
  });

  it("removes javascript: links and event handlers, forces rel on links", () => {
    const out = sanitizeRichHtml(
      '<a href="javascript:alert(1)" onclick="x()">a</a><a href="https://e.test/p">b</a>',
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('href="https://e.test/p"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("drops iframes, styles and unknown tags but keeps their text", () => {
    const out = sanitizeRichHtml('<iframe src="https://e.test"></iframe><style>p{}</style><blink>hi</blink>');
    expect(out).toBe("hi");
  });

  it("is idempotent and tolerates non-strings", () => {
    const once = sanitizeRichHtml("<p>a &amp; b</p><script>x</script>");
    expect(sanitizeRichHtml(once)).toBe(once);
    expect(sanitizeRichHtml(undefined)).toBe("");
    expect(sanitizeRichHtml(null)).toBe("");
  });
});

describe("sanitizeRichHtml cost", () => {
  it("stays bounded on a 64 KB adversarial guide body", () => {
    const parts = ["<", " ", "<script", "<a onclick=", '<img src="x" onerror=', "<style ", "on"];
    let body = "";
    while (body.length < 64 * 1024) body += parts.join("") + "<p>x</p>";
    const start = Date.now();
    sanitizeRichHtml(body.slice(0, 64 * 1024));
    sanitizeRichHtml("<".repeat(64 * 1024));
    sanitizeRichHtml("<script".repeat(8 * 1024));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(containsPattern("a%b")).toBe("%a\\%b%");
  });
});

describe("request pipeline order", () => {
  const app = express();
  installRequestPipeline(app, { bodyLimit: "1mb", sanitize: true });
  app.post("/echo", (req, res) => res.json(req.body));
  app.get("/echo", (req, res) => res.json(req.query));

  const LOSSLESS = [
    "The <style attribute is not applied and here is the rest",
    "We use List<Object> in the API",
    "if count < 5 and onboarding = done then close",
    "Footer shows <script>track()</script> twice",
    "Tom & Jerry <b>x</b> x &amp; y 100% sure_thing",
  ];

  it("reaches nested strings in a parsed JSON body (NUL stripped) and changes no other text", async () => {
    const res = await request(app)
      .post("/echo")
      .send({
        title: LOSSLESS[0],
        nested: { deep: ["ok", "x\u0000y", { more: "a\u0000b" }, ...LOSSLESS] },
        password: "Pa\u0000ss",
      });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(LOSSLESS[0]);
    expect(res.body.nested.deep.slice(0, 3)).toEqual(["ok", "xy", { more: "ab" }]);
    expect(res.body.nested.deep.slice(3)).toEqual(LOSSLESS);
    // credentials are never rewritten
    expect(res.body.password).toBe("Pa\u0000ss");
  });

  it("round-trips urlencoded bodies and query strings, stripping only NUL", async () => {
    const form = await request(app).post("/echo").type("form").send({ a: LOSSLESS[1], b: "x\u0000y" });
    expect(form.body).toEqual({ a: LOSSLESS[1], b: "xy" });
    const q = await request(app).get("/echo").query({ s: LOSSLESS[3] });
    expect(q.body.s).toBe(LOSSLESS[3]);
  });

  it("drops __proto__, constructor and prototype keys, at any depth", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"__proto__":{"role":"admin"},"title":"x","a":{"constructor":{"x":1},"prototype":2,"ok":3}}');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ title: "x", a: { ok: 3 } });
  });

  it("does not let __proto__ in a body pollute what handlers read", async () => {
    let seen: Record<string, unknown> = {};
    const probe = express();
    installRequestPipeline(probe, { bodyLimit: "1mb", sanitize: true });
    probe.post("/p", (req, res) => {
      seen = req.body;
      res.json({});
    });
    await request(probe)
      .post("/p")
      .set("Content-Type", "application/json")
      .send('{"__proto__":{"role":"admin"},"title":"x"}');
    expect(seen.role).toBeUndefined();
    expect("role" in seen).toBe(false);
    expect(Object.keys(seen)).toEqual(["title"]);
  });

  it("processes a 1 MB adversarial string quickly (linear, no regex backtracking)", async () => {
    const nasty = ("< " + "<script " + "<a onclick=" + "on ").repeat(40000).slice(0, 1024 * 1024);
    const start = Date.now();
    const out = sanitizeDeep({ a: { b: [nasty] } }) as { a: { b: string[] } };
    expect(Date.now() - start).toBeLessThan(500);
    expect(out.a.b[0]).toBe(nasty);

    const probe = express();
    installRequestPipeline(probe, { bodyLimit: "2mb", sanitize: true });
    probe.post("/p", (req, res) => res.json({ n: req.body.t.length }));
    const t0 = Date.now();
    const res = await request(probe).post("/p").send({ t: nasty });
    expect(res.body.n).toBe(nasty.length);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("sends a Content-Security-Policy whose script-src has no unsafe-inline", async () => {
    const res = await request(app).get("/echo");
    const csp = String(res.headers["content-security-policy"]);
    const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});

describe("development switch (one helper for the CSP and the server entry)", () => {
  it("treats unset or empty NODE_ENV as development, like Express; production and test are strict", () => {
    expect(["", "development"].map((e) => isDevelopmentEnv(e))).toEqual([true, true]);
    expect(["production", "test", "staging"].map((e) => isDevelopmentEnv(e))).toEqual([false, false, false]);
    expect(contentSecurityDirectives("development").scriptSrc).toContain("'unsafe-inline'");
    expect(contentSecurityDirectives("").scriptSrc).toContain("'unsafe-inline'");
    for (const env of ["production", "test"]) {
      expect(contentSecurityDirectives(env).scriptSrc).toEqual(["'self'"]);
    }
    // Unset (the `npm run dev` case) is read from the process environment.
    const saved = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect(isDevelopmentEnv()).toBe(true);
      expect(contentSecurityDirectives().scriptSrc).toContain("'unsafe-inline'");
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe("FU5: built server with NODE_ENV unset", () => {
  const dist = "/app/dist";
  it("refuses with one line when unset and the entry file is inside dist", () => {
    const line = unsetNodeEnvBootProblem(undefined, "/app/dist/index.js", dist);
    expect(line).toMatch(/NODE_ENV is not set/);
    expect(line).not.toMatch(/\n/);
    expect(unsetNodeEnvBootProblem("", "/app/dist/index.js", dist)).not.toBeNull();
    // Windows separators
    expect(unsetNodeEnvBootProblem(undefined, "C:\\app\\dist\\index.js", "C:\\app\\dist")).not.toBeNull();
  });
  it("lets tsx (npm run dev) and any set NODE_ENV through", () => {
    expect(unsetNodeEnvBootProblem(undefined, "/app/server/index.ts", dist)).toBeNull();
    expect(unsetNodeEnvBootProblem(undefined, "/app/distant/index.js", dist)).toBeNull();
    for (const env of ["production", "development", "test"]) {
      expect(unsetNodeEnvBootProblem(env, "/app/dist/index.js", dist)).toBeNull();
    }
  });
});

describe("boot guard: a bad JWT_SECRET is a one-line refusal, not a stack trace", () => {
  it("production with a short JWT_SECRET exits 1 with one 'Startup refused' line", () => {
    const root = path.resolve(__dirname, "../../..");
    const res = spawnSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "-e", 'import "./server/bootGuard"; import "./server/security/jwt"; console.log("LOADED");'], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        APP_BASE_URL: "https://tickets.example.test",
        SESSION_SECRET: "k3Jx9mQ2vR8sT5wY1zB7nC4dF6gH0aLp",
        JWT_SECRET: "short-but-random-x7Qp",
      },
      timeout: 60000,
    });
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain("LOADED");
    expect(res.stderr).toContain("Startup refused");
    expect(res.stderr).toContain("JWT_SECRET is too short");
    expect(res.stderr).not.toMatch(/\n\s+at /);
  });
});

describe("FU5: sanitizeDeep has no depth limit", () => {
  it("cleans a value nested 5000 deep without overflowing, in linear time", () => {
    let body: unknown = { leaf: "a\u0000b", __proto__x: 1 };
    for (let i = 0; i < 5000; i++) body = i % 2 ? { n: body } : [body];
    const start = Date.now();
    let cur = sanitizeDeep(body) as any;
    expect(Date.now() - start).toBeLessThan(500);
    while (!("leaf" in cur)) cur = Array.isArray(cur) ? cur[0] : cur.n;
    expect(cur.leaf).toBe("ab");
  });
  it("still cleans below the old depth of 20 and keeps credentials and forbidden keys handling", () => {
    let body: any = JSON.parse('{"__proto__":{"x":1},"password":"p\\u0000q","t":"x\\u0000y"}');
    for (let i = 0; i < 30; i++) body = { n: body };
    let cur = sanitizeDeep(body) as any;
    for (let i = 0; i < 30; i++) cur = cur.n;
    expect(cur.t).toBe("xy");
    expect(cur.password).toBe("p\u0000q");
    expect(Object.keys(cur)).toEqual(["password", "t"]);
  });
});
