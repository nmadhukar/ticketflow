import { randomUUID } from "crypto";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { snsMessageDedupe, taskComments, taskHistory, tasks } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser } from "./helpers/fixtures";
import { setTicketCreatedBroadcaster } from "../../services/tickets/create";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { claimMessage, emailInboundDeps } from "../../routes/email";
import { clearCertCache, type SnsMessage } from "../../services/email/snsVerify";
import { createSnsTestSigner } from "../utils/snsTestSigner";
import sesReceived from "../fixtures/ses/ses-received.json";

// R46: the ticket (or comment) insert and the 'done' mark are one transaction. A crash between
// them can no longer leave a ticket behind with a claim that a retry takes over (a duplicate), and
// a holder whose claim was taken over leaves nothing at all.
const TOPIC = "arn:aws:sns:us-east-1:111122223333:ticketflow-inbound-test";
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-integration.pem";

describe("inbound email: insert and done mark share one transaction (R46)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const signer = createSnsTestSigner();
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    process.env = savedEnv;
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    clearCertCache();
    emailInboundDeps.fetchCert = async () => signer.publicKeyPem;
    emailInboundDeps.confirmSubscription = async () => undefined;
    process.env.SNS_INBOUND_TOPIC_ARN = TOPIC;
    delete process.env.INBOUND_EMAIL_CATEGORY;
    delete process.env.APP_BASE_URL;
    setTicketCreatedBroadcaster(null);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sesBody(from: string, subject: string, body: string) {
    const fill = (s: string) =>
      s.split("{{FROM}}").join(from).split("{{SUBJECT}}").join(subject).split("{{BODY}}").join(body);
    const walk = (v: unknown): unknown =>
      typeof v === "string"
        ? fill(v)
        : Array.isArray(v)
          ? v.map(walk)
          : v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
            : v;
    return walk(sesReceived);
  }

  const notification = (inner: unknown): SnsMessage =>
    signer.sign(
      {
        Type: "Notification",
        MessageId: randomUUID(),
        TopicArn: TOPIC,
        Subject: "Amazon SES Email Receipt Notification",
        Message: JSON.stringify(inner),
        Timestamp: "2026-10-01T12:00:00.000Z",
        SigningCertURL: CERT_URL,
      },
      "1"
    );

  const post = (msg: SnsMessage) =>
    request(ctx.app)
      .post("/api/email/inbound")
      .set("Content-Type", "text/plain; charset=UTF-8")
      .send(JSON.stringify(msg));

  const dedupe = async (id: string) =>
    (await db.select().from(snsMessageDedupe).where(eq(snsMessageDedupe.messageId, id)))[0];
  const countTickets = async () => (await db.select().from(tasks)).length;
  const countComments = async () => (await db.select().from(taskComments)).length;

  const EMAIL = "ann.customer@example.test";
  const newMail = () => notification(sesBody(EMAIL, "Printer on fire", "Smoke from tray 2."));

  /** A ticket the customer owns, written through the storage layer (no tx). */
  async function existingTicket(ownerId: string) {
    return storage.createTask({ title: "Existing", category: "support", createdBy: ownerId } as any);
  }
  const replyMail = (ticketNumber: string) =>
    notification(sesBody(EMAIL, `Re: Existing [${ticketNumber}]`, "More detail."));

  /** Ages the claim past the stale window and has another holder take it over. */
  async function takeOver(id: string) {
    await db
      .update(snsMessageDedupe)
      .set({ receivedAt: new Date(Date.now() - 120 * 1000) })
      .where(eq(snsMessageDedupe.messageId, id));
    const taken = await claimMessage(id);
    expect(taken.state).toBe("claimed");
  }

  describe("a new ticket", () => {
    it("(a) a throw after the insert and before the mark leaves no ticket, no history and a released claim; the retry creates exactly one", async () => {
      await createUser({ role: "customer", email: EMAIL });
      const msg = newMail();
      const original = storage.createTask.bind(storage);
      jest.spyOn(storage, "createTask").mockImplementationOnce(async (t: any, tx?: any) => {
        await original(t, tx); // the insert has happened (on the transaction, once the fix is in)
        throw new Error("crash before the done mark");
      });
      const first = await post(msg);
      expect(first.status).toBe(500);
      expect(await countTickets()).toBe(0);
      expect((await db.select().from(taskHistory)).length).toBe(0);
      expect(await dedupe(msg.MessageId as string)).toBeUndefined(); // released

      const retry = await post(msg);
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ status: "created" });
      expect(await countTickets()).toBe(1);
      expect((await dedupe(msg.MessageId as string)).status).toBe("done");
    });

    it("(b) a claim taken over before the mark rolls back: no ticket, no duplicate", async () => {
      await createUser({ role: "customer", email: EMAIL });
      const msg = newMail();
      const id = msg.MessageId as string;
      const original = storage.createTask.bind(storage);
      jest.spyOn(storage, "createTask").mockImplementationOnce(async (t: any, tx?: any) => {
        const row = await original(t, tx);
        await takeOver(id); // a newer delivery takes the claim while this one is still writing
        return row;
      });
      const res = await post(msg);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("in_progress");
      expect(await countTickets()).toBe(0);
      expect((await db.select().from(taskHistory)).length).toBe(0);
      const row = await dedupe(id);
      expect(row.status).toBe("processing"); // the newer holder's claim, untouched

      // The newer holder finishes (the same message again, as SNS would deliver it).
      await db.delete(snsMessageDedupe).where(eq(snsMessageDedupe.messageId, id));
      const done = await post(msg);
      expect(done.body).toMatchObject({ status: "created" });
      expect(await countTickets()).toBe(1);
    });

    it("(c) a pre-existing ticket holding the next number forces a 23505: the savepoint retry succeeds and the mark is committed", async () => {
      const owner = await createUser({ role: "customer", email: EMAIL });
      const taken = await existingTicket(owner.id);
      // The counter is behind the table, as after a ticket written outside it.
      await db.execute(sql`UPDATE ticket_number_counters SET last_number = last_number - 1`);
      const msg = newMail();
      const res = await post(msg);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "created" });
      const rows = await db.select().from(tasks);
      expect(rows).toHaveLength(2);
      const created = rows.find((r) => r.id === res.body.ticketId)!;
      expect(created.ticketNumber).not.toBe(taken.ticketNumber);
      expect((await dedupe(msg.MessageId as string)).status).toBe("done");
      // the history row of the new ticket was written on the same transaction
      expect((await db.select().from(taskHistory).where(eq(taskHistory.taskId, created.id))).length).toBe(1);
    });
  });

  describe("(d) a reply (comment)", () => {
    it("a throw after the comment insert and before the mark leaves no comment; the retry adds exactly one", async () => {
      const owner = await createUser({ role: "customer", email: EMAIL });
      const ticket = await existingTicket(owner.id);
      const msg = replyMail(ticket.ticketNumber);
      const original = storage.addTaskComment.bind(storage);
      jest.spyOn(storage, "addTaskComment").mockImplementationOnce(async (c: any, tx?: any) => {
        await original(c, tx);
        throw new Error("crash before the done mark");
      });
      expect((await post(msg)).status).toBe(500);
      expect(await countComments()).toBe(0);
      expect(await dedupe(msg.MessageId as string)).toBeUndefined();

      const retry = await post(msg);
      expect(retry.body).toMatchObject({ status: "commented" });
      expect(await countComments()).toBe(1);
      expect((await dedupe(msg.MessageId as string)).status).toBe("done");
    });

    it("a claim taken over before the mark rolls back the comment: none, no duplicate", async () => {
      const owner = await createUser({ role: "customer", email: EMAIL });
      const ticket = await existingTicket(owner.id);
      const msg = replyMail(ticket.ticketNumber);
      const id = msg.MessageId as string;
      const original = storage.addTaskComment.bind(storage);
      jest.spyOn(storage, "addTaskComment").mockImplementationOnce(async (c: any, tx?: any) => {
        const row = await original(c, tx);
        await takeOver(id);
        return row;
      });
      const res = await post(msg);
      expect(res.status).toBe(503);
      expect(await countComments()).toBe(0);
      const history = await db.select().from(taskHistory).where(eq(taskHistory.action, "commented"));
      expect(history).toHaveLength(0);
      expect((await dedupe(id)).status).toBe("processing");
    });

    it("the normal path writes the comment, its history row and the done mark", async () => {
      const owner = await createUser({ role: "customer", email: EMAIL });
      const ticket = await existingTicket(owner.id);
      const msg = replyMail(ticket.ticketNumber);
      const res = await post(msg);
      expect(res.body).toMatchObject({ status: "commented", ticketId: ticket.id });
      expect(await countComments()).toBe(1);
      expect((await db.select().from(taskHistory).where(eq(taskHistory.action, "commented"))).length).toBe(1);
      expect((await dedupe(msg.MessageId as string)).status).toBe("done");
    });
  });

  it("a message that writes nothing is still marked done, outside any transaction", async () => {
    const msg = notification(sesBody("stranger@example.test", "Hello", "x"));
    const res = await post(msg);
    expect(res.body.status).toBe("ignored");
    expect((await dedupe(msg.MessageId as string)).status).toBe("done");
  });
});
