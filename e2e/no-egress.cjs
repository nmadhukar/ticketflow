// Preloaded into the e2e app server (`node --require`). Refuses every TCP
// connection whose host is not loopback or the DATABASE_URL host:port, and records each refusal to
// E2E_EGRESS_LOG so global-teardown can fail the run. This catches AWS,
// Microsoft, Mailtrap and any other outbound call regardless of the HTTP
// client (SDK, fetch, node:https), which an HTTP(S)_PROXY setting would not:
// Node's fetch and the AWS SDK ignore those variables.
const net = require("node:net");
const fs = require("node:fs");

const LOG = process.env.E2E_EGRESS_LOG;

// The app's own database is the one non-loopback peer it may reach: exactly the host:port in
// DATABASE_URL, read once here. (Under scripts/ai/verify.sh that is `postgres:5432` on the
// compose network; locally it is loopback anyway.) Any other host, or another port on that
// host, is still refused.
const ALLOWED = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL || "");
    if (!u.hostname) return null;
    // R54: an IPv6 hostname arrives bracketed ("[fd00::1]"); net.connect passes it without.
    return { host: u.hostname.replace(/^\[|\]$/g, "").toLowerCase(), port: Number(u.port || 5432) };
  } catch {
    return null;
  }
})();
const isAllowedPeer = (t) =>
  ALLOWED !== null &&
  typeof t.host === "string" &&
  t.host.replace(/^\[|\]$/g, "").toLowerCase() === ALLOWED.host &&
  Number(t.port) === ALLOWED.port;
const isLoopback = (host) =>
  host === undefined ||
  host === null ||
  host === "" ||
  host === "localhost" ||
  host === "::1" ||
  host === "[::1]" ||
  /^127\./.test(host);

function targetOf(args) {
  // net.connect() re-enters connect() with one pre-normalised [options, cb] array.
  if (Array.isArray(args[0])) args = args[0];
  const a = args[0];
  if (a && typeof a === "object") {
    if (a.path) return { local: true };
    return { host: a.host, port: a.port };
  }
  if (typeof a === "string" && Number.isNaN(Number(a))) return { local: true }; // a pipe path
  return { host: typeof args[1] === "string" ? args[1] : undefined, port: a };
}

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const t = targetOf(args);
  if (!t.local && !isLoopback(t.host) && !isAllowedPeer(t)) {
    const line = `E2E_EGRESS_BLOCKED ${t.host}:${t.port}`;
    try {
      if (LOG) fs.appendFileSync(LOG, line + "\n");
    } catch {
      // the console line below still shows it
    }
    console.error(line);
    throw new Error(line);
  }
  return realConnect.apply(this, args);
};
