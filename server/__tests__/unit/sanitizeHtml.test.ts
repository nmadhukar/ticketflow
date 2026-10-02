import express from "express";
import request from "supertest";
import { sanitizeRichHtml, stripActiveMarkup } from "../../security/sanitizeHtml";
import { installRequestPipeline } from "../../security/pipeline";
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

describe("stripActiveMarkup", () => {
  it("leaves ordinary text, symbols and entities untouched (no double escaping)", () => {
    for (const text of ["Tom & Jerry", "a < b and c > d", "use <div> here", "x &amp; y", "100% sure_thing"]) {
      expect(stripActiveMarkup(text)).toBe(text);
    }
  });

  it("removes script blocks, handlers and javascript: urls", () => {
    expect(stripActiveMarkup("hi<script>alert(1)</script>there")).toBe("hithere");
    expect(stripActiveMarkup('<img src=x onerror="alert(1)">')).toBe("<img src=x>");
    expect(stripActiveMarkup('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
  });

  it("cannot be reassembled from nested fragments", () => {
    expect(stripActiveMarkup("<scr<script></script>ipt>alert(1)</scr<script></script>ipt>")).not.toMatch(/<\s*script/i);
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

  it("sanitises nested strings in a parsed JSON body", async () => {
    const res = await request(app)
      .post("/echo")
      .send({
        title: "a < b & c",
        nested: { deep: ["ok", "x<script>alert(1)</script>y", { more: '<img src=x onerror="z()">' }] },
        password: "Pa<script>ss",
      });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("a < b & c");
    expect(res.body.nested.deep[0]).toBe("ok");
    expect(res.body.nested.deep[1]).toBe("xy");
    expect(res.body.nested.deep[2].more).toBe("<img src=x>");
    // credentials are never rewritten
    expect(res.body.password).toBe("Pa<script>ss");
  });

  it("sanitises urlencoded bodies and query strings", async () => {
    const form = await request(app).post("/echo").type("form").send("a=1%3Cscript%3Ex%3C%2Fscript%3E");
    expect(form.body.a).toBe("1");
    const q = await request(app).get("/echo").query({ s: "q<script>x</script>" });
    expect(q.body.s).toBe("q");
  });

  it("sends a Content-Security-Policy whose script-src has no unsafe-inline", async () => {
    const res = await request(app).get("/echo");
    const csp = String(res.headers["content-security-policy"]);
    const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
