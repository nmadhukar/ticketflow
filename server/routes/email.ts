import express, { type Express, type Request, type Response } from "express";
import https from "https";
import { and, eq, sql } from "drizzle-orm";
import { snsMessageDedupe } from "@shared/schema";
import { db } from "../storage/db";
import {
  SnsVerificationError,
  fetchCertOverHttps,
  isValidSnsHost,
  verifySnsMessage,
  type CertFetcher,
  type SnsMessage,
} from "../services/email/snsVerify";
import { processSesNotification } from "../services/email/inbound";
import { inboundEmailRateLimit } from "../security/rateLimiting";

/**
 * POST /api/email/inbound: the SNS HTTPS subscription endpoint for SES inbound mail.
 * It has no session; the SNS signature is the only authentication, so every branch
 * below that is not a verified message answers before anything is read or written.
 *
 * Environment (names only):
 *  - SNS_INBOUND_TOPIC_ARN  the one topic accepted (required; unset refuses everything)
 *  - INBOUND_EMAIL_CATEGORY, APP_BASE_URL  see services/email/inbound.ts
 * The signing-certificate and confirmation-URL host must be sns.<region>.amazonaws.com
 * with <region> taken from the topic ARN.
 */

/**
 * A 'processing' claim older than this many seconds is a crashed attempt and may be taken again.
 * It is shorter than SNS's default HTTP/S delivery policy (3 retries, 20 s apart, so about 60 s
 * of retrying): the last retry then finds the claim stale and takes it over. A fresh claim
 * answers 503 so SNS retries instead of treating the message as handled. If the topic's
 * delivery policy is changed to retry over a shorter span, this window must shrink with it.
 */
const CLAIM_STALE_SECONDS = 45;

/** Visits a SubscribeURL to confirm the subscription. Never follows redirects. */
async function confirmOverHttps(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`subscription confirmation status ${res.statusCode}`));
    });
    req.on("timeout", () => req.destroy(new Error("subscription confirmation timed out")));
    req.on("error", reject);
  });
}

/** Network seams. Tests replace these; production uses the defaults. */
export const emailInboundDeps: {
  fetchCert: CertFetcher;
  confirmSubscription: (url: string) => Promise<void>;
} = {
  fetchCert: fetchCertOverHttps,
  confirmSubscription: confirmOverHttps,
};

const json = (res: Response, status: number, error: string, message: string) =>
  res.status(status).json({ error, message });

/** arn:aws:sns:<region>:<account>:<topic> -> region, or null for anything else. */
function regionOfTopic(arn: string): string | null {
  const parts = arn.split(":");
  return parts.length === 6 && parts[0] === "arn" && parts[2] === "sns" && parts[3] ? parts[3] : null;
}

function readBody(req: Request): SnsMessage | null {
  const body: unknown = req.body;
  try {
    const value = typeof body === "string" ? JSON.parse(body) : body;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as SnsMessage) : null;
  } catch {
    return null;
  }
}

/**
 * Takes the claim on an SNS MessageId.
 *  - "claimed": this delivery owns it (a new id, or a 'processing' claim older than
 *    CLAIM_STALE_SECONDS whose process died);
 *  - "done": the message was fully handled, nothing to do;
 *  - "busy": another delivery is working on it right now (a fresh 'processing' claim).
 */
export async function claimMessage(
  messageId: string
): Promise<{ state: "claimed"; token: string } | { state: "done" } | { state: "busy" }> {
  const rows = await db
    .insert(snsMessageDedupe)
    .values({ messageId, status: "processing" })
    .onConflictDoUpdate({
      target: snsMessageDedupe.messageId,
      set: { status: "processing", receivedAt: sql`now()` },
      setWhere: sql`${snsMessageDedupe.status} = 'processing' AND ${snsMessageDedupe.receivedAt} < now() - make_interval(secs => ${CLAIM_STALE_SECONDS})`,
    })
    // The claim's token is its timestamp as text (microsecond precision, which a JS Date would lose).
    .returning({ token: sql<string>`${snsMessageDedupe.receivedAt}::text` });
  if (rows.length > 0) return { state: "claimed", token: rows[0].token };
  const [row] = await db
    .select({ status: snsMessageDedupe.status })
    .from(snsMessageDedupe)
    .where(eq(snsMessageDedupe.messageId, messageId))
    .limit(1);
  return row?.status === "done" ? { state: "done" } : { state: "busy" };
}

/** Matches only the row this holder claimed: a newer holder's claim has a different timestamp. */
const ownedBy = (messageId: string, token: string) =>
  and(eq(snsMessageDedupe.messageId, messageId), sql`${snsMessageDedupe.receivedAt} = ${token}::timestamp`);

/** Makes the holder's own claim final. False when the claim is no longer this holder's. */
export async function markMessageDone(messageId: string, token: string): Promise<boolean> {
  const rows = await db
    .update(snsMessageDedupe)
    .set({ status: "done" })
    .where(ownedBy(messageId, token))
    .returning({ id: snsMessageDedupe.messageId });
  return rows.length > 0;
}

/** Gives up the holder's own claim so a retry can take it. Never touches another holder's claim. */
export async function releaseMessageClaim(messageId: string, token: string): Promise<boolean> {
  const rows = await db
    .delete(snsMessageDedupe)
    .where(ownedBy(messageId, token))
    .returning({ id: snsMessageDedupe.messageId });
  return rows.length > 0;
}

