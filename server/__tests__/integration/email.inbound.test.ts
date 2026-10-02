import { randomUUID } from "crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { snsMessageDedupe, taskComments, tasks, users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import * as createTimeAutoResponse from "../../services/ai/createTimeAutoResponse";
import { setTicketCreatedBroadcaster } from "../../services/tickets/create";
import { teamsIntegration } from "../../services/microsoftTeams";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { emailInboundDeps } from "../../routes/email";
import { clearCertCache, type SnsMessage } from "../../services/email/snsVerify";
import { AI_SYSTEM_USER_ID, ensureAiSystemUser } from "../../utils/aiSystemUser";
import { createSnsTestSigner, generateKeyPairSync } from "../utils/snsTestSigner";
import sesReceived from "../fixtures/ses/ses-received.json";
import snsConfirmation from "../fixtures/ses/sns-subscription-confirmation.json";

const TOPIC = "arn:aws:sns:us-east-1:111122223333:ticketflow-inbound-test";
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-integration.pem";

describe("POST /api/email/inbound", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const signer = createSnsTestSigner();
  const fetchCert = jest.fn(async (_url: string) => signer.publicKeyPem);
  const confirmSubscription = jest.fn(async (_url: string) => undefined);
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
    fetchCert.mockClear();
    confirmSubscription.mockClear();
    emailInboundDeps.fetchCert = fetchCert;
    emailInboundDeps.confirmSubscription = confirmSubscription;
    process.env.SNS_INBOUND_TOPIC_ARN = TOPIC;
    delete process.env.INBOUND_EMAIL_CATEGORY;
    delete process.env.INBOUND_EMAIL_ALLOW_UNVERIFIED_SENDER;
  });

  /** The SES notification fixture with the made-up sender, subject and body filled in. */
  function sesBody(opts: { from: string; subject: string; body: string; receipt?: Record<string, unknown>; headers?: string }) {
    const fill = (s: string) =>
      s.replace(/\{\{FROM\}\}/g, opts.from).replace(/\{\{SUBJECT\}\}/g, opts.subject).replace(/\{\{BODY\}\}/g, opts.body);
    const filled = JSON.parse(fill(JSON.stringify(sesReceived))) as typeof sesReceived;
    const content = opts.headers ? `${opts.headers}\r\n${filled.content}` : filled.content;
    return { ...filled, content, receipt: { ...filled.receipt, ...opts.receipt } };
  }

  function notification(inner: unknown, overrides: Partial<SnsMessage> = {}): SnsMessage {
    return signer.sign(
      {
        Type: "Notification",
        MessageId: randomUUID(),
        TopicArn: TOPIC,
        Subject: "Amazon SES Email Receipt Notification",
        Message: JSON.stringify(inner),
        Timestamp: "2026-10-01T12:00:00.000Z",
        SigningCertURL: CERT_URL,
        ...overrides,
      },
      "1"
    );
  }

  /** SNS posts the JSON as text/plain. */
  const post = (msg: SnsMessage | string) =>
    request(ctx.app)
      .post("/api/email/inbound")
      .set("Content-Type", "text/plain; charset=UTF-8")
      .send(typeof msg === "string" ? msg : JSON.stringify(msg));

  const countTickets = async () => (await db.select().from(tasks)).length;
  const countComments = async () => (await db.select().from(taskComments)).length;

  async function customer(email?: string) {
    return createUser({ role: "customer", email });
  }

  it("a signed notification from a known customer creates a ticket they own, with the subject and body", async () => {
    const sender = await customer("ann.customer@example.test");
    const res = await post(
      notification(sesBody({ from: "Ann.Customer@Example.test", subject: "Printer on fire", body: "Smoke from tray 2." }))
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "created" });
    const [ticket] = await db.select().from(tasks);
    expect(ticket).toMatchObject({
      title: "Printer on fire",
      description: "Smoke from tray 2.",
      createdBy: sender.id,
      category: "support",
      status: "open",
      priority: "medium",
    });
    expect(ticket.ticketNumber).toMatch(/^TKT-\d{4}-\d{4,}$/);
  });

  it("takes the new ticket's category from INBOUND_EMAIL_CATEGORY when it is a real category", async () => {
    await customer("ann.customer@example.test");
    process.env.INBOUND_EMAIL_CATEGORY = "incident";
    await post(notification(sesBody({ from: "ann.customer@example.test", subject: "Down", body: "It is down." })));
    process.env.INBOUND_EMAIL_CATEGORY = "not-a-category";
    await post(notification(sesBody({ from: "ann.customer@example.test", subject: "Down again", body: "Still down." })));
    const rows = await db.select().from(tasks);
    expect(rows.map((t) => t.category).sort()).toEqual(["incident", "support"]);
  });

  it("a reply carrying [TKT-YYYY-NNNN] becomes a comment on that ticket by the sender", async () => {
    const sender = await customer("ann.customer@example.test");
    const ticket = await storage.createTask({
      title: "Existing",
      category: "support",
      createdBy: sender.id,
    } as never);
    const res = await post(
      notification(
        sesBody({ from: "ann.customer@example.test", subject: `Re: Existing [${ticket.ticketNumber}]`, body: "More detail." })
      )
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "commented", ticketId: ticket.id });
    const comments = await db.select().from(taskComments);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ taskId: ticket.id, userId: sender.id, content: "More detail." });
    expect(await countTickets()).toBe(1);
  });

  it("a reply to a ticket the sender cannot access writes nothing", async () => {
    const owner = await customer("owner@example.test");
    await customer("other.customer@example.test");
    const ticket = await storage.createTask({ title: "Private", category: "support", createdBy: owner.id } as never);
    const res = await post(
      notification(
        sesBody({ from: "other.customer@example.test", subject: `Re: Private [${ticket.ticketNumber}]`, body: "Let me in." })
      )
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ignored", reason: "no_access_to_ticket" });
    expect(await countComments()).toBe(0);
    expect(await countTickets()).toBe(1);
  });

  it("a staff member comments on a ticket their team can see, through the same access rule", async () => {
    const owner = await customer("owner@example.test");
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent", email: "agent.sam@example.test" });
    const team = await createTeam(admin);
    await storage.addTeamMember({ teamId: team.id, userId: agent.id } as never);
    const queued = await storage.createTask({
      title: "Team queue",
      category: "support",
      createdBy: owner.id,
      assigneeType: "team",
      assigneeTeamId: team.id,
    } as never);
    const unseen = await storage.createTask({ title: "Not theirs", category: "support", createdBy: owner.id } as never);
    const ok = await post(
      notification(sesBody({ from: "agent.sam@example.test", subject: `Re: [${queued.ticketNumber}]`, body: "On it." }))
    );
    const refused = await post(
      notification(sesBody({ from: "agent.sam@example.test", subject: `Re: [${unseen.ticketNumber}]`, body: "Me too." }))
    );
    expect(ok.body.status).toBe("commented");
    expect(refused.body).toEqual({ status: "ignored", reason: "no_access_to_ticket" });
    expect(await countComments()).toBe(1);
  });

  it("a ticket tag that matches no ticket creates nothing", async () => {
    await customer("ann.customer@example.test");
    const res = await post(
      notification(sesBody({ from: "ann.customer@example.test", subject: "Re: [TKT-2026-9999]", body: "Hello?" }))
    );
    expect(res.body).toEqual({ status: "ignored", reason: "unknown_ticket" });
    expect(await countTickets()).toBe(0);
    expect(await countComments()).toBe(0);
  });

  describe("who may create a ticket", () => {
    const attempt = (from: string) =>
      post(notification(sesBody({ from, subject: "Help", body: "Please help." })));

    it("an unknown sender creates nothing", async () => {
      const res = await attempt("stranger@example.test");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ignored", reason: "unknown_or_ineligible_sender" });
      expect(await countTickets()).toBe(0);
    });

    it("an inactive or unapproved account creates nothing", async () => {
      await createUser({ role: "customer", email: "inactive@example.test", isActive: false });
      await createUser({ role: "customer", email: "pending@example.test", isApproved: false });
      expect((await attempt("inactive@example.test")).body.status).toBe("ignored");
      expect((await attempt("pending@example.test")).body.status).toBe("ignored");
      expect(await countTickets()).toBe(0);
    });

    it("an account with an unknown role fails closed", async () => {
      const user = await customer("odd.role@example.test");
      await db.update(users).set({ role: "superuser" }).where(eq(users.id, user.id));
      expect((await attempt("odd.role@example.test")).body.status).toBe("ignored");
      expect(await countTickets()).toBe(0);
    });

    it("the AI system user and the legacy system user never create tickets, even if active", async () => {
      await ensureAiSystemUser();
      await db
        .update(users)
        .set({ isActive: true, isApproved: true })
        .where(eq(users.id, AI_SYSTEM_USER_ID));
      await db
        .insert(users)
        .values({ id: "system", email: "system@ticketflow.local", role: "admin", isActive: true, isApproved: true });
      expect((await attempt("ai-assistant@ticketflow.invalid")).body.status).toBe("ignored");
      expect((await attempt("system@ticketflow.local")).body.status).toBe("ignored");
      expect(await countTickets()).toBe(0);
    });

    it("matches email by exact equality, not by pattern", async () => {
      await customer("pat_ricia@example.test");
      // "_" and "%" are ilike wildcards; neither may stand in for a character.
      expect((await attempt("patxricia@example.test")).body.status).toBe("ignored");
      expect((await attempt("%@example.test")).body.status).toBe("ignored");
      expect((await attempt("PAT_RICIA@EXAMPLE.TEST")).body.status).toBe("created");
      expect(await countTickets()).toBe(1);
    });

    it("refuses a sender SES did not authenticate, unless the operator allows it", async () => {
      await customer("ann.customer@example.test");
      const unverified = {
        dkimVerdict: { status: "FAIL" },
        dmarcVerdict: { status: "FAIL" },
        spfVerdict: { status: "PASS" },
      };
      const body = (receipt: Record<string, unknown>) =>
        notification(sesBody({ from: "ann.customer@example.test", subject: "Spoof?", body: "x", receipt }));
      expect((await post(body(unverified))).body).toEqual({ status: "ignored", reason: "sender_not_verified" });
      expect(await countTickets()).toBe(0);
      process.env.INBOUND_EMAIL_ALLOW_UNVERIFIED_SENDER = "true";
      expect((await post(body(unverified))).body.status).toBe("created");
    });

    it("ignores automatic replies and virus-flagged mail", async () => {
      await customer("ann.customer@example.test");
      const auto = notification(
        sesBody({ from: "ann.customer@example.test", subject: "Out of office", body: "Away.", headers: "Auto-Submitted: auto-replied" })
      );
      const virus = notification(
        sesBody({
          from: "ann.customer@example.test",
          subject: "Invoice",
          body: "Open me.",
          receipt: { virusVerdict: { status: "FAIL" } },
        })
      );
      expect((await post(auto)).body.reason).toBe("automatic_message");
      expect((await post(virus)).body.reason).toBe("virus_verdict_fail");
      expect(await countTickets()).toBe(0);
    });
  });

  describe("authentication", () => {
    it("a bad signature is 403 and nothing is created", async () => {
      await customer("ann.customer@example.test");
      const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const forged = signer.sign(
        {
          Type: "Notification",
          MessageId: randomUUID(),
          TopicArn: TOPIC,
          Message: JSON.stringify(sesBody({ from: "ann.customer@example.test", subject: "Forged", body: "x" })),
          Timestamp: "2026-10-01T12:00:00.000Z",
          SigningCertURL: CERT_URL,
        },
        "2",
        other.privateKey
      );
      const res = await post(forged);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("forbidden");
      expect(await countTickets()).toBe(0);
      expect(await db.select().from(snsMessageDedupe)).toHaveLength(0);
    });

    it("a message altered after signing is 403", async () => {
      await customer("ann.customer@example.test");
      const signed = notification(sesBody({ from: "ann.customer@example.test", subject: "Real", body: "x" }));
      const tampered = { ...signed, Message: JSON.stringify(sesBody({ from: "ann.customer@example.test", subject: "Evil", body: "y" })) };
      expect((await post(tampered)).status).toBe(403);
      expect(await countTickets()).toBe(0);
    });

    it("a signing certificate URL on a non-AWS host is 403 and is never fetched", async () => {
      await customer("ann.customer@example.test");
      const msg = notification(sesBody({ from: "ann.customer@example.test", subject: "Evil cert", body: "x" }), {
        SigningCertURL: "https://sns.us-east-1.amazonaws.com.evil.example.test/cert.pem",
      });
      const res = await post(msg);
      expect(res.status).toBe(403);
      expect(fetchCert).not.toHaveBeenCalled();
      expect(await countTickets()).toBe(0);
    });

    it("a signed message for another topic is 403", async () => {
      await customer("ann.customer@example.test");
      const msg = notification(sesBody({ from: "ann.customer@example.test", subject: "Wrong topic", body: "x" }), {
        TopicArn: "arn:aws:sns:us-east-1:999999999999:someone-elses-topic",
      });
      expect((await post(msg)).status).toBe(403);
      expect(await countTickets()).toBe(0);
    });

    it("refuses everything when no topic is configured", async () => {
      await customer("ann.customer@example.test");
      delete process.env.SNS_INBOUND_TOPIC_ARN;
      const res = await post(notification(sesBody({ from: "ann.customer@example.test", subject: "x", body: "x" })));
      expect(res.status).toBe(503);
      expect(await countTickets()).toBe(0);
    });

    it("rejects a body that is not an SNS message", async () => {
      expect((await post("not json")).status).toBe(400);
      expect((await post("[1,2]")).status).toBe(400);
      expect((await post("{}")).status).toBe(403);
    });

    it("needs no session and is not behind login", async () => {
      const res = await request(ctx.app).post("/api/email/inbound").set("Content-Type", "text/plain").send("{}");
      expect(res.status).not.toBe(401);
    });
  });

  describe("subscription handshake", () => {
    const confirmation = (overrides: Partial<SnsMessage> = {}) =>
      signer.sign({ ...(snsConfirmation as SnsMessage), SigningCertURL: CERT_URL, ...overrides }, "1");

    it("a signed SubscriptionConfirmation calls the confirmation fetch", async () => {
      const res = await post(confirmation());
      expect(res.status).toBe(200);
      expect(confirmSubscription).toHaveBeenCalledTimes(1);
      expect(confirmSubscription.mock.calls[0][0]).toBe(snsConfirmation.SubscribeURL);
    });

    it("an unsigned or badly signed one confirms nothing", async () => {
      const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const forged = signer.sign({ ...(snsConfirmation as SnsMessage), SigningCertURL: CERT_URL }, "1", other.privateKey);
      expect((await post(forged)).status).toBe(403);
      expect((await post({ ...(snsConfirmation as SnsMessage) })).status).toBe(403);
      expect(confirmSubscription).not.toHaveBeenCalled();
    });

    it("a SubscribeURL off the SNS host is refused even when signed", async () => {
      const res = await post(confirmation({ SubscribeURL: "https://evil.example.test/?Action=ConfirmSubscription" }));
      expect(res.status).toBe(403);
      expect(confirmSubscription).not.toHaveBeenCalled();
    });

    it("a confirmation for another topic is refused", async () => {
      const res = await post(confirmation({ TopicArn: "arn:aws:sns:us-east-1:999999999999:other" }));
      expect(res.status).toBe(403);
      expect(confirmSubscription).not.toHaveBeenCalled();
    });
  });

  describe("duplicate delivery", () => {
    it("the same SNS MessageId is processed once", async () => {
      await customer("ann.customer@example.test");
      const msg = notification(sesBody({ from: "ann.customer@example.test", subject: "Once only", body: "x" }));
      const first = await post(msg);
      const second = await post(msg);
      expect(first.body.status).toBe("created");
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ status: "duplicate" });
      expect(await countTickets()).toBe(1);
    });

    it("a failed attempt releases the MessageId so the retry is processed", async () => {
      await customer("ann.customer@example.test");
      const msg = notification(sesBody({ from: "ann.customer@example.test", subject: "Retry me", body: "x" }));
      const spy = jest.spyOn(storage, "createTask").mockRejectedValueOnce(new Error("db hiccup"));
      const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const failed = await post(msg);
        expect(failed.status).toBe(500);
        expect(await db.select().from(snsMessageDedupe)).toHaveLength(0);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("ann.customer");
      } finally {
        spy.mockRestore();
        errorLog.mockRestore();
      }
      const retry = await post(msg);
      expect(retry.body.status).toBe("created");
      expect(await countTickets()).toBe(1);
    });
  });

  describe("after-create effects match POST /api/tasks", () => {
    function spyOnHooks() {
      const autoResponse = jest.spyOn(createTimeAutoResponse, "runCreateTimeAutoResponse").mockResolvedValue(undefined);
      const broadcast = jest.fn();
      setTicketCreatedBroadcaster(broadcast);
      jest.spyOn(storage, "getTeamsIntegrationSettings").mockResolvedValue({
        enabled: true,
        notificationTypes: ["ticket_created"],
        webhookUrl: "https://teams.example.test/hook",
      } as never);
      const teams = jest.spyOn(teamsIntegration, "sendWebhookNotification").mockResolvedValue(true as never);
      return { autoResponse, broadcast, teams };
    }
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("an emailed ticket runs the auto-response, the broadcast and the Teams webhook", async () => {
      const sender = await customer("ann.customer@example.test");
      const hooks = spyOnHooks();
      const res = await post(notification(sesBody({ from: "ann.customer@example.test", subject: "Hooks", body: "x" })));
      expect(res.body.status).toBe("created");
      expect(hooks.autoResponse).toHaveBeenCalledTimes(1);
      expect(hooks.autoResponse.mock.calls[0][0]).toMatchObject({ id: res.body.ticketId, title: "Hooks" });
      expect(hooks.broadcast).toHaveBeenCalledTimes(1);
      expect(hooks.broadcast.mock.calls[0][1]).toBe(sender.id);
      expect(hooks.teams).toHaveBeenCalled();
    });

    it("POST /api/tasks runs the same three hooks", async () => {
      const sender = await customer("ann.customer@example.test");
      const agent = await loginAs(ctx.app, sender);
      const hooks = spyOnHooks();
      const res = await createTicketAs(agent);
      expect(res.status).toBe(201);
      expect(hooks.autoResponse).toHaveBeenCalledTimes(1);
      expect(hooks.broadcast).toHaveBeenCalledTimes(1);
      expect(hooks.teams).toHaveBeenCalled();
    });

    it("a failing hook never fails the emailed ticket", async () => {
      await customer("ann.customer@example.test");
      const hooks = spyOnHooks();
      hooks.autoResponse.mockRejectedValue(new Error("bedrock down"));
      hooks.broadcast.mockImplementation(() => {
        throw new Error("socket");
      });
      hooks.teams.mockRejectedValue(new Error("teams down"));
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const res = await post(notification(sesBody({ from: "ann.customer@example.test", subject: "Resilient", body: "x" })));
      expect(res.body.status).toBe("created");
      expect(await countTickets()).toBe(1);
    });
  });

  it("an SES setup notification (not a received message) writes nothing", async () => {
    const res = await post(notification({ notificationType: "AmazonSnsSubscriptionSucceeded", content: "Hello" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ignored", reason: "not_a_received_message" });
    expect(await countTickets()).toBe(0);
  });

  it("logs a reason code but never the sender, subject or body", async () => {
    await customer("ann.customer@example.test");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await post(notification(sesBody({ from: "stranger@example.test", subject: "Secret subject", body: "Secret body" })));
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain("unknown_or_ineligible_sender");
      for (const secret of ["stranger@example.test", "Secret subject", "Secret body"]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      warn.mockRestore();
    }
  });
});
