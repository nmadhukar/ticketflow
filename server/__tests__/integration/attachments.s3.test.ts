import request from "supertest";
import { eq } from "drizzle-orm";
import { taskAttachments } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { s3Service } from "../../services/s3Service";
import { db } from "../../storage/db";

/**
 * K8 (superseded, ruling R38): `POST /api/s3/presigned-url` was never ported and no client
 * calls it. Files go through the ticket attachment routes and the server signs the URL
 * itself, so those routes are what is tested here, with S3 and the signed-URL fetch faked.
 */
describe("attachments over S3 replace the presigned-URL endpoint (K8)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const SIGNED = "https://signed.test/bucket/key?X-Amz-Signature=abc";
  function fakeS3(configured = true) {
    return {
      configured: jest.spyOn(s3Service, "isConfigured").mockResolvedValue(
        (configured ? { isConfigured: true, missing: [] } : { isConfigured: false, missing: ["AWS_S3_BUCKET_NAME"] }) as any
      ),
      upload: jest.spyOn(s3Service, "uploadFile").mockResolvedValue(undefined as any),
      sign: jest.spyOn(s3Service, "getPresignedUrl").mockResolvedValue(SIGNED),
    };
  }

  async function ticketWithAttachment() {
    const s3 = fakeS3();
    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const ticket = await createTicketAs(customerA);
    const up = await customerA.post(`/api/tasks/${ticket.body.id}/attachments`).attach("file", Buffer.from("hello file"), {
      filename: "my notes (1).txt",
      contentType: "text/plain",
    });
    expect(up.status).toBe(201);
    return { s3, customer, customerA, ticketId: ticket.body.id as number, attachment: up.body };
  }

  it("the old endpoint does not exist", async () => {
    const a = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const res = await a.post("/api/s3/presigned-url").send({ fileName: "x.txt", fileType: "text/plain" });
    expect(res.status).toBe(404);
  });

  it("uploading stores the object under a company/date key and records only that key", async () => {
    const { s3, ticketId, attachment, customer } = await ticketWithAttachment();
    expect(s3.upload).toHaveBeenCalledTimes(1);
    const [key, body, type] = s3.upload.mock.calls[0];
    expect(String(key)).toMatch(/^.+\/.+\/\d+-my_notes__1_\.txt$/); // company / date folder / timestamp-sanitised name
    expect(Buffer.from(body as Buffer).toString()).toBe("hello file");
    expect(type).toBe("text/plain");

    expect(attachment).toMatchObject({ taskId: ticketId, fileName: "my notes (1).txt", fileType: "text/plain", fileSize: 10, userId: customer.id });
    const [row] = await db.select().from(taskAttachments).where(eq(taskAttachments.id, attachment.id));
    expect(row.fileUrl).toBe(key); // a key, never a URL
    expect(row.fileUrl).not.toMatch(/^https?:/);
  });

  it("listing returns a one-hour signed URL in place of the key", async () => {
    const { s3, customerA, ticketId } = await ticketWithAttachment();
    const list = await customerA.get(`/api/tasks/${ticketId}/attachments`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].fileUrl).toBe(SIGNED);
    expect(s3.sign).toHaveBeenCalledWith(expect.any(String), 3600);
    // The stored value is untouched by listing.
    const [row] = await db.select().from(taskAttachments);
    expect(row.fileUrl).not.toBe(SIGNED);
  });

  it("download streams the object to the ticket's owner with its name, type and length", async () => {
    const { customerA, attachment } = await ticketWithAttachment();
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("hello file"),
    } as any);

    const res = await customerA.get(`/api/attachments/${attachment.id}/download`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(SIGNED);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.headers["content-disposition"]).toContain(encodeURIComponent("my notes (1).txt"));
    expect(res.headers["content-length"]).toBe("10");
    expect((res.body as Buffer).toString()).toBe("hello file");
    // The signed URL is never sent to the browser.
    expect(JSON.stringify(res.headers)).not.toContain("X-Amz-Signature");
  });

  it("download: anonymous 401, another customer 403, an agent outside the ticket 403, a staff admin 200, unknown id 404", async () => {
    const { attachment } = await ticketWithAttachment();
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, arrayBuffer: async () => Buffer.from("hello file") } as any);
    const path = `/api/attachments/${attachment.id}/download`;

    expect((await request(ctx.app).get(path)).status).toBe(401);
    const stranger = await loginAs(ctx.app, await createUser({ role: "customer" }));
    expect((await stranger.get(path)).status).toBe(403);
    const outsider = await loginAs(ctx.app, await createUser({ role: "agent" }));
    expect((await outsider.get(path)).status).toBe(403);
    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    expect((await admin.get(path)).status).toBe(200);
    expect((await admin.get("/api/attachments/999999/download")).status).toBe(404);
  });

  it("download: a storage failure is a clean 500 storage_error", async () => {
    const { customerA, attachment } = await ticketWithAttachment();
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 403 } as any);
    const res = await customerA.get(`/api/attachments/${attachment.id}/download`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("storage_error");
  });

  it("upload: someone outside the ticket is 403 and nothing is stored or uploaded", async () => {
    const s3 = fakeS3();
    const owner = await loginAs(ctx.app, await createUser({ role: "customer" }));
    const ticket = await createTicketAs(owner);
    const stranger = await loginAs(ctx.app, await createUser({ role: "customer" }));
    const res = await stranger.post(`/api/tasks/${ticket.body.id}/attachments`).attach("file", Buffer.from("x"), "x.txt");
    expect(res.status).toBe(403);
    expect(s3.upload).not.toHaveBeenCalled();
    expect(await db.select().from(taskAttachments)).toHaveLength(0);
  });

  it("upload without a file is 400, and with S3 unconfigured it is 503 (admins are told what is missing, others are not)", async () => {
    fakeS3();
    const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
    const ticket = await createTicketAs(customerA);
    expect((await customerA.post(`/api/tasks/${ticket.body.id}/attachments`)).status).toBe(400);

    fakeS3(false);
    const asCustomer = await customerA.post(`/api/tasks/${ticket.body.id}/attachments`).attach("file", Buffer.from("x"), "x.txt");
    expect(asCustomer.status).toBe(503);
    expect(asCustomer.body.error).toBe("S3_CONFIGURATION_REQUIRED");
    expect(JSON.stringify(asCustomer.body)).not.toContain("AWS_S3_BUCKET_NAME");

    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const asAdmin = await admin.post(`/api/tasks/${ticket.body.id}/attachments`).attach("file", Buffer.from("x"), "x.txt");
    expect(asAdmin.status).toBe(503);
    expect(asAdmin.body.details).toContain("AWS_S3_BUCKET_NAME");
    expect(await db.select().from(taskAttachments)).toHaveLength(0);
  });
});
