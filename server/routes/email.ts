import express, { type Express, type Request, type Response } from "express";
import https from "https";
import { sql } from "drizzle-orm";
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

/**
 * POST /api/email/inbound: the SNS HTTPS subscription endpoint for SES inbound mail.
 * It has no session; the SNS signature is the only authentication, so every branch
 * below that is not a verified message answers before anything is read or written.
 *
 * Environment (names only):
 *  - SNS_INBOUND_TOPIC_ARN  the one topic accepted (required; unset refuses everything)
 *  - INBOUND_EMAIL_CATEGORY, INBOUND_EMAIL_ALLOW_UNVERIFIED_SENDER  see services/email/inbound.ts
 * The signing-certificate and confirmation-URL host must be sns.<region>.amazonaws.com
 * with <region> taken from the topic ARN.
 */

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

async function handleInbound(req: Request, res: Response) {
  const msg = readBody(req);
  if (!msg) return json(res, 400, "invalid_message", "Body is not an SNS message");

  const topicArn = process.env.SNS_INBOUND_TOPIC_ARN?.trim();
  const region = topicArn ? regionOfTopic(topicArn) : null;

  // 1. Authenticate. Nothing below runs for a message that did not verify.
  try {
    await verifySnsMessage(msg, {
      fetchCert: emailInboundDeps.fetchCert,
      region: region ?? undefined,
    });
  } catch (error) {
    const code = error instanceof SnsVerificationError ? error.code : "verify_failed";
    console.warn(`inbound email refused: ${code}`);
    return json(res, 403, "forbidden", "Message signature could not be verified");
  }

  // 2. Only the configured topic.
  if (!topicArn || !region) {
    console.warn("inbound email refused: SNS_INBOUND_TOPIC_ARN is not configured");
    return json(res, 503, "inbound_email_not_configured", "Inbound email is not configured");
  }
  if (msg.TopicArn !== topicArn) {
    console.warn("inbound email refused: topic not allowed");
    return json(res, 403, "forbidden", "Topic not allowed");
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
  const claimed = await db
    .insert(snsMessageDedupe)
    .values({ messageId })
    .onConflictDoNothing()
    .returning({ id: snsMessageDedupe.messageId });
  if (claimed.length === 0) return res.status(200).json({ status: "duplicate" });

  try {
    let inner: unknown;
    try {
      inner = JSON.parse(msg.Message ?? "");
    } catch {
      inner = null;
    }
    const outcome = await processSesNotification(inner);
    if (outcome.status === "ignored") console.warn(`inbound email ignored: ${outcome.reason}`);
    return res.status(200).json(outcome);
  } catch (error) {
    // Release the claim so SNS's retry processes the message again, then let the shared
    // error handler answer 500 (no message content is logged here).
    await db
      .delete(snsMessageDedupe)
      .where(sql`${snsMessageDedupe.messageId} = ${messageId}`)
      .catch(() => undefined);
    console.error(`inbound email failed: ${error instanceof Error ? error.name : "error"}`);
    return json(res, 500, "internal_error", "Internal server error");
  }
}

export function registerEmailRoutes(app: Express): void {
  // SNS sends Content-Type text/plain, which the app's JSON parser skips; read it as text.
  // (A client that sent application/json is already parsed and passes through.)
  app.post(
    "/api/email/inbound",
    express.text({ type: () => true, limit: "512kb" }),
    (req, res, next) => {
      handleInbound(req, res).catch(next);
    }
  );
}
