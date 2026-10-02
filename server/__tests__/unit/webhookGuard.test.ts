import { promises as dnsPromises } from "dns";
import { HttpError } from "../../http/errors";
import {
  isPrivateAddress,
  postWebhookJson,
  validateWebhookUrl,
  WEBHOOK_TIMEOUT_MS,
} from "../../services/webhookGuard";

const GOOD = "https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/ghi/jkl";

function resolvesTo(...addresses: string[]) {
  return jest
    .spyOn(dnsPromises, "lookup")
    .mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })) as never);
}

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

describe("postWebhookJson", () => {
  afterEach(() => jest.restoreAllMocks());

  it("posts with redirects off and a timeout once DNS resolves public", async () => {
    resolvesTo("52.96.0.1");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("1", { status: 200 }));
    await expect(postWebhookJson(GOOD, { a: 1 })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeDefined();
    expect(WEBHOOK_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(WEBHOOK_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });

  it("treats a redirect as a failure and never follows it", async () => {
    resolvesTo("52.96.0.1");
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["link-local metadata", "169.254.169.254"],
    ["private", "10.0.0.5"],
    ["IPv6 loopback", "::1"],
    ["IPv6 ULA", "fd00::5"],
  ])("refuses a host that resolves to %s, without any request", async (_n, address) => {
    resolvesTo(address);
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when ANY resolved address is private", async () => {
    resolvesTo("52.96.0.1", "10.0.0.5");
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when DNS fails, and never fetches a disallowed host", async () => {
    jest.spyOn(dnsPromises, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(postWebhookJson(GOOD, {})).resolves.toBe(false);
    await expect(postWebhookJson("https://evil.example/hook", {})).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the host only, never the URL path", async () => {
    resolvesTo("10.0.0.5");
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
