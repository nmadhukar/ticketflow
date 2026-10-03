import { taskAttachments } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { s3Service } from "../../services/s3Service";
import { db } from "../../storage/db";

/**
 * T15: the per-file size limit. Default MAX_FILE_UPLOAD_SIZE_MB is 50 (routes/index.ts), so one
 * byte over 50 MiB is refused with the documented 413 `payload_too_large` (API_ENDPOINTS_REFERENCE.md)
 * in the error contract, and nothing reaches S3 or the table. S3 is faked.
 */
describe("attachment size limit (T15)", () => {
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

  it("a file one byte over the limit is 413 payload_too_large; nothing is uploaded or stored", async () => {
    const upload = jest.spyOn(s3Service, "uploadFile").mockResolvedValue(undefined as any);
    jest.spyOn(s3Service, "isConfigured").mockResolvedValue({ isConfigured: true, missing: [] } as any);
    const customerA = await loginAs(ctx.app, await createUser({ role: "customer" }));
    const ticket = await createTicketAs(customerA);
    expect(ticket.status).toBe(201);

    const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
    const res = await customerA
      .post(`/api/tasks/${ticket.body.id}/attachments`)
      .attach("file", tooBig, { filename: "big.txt", contentType: "text/plain" });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large", message: expect.any(String) });
    expect(upload).not.toHaveBeenCalled();
    expect(await db.select().from(taskAttachments)).toHaveLength(0);

    // The limit is per file, not a broken route: a small file on the same ticket still works.
    const ok = await customerA
      .post(`/api/tasks/${ticket.body.id}/attachments`)
      .attach("file", Buffer.from("small"), { filename: "small.txt", contentType: "text/plain" });
    expect(ok.status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await db.select().from(taskAttachments)).toHaveLength(1);
  }, 60_000);
});
