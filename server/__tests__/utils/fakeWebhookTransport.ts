import dns from "dns";
import { EventEmitter } from "events";
import https from "https";
import { PassThrough } from "stream";
import { jest } from "@jest/globals";

export interface FakeCall {
  options: any;
  body: string;
  /** The address the request's `lookup` pinned (set only when the lookup was allowed to run and succeeded). */
  connectedTo?: string;
}

/**
 * Stands in for the network under postWebhookJson (R44). `https.request` is replaced by a fake that
 * runs the request's own `lookup` (as net.connect would) and, when it yields an address, "connects"
 * and answers `status`; when the lookup refuses, the request errors and nothing is delivered.
 * `dns.lookup` answers the given addresses for *.webhook.office.com only and passes every other
 * name (the database host) through to the real resolver. `answer` may change between lookups.
 */
export function fakeWebhookTransport(opts: { status?: number; addresses?: () => string[]; delayMs?: number } = {}) {
  const calls: FakeCall[] = [];
  let inFlight = 0;
  let peak = 0;
  const addresses = opts.addresses ?? (() => ["52.96.0.1"]);
  const realLookup = dns.lookup;
  const lookupSpy = jest.spyOn(dns, "lookup").mockImplementation(((host: string, options: any, cb: any) => {
    if (!host.endsWith(".webhook.office.com")) return (realLookup as any)(host, options, cb);
    const list = addresses().map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    setImmediate(() => cb(null, list));
  }) as never);
  const requestSpy = jest.spyOn(https, "request").mockImplementation(((options: any, onResponse: any) => {
    const req: any = new EventEmitter();
    const call: FakeCall = { options, body: "" };
    calls.push(call);
    const respond = () => {
      const res: any = new PassThrough();
      res.statusCode = opts.status ?? 200;
      onResponse(res);
      res.end("1");
    };
    req.end = (chunk?: string) => {
      call.body = chunk ?? "";
      options.lookup(options.hostname, { family: 0 }, (err: Error | null, address: string) => {
        if (err) return void setImmediate(() => req.emit("error", err));
        call.connectedTo = address;
        inFlight++;
        peak = Math.max(peak, inFlight);
        setTimeout(() => {
          inFlight--;
          respond();
        }, opts.delayMs ?? 0);
      });
      return req;
    };
    req.destroy = () => req;
    return req;
  }) as never);
  return {
    calls,
    lookupSpy,
    requestSpy,
    /** Hosts a request was actually delivered to (its lookup was accepted). */
    delivered: () => calls.filter((c) => c.connectedTo !== undefined),
    /** Most connections open at once so far (reset with resetPeak). */
    peak: () => peak,
    resetPeak: () => {
      peak = 0;
    },
  };
}