async function handleInbound(req: Request, res: Response) {
  const msg = readBody(req);
  if (!msg) return json(res, 400, "invalid_message", "Body is not an SNS message");

  const topicArn = process.env.SNS_INBOUND_TOPIC_ARN?.trim();
  const region = topicArn ? regionOfTopic(topicArn) : null;
  if (!topicArn || !region) {
    console.warn("inbound email refused: SNS_INBOUND_TOPIC_ARN is not configured");
    return json(res, 503, "inbound_email_not_configured", "Inbound email is not configured");
  }

  // 1. Only the configured topic. TopicArn is a signed field, so a forged value still fails
  // step 2; checking it first just keeps other topics from costing a certificate fetch.
  if (msg.TopicArn !== topicArn) {
    console.warn("inbound email refused: topic not allowed");
    return json(res, 403, "forbidden", "Topic not allowed");
  }

  // 2. Authenticate. Nothing below runs for a message that did not verify.
  try {
    await verifySnsMessage(msg, { fetchCert: emailInboundDeps.fetchCert, region });
  } catch (error) {
    const code = error instanceof SnsVerificationError ? error.code : "verify_failed";
    console.warn(`inbound email refused: ${code}`);
    return json(res, 403, "forbidden", "Message signature could not be verified");
  }

  // 3. Subscription handshake.
  if (msg.Type === "SubscriptionConfirmation") {
    if (!isValidSnsHost(msg.SubscribeURL, region)) {
      console.warn("inbound email refused: bad SubscribeURL host");
      return json(res, 403, "forbidden", "SubscribeURL host not allowed");
    }
    try {
      await emailInboundDeps.confirmSubscription(msg.SubscribeURL);
    } catch {
      console.error("inbound email: subscription confirmation failed");
      return json(res, 502, "confirmation_failed", "Could not confirm the subscription");
    }
    return res.status(200).json({ status: "subscription_confirmed" });
  }
  if (msg.Type === "UnsubscribeConfirmation") return res.status(200).json({ status: "ignored" });
  if (msg.Type !== "Notification") return json(res, 400, "invalid_message", "Unsupported message type");

  // 4. A notification: claim its MessageId, then process. A repeat delivery finds the claim.
  const messageId = typeof msg.MessageId === "string" ? msg.MessageId.slice(0, 200) : "";
  if (!messageId) return json(res, 400, "invalid_message", "MessageId is missing");
  const claim = await claimMessage(messageId);
  if (claim.state === "done") return res.status(200).json({ status: "duplicate" });
  if (claim.state === "busy") {
    // Not finished by whoever holds it: do not report it handled. SNS retries, and the retry
    // finds it done, or stale and takes it over.
    res.setHeader("Retry-After", "20");
    return json(res, 503, "in_progress", "This message is being processed");
  }

  let result: Awaited<ReturnType<typeof processSesNotification>>;
  try {
    let inner: unknown;
    try {
      inner = JSON.parse(msg.Message ?? "");
    } catch {
      inner = null;
    }
    result = await processSesNotification(inner);
  } catch (error) {
    // Nothing was committed to the caller as done: release the claim so SNS's retry processes
    // the message again, and answer 500 (the error type is logged, never message content).
    await releaseMessageClaim(messageId, claim.token).catch(() => undefined);
    console.error(`inbound email failed: ${error instanceof Error ? error.name : "error"}`);
    return json(res, 500, "internal_error", "Internal server error");
  }

  // (The 'done' mark is a separate statement, not part of the ticket/comment transaction:
  // storage.createTask and addTaskComment use the shared connection and take no transaction,
  // so sharing one would mean threading it through the create path. A crash between the two
  // leaves a stale 'processing' claim, which the next delivery takes over.)
  // The ticket or comment is committed: make the claim final, answer SNS, and only then run the
  // non-essential effects (AI auto-response, realtime, Teams). None of them can change the answer.
  try {
    if (!(await markMessageDone(messageId, claim.token))) {
      console.warn("inbound email: claim was taken over by a newer delivery before this one finished");
    }
  } catch (error) {
    // The claim stays 'processing' and turns stale; SNS must still be told the message was handled.
    console.error(`inbound email: could not mark message done: ${error instanceof Error ? error.name : "error"}`);
  }
  if (result.outcome.status === "ignored") console.warn(`inbound email ignored: ${result.outcome.reason}`);
  res.status(200).json(result.outcome);
  try {
    await result.after?.();
  } catch (error) {
    console.error(`inbound email: after-effects failed: ${error instanceof Error ? error.name : "error"}`);
  }
}

export function registerEmailRoutes(app: Express): void {
  if (process.env.SNS_INBOUND_TOPIC_ARN?.trim() && !process.env.APP_BASE_URL?.trim()) {
    console.warn(
      "Inbound email is configured but APP_BASE_URL is not set: Teams cards for emailed tickets will have no link."
    );
  }
  // SNS sends Content-Type text/plain, which the app's JSON parser skips; read it as text.
  // (A client that sent application/json is already parsed and passes through.)
  app.post(
    "/api/email/inbound",
    inboundEmailRateLimit,
    express.text({ type: () => true, limit: "512kb" }),
    (req, res, next) => {
      handleInbound(req, res).catch(next);
    }
  );
}
