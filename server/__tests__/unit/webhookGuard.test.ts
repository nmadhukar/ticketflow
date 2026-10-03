import fs from "fs";
import https from "https";
import path from "path";
import type { AddressInfo } from "net";
import { HttpError } from "../../http/errors";
import {
  createPinnedLookup,
  isPrivateAddress,
  postWebhookJson,
  sendPinnedJson,
  validateWebhookUrl,
  WEBHOOK_TIMEOUT_MS,
} from "../../services/webhookGuard";
import { fakeWebhookTransport } from "../utils/fakeWebhookTransport";

const GOOD = "https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/ghi/jkl";

describe("validateWebhookUrl", () => {
  it("accepts https on *.webhook.office.com", () => {
    expect(validateWebhookUrl(GOOD).hostname).toBe("contoso.webhook.office.com");
  });

  it.each([
    ["http scheme", "http://contoso.webhook.office.com/x"],
    ["foreign host", "https://evil.example/hook"],
    ["suffix trick", "https://contoso.webhook.office.com.evil.example/x"],
    ["prefix trick", "https://evilwebhook.office.com/x"],
    ["the bare apex", "https://webhook.office.com/x"],
    ["credentials in the URL", "https://user:pw@contoso.webhook.office.com/x"],
    ["odd port", "https://contoso.webhook.office.com:8443/x"],
    ["IPv4 literal", "https://127.0.0.1/x"],
    ["IPv6 literal", "https://[::1]/x"],
    ["file scheme", "file:///etc/passwd"],
    ["not a URL", "not a url"],
    ["empty", ""],
  ])("refuses %s with 400", (_name, url) => {
    try {
      validateWebhookUrl(url);
      throw new Error("expected a refusal");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
    }
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "not-an-ip",
  ])("%s is refused", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["52.96.0.1", "172.32.0.1", "8.8.8.8", "2603:1026::1", "::ffff:8.8.8.8"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("createPinnedLookup (R44)", () => {
  type Answer = { address: string; family: number }[];
  const resolver = (answer: Answer | Error) => {
    const fn = jest.fn((_h: string, _o: unknown, cb: (e: Error | null, a: Answer) => void) =>
      answer instanceof Error ? cb(answer, []) : cb(null, answer)
    );
    return fn;
  };
  const run = (lookup: ReturnType<typeof createPinnedLookup>, opts: { all?: boolean; family?: number } = {}) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address?: unknown; family?: number }>((resolve) =>
      lookup("contoso.webhook.office.com", opts, (err, address, family) => resolve({ err, address, family }))
    );

  it("refuses when ANY resolved address is private, and hands back no address", async () => {
    const fn = resolver([
      { address: "52.96.0.1", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const out = await run(createPinnedLookup(fn as never));
    expect(out.err?.code).toBe("EWEBHOOKPRIVATE");
    expect(out.address).toBeUndefined();
    const all = await run(createPinnedLookup(fn as never), { all: true });
    expect(all.err?.code).toBe("EWEBHOOKPRIVATE");
  });

  it("pins the validated address (single form) and asks the resolver for every address", async () => {
    const fn = resolver([{ address: "52.96.0.1", family: 4 }]);
    const out = await run(createPinnedLookup(fn as never));
    expect(out).toEqual({ err: null, address: "52.96.0.1", family: 4 });
    expect(fn.mock.calls[0][1]).toEqual({ all: true });
  });

  it("answers an array when options.all is set (autoSelectFamily)", async () => {
    const fn = resolver([
      { address: "2603:1026::1", family: 6 },
      { address: "52.96.0.1", family: 4 },
    ]);
    const out = await run(createPinnedLookup(fn as never), { all: true });
    expect(out.err).toBeNull();
    expect(out.address).toEqual([
      { address: "2603:1026::1", family: 6 },
      { address: "52.96.0.1", family: 4 },
    ]);
  });

  it("honours a requested family and refuses when none matches", async () => {
    const fn = resolver([
      { address: "2603:1026::1", family: 6 },
      { address: "52.96.0.1", family: 4 },
    ]);
    expect((await run(createPinnedLookup(fn as never), { family: 4 })).address).toBe("52.96.0.1");
    const v4only = resolver([{ address: "52.96.0.1", family: 4 }]);
    expect((await run(createPinnedLookup(v4only as never), { family: 6 })).err).toBeTruthy();
  });

  it("passes a resolver failure and an empty answer through as errors", async () => {
    expect((await run(createPinnedLookup(resolver(new Error("ENOTFOUND")) as never))).err).toBeTruthy();
    expect((await run(createPinnedLookup(resolver([]) as never))).err).toBeTruthy();
  });
});

describe("postWebhookJson", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends through https.request with the pinned lookup, SNI on the host, a timeout and no redirect handling", async () => {
    const net = fakeWebhookTransport();
    await expect(postWebhookJson(GOOD, { a: 1 })).resolves.toBe(true);
    expect(net.calls).toHaveLength(1);
    const { options, body, connectedTo } = net.calls[0];
    expect(options.method).toBe("POST");
    expect(options.hostname).toBe("contoso.webhook.office.com");
    expect(options.port).toBe(443);
    expect(options.servername).toBe("contoso.webhook.office.com");
    expect(typeof options.lookup).toBe("function");
    expect(options.signal).toBeDefined();
    expect(options.path).toContain("/IncomingWebhook/");
    expect(JSON.parse(body)).toEqual({ a: 1 });
    expect(connectedTo).toBe("52.96.0.1");
    expect(WEBHOOK_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(WEBHOOK_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });

  it("treats a redirect as a failure and never follows it", async () => {
    const net = fakeWebhookTransport({ status: 302 });
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    expect(net.calls).toHaveLength(1);
  });

  it("is true only on a 2xx", async () => {
    fakeWebhookTransport({ status: 500 });
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    jest.restoreAllMocks();
    fakeWebhookTransport({ status: 204 });
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(true);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["link-local metadata", "169.254.169.254"],
    ["private", "10.0.0.5"],
    ["IPv6 loopback", "::1"],
    ["IPv6 ULA", "fd00::5"],
  ])("refuses a host that resolves to %s: nothing is connected", async (_n, address) => {
    const net = fakeWebhookTransport({ addresses: () => [address] });
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    expect(net.delivered()).toHaveLength(0);
  });

  it("refuses when ANY resolved address is private", async () => {
    const net = fakeWebhookTransport({ addresses: () => ["52.96.0.1", "10.0.0.5"] });
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    expect(net.delivered()).toHaveLength(0);
  });

  it("refuses when DNS fails, and never opens a request to a disallowed host", async () => {
    const net = fakeWebhookTransport({ addresses: () => [] });
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    await expect(postWebhookJson("https://evil.example/hook", {})).resolves.toBe(false);
    expect(net.delivered()).toHaveLength(0);
    expect(net.calls.filter((c) => c.options.hostname === "evil.example")).toHaveLength(0);
  });

  it("DNS rebinding: a public answer then a private one connects only to the public address, once", async () => {
    let answers = 0;
    const net = fakeWebhookTransport({ addresses: () => (answers++ === 0 ? ["52.96.0.1"] : ["10.0.0.5"]) });
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(true);
    // One resolution serves the check and the connection: there is no second lookup to rebind.
    expect(net.lookupSpy.mock.calls.filter((c) => String(c[0]).endsWith(".webhook.office.com"))).toHaveLength(1);
    expect(net.delivered().map((c) => c.connectedTo)).toEqual(["52.96.0.1"]);
    // A later request resolves again, now gets the private answer, and is refused.
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    expect(net.delivered().map((c) => c.connectedTo)).toEqual(["52.96.0.1"]);
  });

  it("logs the host only, never the URL path", async () => {
    fakeWebhookTransport({ addresses: () => ["10.0.0.5"] });
    const logs: string[] = [];
    jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    jest.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    await postWebhookJson(GOOD, {});
    const text = logs.join("\n");
    expect(text).toContain("contoso.webhook.office.com");
    expect(text).not.toContain("IncomingWebhook");
    expect(text).not.toContain("jkl");
  });
});

describe("sendPinnedJson against a real local HTTPS server (R44)", () => {
  // key.pem and cert.pem are a throwaway self-signed pair for this local test server only
  // (see fixtures/webhook/README.md). They are not a secret and grant access to nothing.
  const dir = path.join(__dirname, "..", "fixtures", "webhook");
  const cert = fs.readFileSync(path.join(dir, "cert.pem"));
  const key = fs.readFileSync(path.join(dir, "key.pem"));
  const HOST = "contoso.webhook.office.com";
  let server: https.Server;
  let port: number;
  let seen: { host?: string; sni?: string; body: string; method?: string }[];
  let respondWith: { status: number; headers?: Record<string, string> };

  beforeAll(async () => {
    server = https.createServer({ key, cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ host: req.headers.host, method: req.method, body: Buffer.concat(chunks).toString() });
        res.writeHead(respondWith.status, respondWith.headers);
        res.end("1");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => {
    seen = [];
    respondWith = { status: 200 };
  });

  /** A lookup standing in for the validated one: the name resolves to the local server. */
  const toLocal = ((_h: string, o: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void) =>
    o?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)) as never;
  /** Always the array form, as Node's autoSelectFamily (the default since Node 20) asks for. */
  const toLocalAll = ((_h: string, _o: unknown, cb: (e: null, a: unknown) => void) =>
    cb(null, [{ address: "127.0.0.1", family: 4 }])) as never;

  it("a normal public host works: connects to the pinned address, certificate checked against the name", async () => {
    const status = await sendPinnedJson(new URL(`https://${HOST}/hook/x`), '{"a":1}', { lookup: toLocal, ca: cert, port });
    expect(status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].host).toBe(`${HOST}:${port}`); // the Host header keeps the name, not 127.0.0.1
    expect(seen[0].method).toBe("POST");
    expect(seen[0].body).toBe('{"a":1}');
  });

  it("works with the array lookup form Node's autoSelectFamily uses", async () => {
    const status = await sendPinnedJson(new URL(`https://${HOST}/hook/x`), "{}", { lookup: toLocalAll, ca: cert, port });
    expect(status).toBe(200);
  });

  it("verifies the certificate against the ORIGINAL host name, not the address", async () => {
    await expect(
      sendPinnedJson(new URL("https://other.webhook.office.com/hook/x"), "{}", { lookup: toLocal, ca: cert, port })
    ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    expect(seen).toHaveLength(0);
  });

  it("rejects a certificate it does not trust", async () => {
    await expect(sendPinnedJson(new URL(`https://${HOST}/hook/x`), "{}", { lookup: toLocal, port })).rejects.toBeTruthy();
    expect(seen).toHaveLength(0);
  });

  it("reports a redirect as its status and never follows it", async () => {
    respondWith = { status: 302, headers: { location: `https://${HOST}:${port}/elsewhere` } };
    const status = await sendPinnedJson(new URL(`https://${HOST}/hook/x`), "{}", { lookup: toLocal, ca: cert, port });
    expect(status).toBe(302);
    expect(seen).toHaveLength(1);
  });
});
