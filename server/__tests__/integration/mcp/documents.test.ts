import request from "supertest";
import { eq } from "drizzle-orm";
import { companyPolicies, helpDocuments, knowledgeArticles, userGuideCategories, userGuides, type User } from "@shared/schema";
import { db } from "../../../storage/db";
import { backfillDocumentText, startDocumentTextBackfill } from "../../../services/documents/backfillText";
import { fillHelpDocumentText } from "../../../services/documents/documentText";
import { MCP_INSTRUCTIONS } from "../../../mcp/server";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser, loginAs } from "../helpers/fixtures";
import { mcpFor, type McpCaller } from "../helpers/mcpClient";
import { findSecrets } from "../helpers/noSecrets";
import { documentXml, inflatingDocx, inflatingPdf, makeDocx, makePdf } from "../../utils/documentFiles";

/**
 * Task MCP4 (R89-R92): the organisation's documents on MCP. Help documents, company policies,
 * guidelines (user guides) and knowledge articles are each searched, read, created, updated and
 * published or unpublished, and each is checked against its REST routes for the same user:
 * what search_documents and get_document show a customer, an agent or an admin is what the REST
 * read routes show them, and every write is admin-only exactly where REST is.
 */

type Who = "admin" | "manager" | "agent" | "customer";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let u: Record<Who, User>;
let mcp: Record<Who, McpCaller>;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDb();
  u = {
    admin: await createUser({ role: "admin" }),
    manager: await createUser({ role: "manager" }),
    agent: await createUser({ role: "agent" }),
    customer: await createUser({ role: "customer" }),
  };
  mcp = {} as Record<Who, McpCaller>;
  for (const w of Object.keys(u) as Who[]) mcp[w] = await mcpFor(ctx.app, u[w]);
});

/** Calls a tool and checks that nothing secret, and never a stored file, comes back. */
async function call(who: Who, name: string, args: object = {}) {
  const res = await mcp[who].call(name, args);
  expect(findSecrets(res.data)).toEqual([]);
  expect(res.raw).not.toMatch(/fileData|file_data/);
  return res;
}

const rest = (who: Who) => loginAs(ctx.app, u[who]);
const b64 = (b: Buffer) => b.toString("base64");

async function search(who: Who, query: string, type?: string) {
  const res = await call(who, "search_documents", type ? { query, type } : { query });
  expect([who, query, type, res.isError]).toEqual([who, query, type, false]);
  return res.data.results as Array<{ type: string; id: number; title: string; category: string | null; snippet: string; published: boolean }>;
}
const keys = (rows: Array<{ type: string; id: number }>) => rows.map((r) => `${r.type}:${r.id}`).sort();

const FORBIDDEN = { code: "FORBIDDEN", message: "Admin access required" };

// ---------------------------------------------------------------------------------------- help

describe("help documents", () => {
  it("a .docx uploaded through REST is found by search_documents and read whole by get_document, never as a file", async () => {
    const admin = await rest("admin");
    const docx = await makeDocx(["DoseSpot setup", "Enter the DoseSpot clinic key under Settings, then Save."]);
    const created = await admin.post("/api/admin/help").send({
      title: "Dosespot Configuration Document",
      filename: "Dosespot Configuration Document.docx",
      content: "Dosespot testing",
      fileData: b64(docx),
      category: "Technical",
    });
    expect(created.status).toBe(200);
    const id = created.body.id as number;

    for (const who of ["customer", "agent", "manager", "admin"] as Who[]) {
      for (const type of [undefined, "help"]) {
        const hits = await search(who, "clinic key", type);
        expect([who, type, hits.map((h) => [h.type, h.id])]).toEqual([who, type, [["help", id]]]);
        expect(hits[0].snippet).toContain("DoseSpot clinic key");
        expect(hits[0]).toMatchObject({ title: "Dosespot Configuration Document", category: "Technical", published: true });
      }
    }
    const byName = await search("customer", "DoseSpot");
    expect(byName.map((h) => h.id)).toEqual([id]);

    const doc = await call("customer", "get_document", { type: "help", id });
    expect(doc.isError).toBe(false);
    expect(doc.data).toMatchObject({ type: "help", id, title: "Dosespot Configuration Document", hasFile: true, hasFileText: true, truncated: false });
    expect(doc.data.text).toContain("Dosespot testing");
    expect(doc.data.text).toContain("Enter the DoseSpot clinic key under Settings, then Save.");
    expect(doc.data).not.toHaveProperty("fileData");
    expect(doc.raw).not.toContain(b64(docx).slice(0, 40));

    // The REST search reads the file's text too.
    const customer = await rest("customer");
    const restSearch = await customer.get("/api/help/search").query({ q: "clinic key" });
    expect(restSearch.status).toBe(200);
    expect(restSearch.body.map((d: { id: number }) => d.id)).toEqual([id]);
  });

  it("a REST edit that sends the stored file back keeps its text; a new file replaces it; a client cannot write extracted_text", async () => {
    const admin = await rest("admin");
    const created = await admin.post("/api/admin/help").send({
      title: "VPN",
      filename: "vpn.docx",
      content: "summary",
      fileData: b64(await makeDocx(["Old VPN steps"])),
    });
    const id = created.body.id as number;
    const edit = await admin
      .put(`/api/admin/help/${id}`)
      .send({ title: "VPN v2", filename: created.body.filename, fileData: created.body.fileData, extractedText: "forged" });
    expect(edit.status).toBe(200);
    expect(edit.body.extractedText).toBe("Old VPN steps");
    const replaced = await admin
      .put(`/api/admin/help/${id}`)
      .send({ filename: "vpn.pdf", fileData: b64(makePdf("New VPN steps from the PDF")) });
    expect(replaced.body.extractedText).toContain("New VPN steps from the PDF");
    // Search matches any keyword (I2): "Old" alone tells the old text from the new one.
    expect(await search("agent", "Old")).toEqual([]);
    expect((await search("agent", "New VPN steps")).map((h) => h.id)).toEqual([id]);
  });

  it("create_help_document and update_help_document (admin): text only and with a file; the rows are readable through REST", async () => {
    const plain = await call("admin", "create_help_document", {
      title: "Printer setup",
      category: "General",
      content: "Hold the reset button for ten seconds.",
      tags: ["printer"],
    });
    expect(plain.isError).toBe(false);
    expect(plain.data).toMatchObject({ type: "help", title: "Printer setup", hasFile: false, hasFileText: false });

    const withFile = await call("admin", "create_help_document", {
      title: "Lab interface",
      category: "Technical",
      content: "See the attached PDF.",
      filename: "lab.pdf",
      fileBase64: b64(makePdf("HL7 port 6661 for the lab interface")),
    });
    expect(withFile.isError).toBe(false);
    expect(withFile.data.text).toContain("HL7 port 6661");

    const customer = await rest("customer");
    const viaRest = await customer.get(`/api/help/${withFile.data.id}`);
    expect(viaRest.status).toBe(200);
    expect(viaRest.body).toMatchObject({ title: "Lab interface", filename: "lab.pdf", category: "Technical" });
    expect(viaRest.body.extractedText).toContain("HL7 port 6661");
    expect((await customer.get(`/api/help/${plain.data.id}`)).body.content).toBe("Hold the reset button for ten seconds.");

    const updated = await call("admin", "update_help_document", {
      id: String(withFile.data.id),
      title: "Lab interface v2",
      filename: "lab.md",
      fileBase64: b64(Buffer.from("# Lab\nHL7 port 7777 now")),
    });
    expect(updated.isError).toBe(false);
    expect(updated.data).toMatchObject({ title: "Lab interface v2", filename: "lab.md" });
    expect(await search("customer", "6661")).toEqual([]);
    expect((await search("customer", "7777", "help")).map((h) => h.id)).toEqual([withFile.data.id]);
    expect((await customer.get(`/api/help/${withFile.data.id}`)).body.title).toBe("Lab interface v2");
  });

  it("help writes are admin-only, as REST: agent, manager and customer get FORBIDDEN where REST answers 403", async () => {
    const [doc] = await db
      .insert(helpDocuments)
      .values({ title: "Existing", filename: "e.txt", content: "x", fileData: "" })
      .returning();
    for (const who of ["manager", "agent", "customer"] as Who[]) {
      const created = await call(who, "create_help_document", { title: "t", category: "c", content: "x" });
      expect([who, created.data]).toEqual([who, FORBIDDEN]);
      const updated = await call(who, "update_help_document", { id: doc.id, title: "changed" });
      expect([who, updated.data]).toEqual([who, FORBIDDEN]);
      const agent = await rest(who);
      expect([who, (await agent.post("/api/admin/help").send({ title: "t", filename: "a.txt", content: "x", fileData: "eA==" })).status]).toEqual([who, 403]);
      expect([who, (await agent.put(`/api/admin/help/${doc.id}`).send({ title: "changed" })).status]).toEqual([who, 403]);
    }
    const [row] = await db.select().from(helpDocuments).where(eq(helpDocuments.id, doc.id));
    expect(row.title).toBe("Existing");
    expect(await db.select().from(helpDocuments)).toHaveLength(1);
  });

  it("every signed-in user sees every help document, through REST and search alike", async () => {
    await call("admin", "create_help_document", { title: "Alpha guide", category: "General", content: "common word zebra" });
    await call("admin", "create_help_document", { title: "Beta guide", category: "General", content: "zebra again" });
    for (const who of ["customer", "agent"] as Who[]) {
      const agent = await rest(who);
      const restIds = (await agent.get("/api/help/search").query({ q: "zebra" })).body.map((d: { id: number }) => `help:${d.id}`);
      expect([who, keys(await search(who, "zebra"))]).toEqual([who, restIds.sort()]);
    }
  });
});

// ---------------------------------------------------------------------------------------- policies

describe("company policies", () => {
  it("a file uploaded through the REST multipart route becomes searchable text", async () => {
    const admin = await rest("admin");
    const res = await admin
      .post("/api/admin/company-policies")
      .field("title", "Leave policy")
      .attach("file", await makeDocx(["Every employee gets 25 days of annual leave."]), "leave.docx");
    expect(res.status).toBe(200);
    expect(res.body.extractedText).toContain("25 days of annual leave");
    const hits = await search("customer", "annual leave", "policy");
    expect(hits.map((h) => [h.type, h.id, h.category])).toEqual([["policy", res.body.id, null]]);
    expect(hits[0].snippet).toContain("25 days of annual leave");
    const doc = await call("agent", "get_document", { type: "policy", id: res.body.id });
    expect(doc.data).toMatchObject({ type: "policy", title: "Leave policy", fileName: "leave.docx", isActive: true, hasFile: true });
    expect(doc.data.text).toContain("Every employee gets 25 days of annual leave.");
  });

  it("create_policy (text or file) and update_policy as admin; the rows are readable through REST and the text one downloads as its content", async () => {
    const text = await call("admin", "create_policy", {
      title: "Dress code",
      description: "What to wear",
      content: "Business casual Monday to Thursday.",
    });
    expect(text.isError).toBe(false);
    expect(text.data).toMatchObject({ type: "policy", title: "Dress code", isActive: true, hasFile: false, fileName: "Dress code.txt", mimeType: "text/plain" });
    expect(text.data.text).toContain("What to wear");
    expect(text.data.text).toContain("Business casual Monday to Thursday.");

    const file = await call("admin", "create_policy", {
      title: "Security policy",
      filename: "security.pdf",
      fileBase64: b64(makePdf("Rotate passwords every 90 days")),
    });
    expect(file.isError).toBe(false);
    expect(file.data).toMatchObject({ fileName: "security.pdf", mimeType: "application/pdf", hasFile: true, hasFileText: true });

    const customer = await rest("customer");
    const list = await customer.get("/api/company-policies");
    expect(list.body.map((p: { id: number }) => p.id).sort()).toEqual([text.data.id, file.data.id].sort());
    const download = await customer.get(`/api/company-policies/${text.data.id}/download`);
    expect(download.status).toBe(200);
    expect(download.text).toContain("Business casual");

    const updated = await call("admin", "update_policy", { id: text.data.id, content: "Smart casual every day." });
    expect(updated.data.text).toContain("Smart casual every day.");
    expect(await search("customer", "Business")).toEqual([]);
    expect((await search("customer", "Smart casual")).map((h) => h.id)).toEqual([text.data.id]);
  });

  it("an inactive policy is hidden from agents and customers exactly as REST hides it; update_policy publishes and unpublishes it", async () => {
    const created = await call("admin", "create_policy", { title: "Draft travel policy", content: "Book economy class.", isActive: false });
    const id = created.data.id as number;
    expect(created.data).toMatchObject({ isActive: false, published: false });

    async function expectVisible(who: Who, visible: boolean) {
      const hits = await search(who, "economy class");
      expect([who, hits.map((h) => h.id)]).toEqual([who, visible ? [id] : []]);
      const typed = await search(who, "economy class", "policy");
      expect([who, typed.map((h) => h.id)]).toEqual([who, visible ? [id] : []]);
      const doc = await call(who, "get_document", { type: "policy", id });
      expect([who, doc.isError ? doc.data.code : "ok"]).toEqual([who, visible ? "ok" : "NOT_FOUND"]);
      const agent = await rest(who);
      expect([who, (await agent.get(`/api/company-policies/${id}`)).status]).toEqual([who, visible ? 200 : 404]);
      const listed = (await agent.get("/api/company-policies").query({ includeInactive: "true" })).body.map((p: { id: number }) => p.id);
      expect([who, listed.includes(id)]).toEqual([who, visible]);
    }

    for (const who of ["customer", "agent", "manager"] as Who[]) await expectVisible(who, false);
    await expectVisible("admin", true);
    expect((await search("admin", "economy class"))[0].published).toBe(false);

    expect((await call("admin", "update_policy", { id, isActive: true })).data.isActive).toBe(true);
    for (const who of ["customer", "agent"] as Who[]) await expectVisible(who, true);

    expect((await call("admin", "update_policy", { id, isActive: false })).data.isActive).toBe(false);
    for (const who of ["customer", "agent"] as Who[]) await expectVisible(who, false);
  });

  it("policy writes are admin-only, as REST", async () => {
    const created = await call("admin", "create_policy", { title: "P", content: "x" });
    for (const who of ["manager", "agent", "customer"] as Who[]) {
      expect([who, (await call(who, "create_policy", { title: "t", content: "x" })).data]).toEqual([who, FORBIDDEN]);
      expect([who, (await call(who, "update_policy", { id: created.data.id, isActive: false })).data]).toEqual([who, FORBIDDEN]);
      const agent = await rest(who);
      const post = await agent.post("/api/admin/company-policies").attach("file", Buffer.from("x"), "x.txt");
      expect([who, post.status]).toEqual([who, 403]);
      expect([who, (await agent.post(`/api/admin/company-policies/${created.data.id}/toggle`)).status]).toEqual([who, 403]);
    }
    const [row] = await db.select().from(companyPolicies).where(eq(companyPolicies.id, created.data.id));
    expect(row.isActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------- guidelines

describe("guidelines (user guides)", () => {
  it("list_guideline_categories matches GET /api/guide-categories, and create_guideline takes a category by name", async () => {
    await db.insert(userGuideCategories).values([
      { name: "Onboarding", description: "First steps", displayOrder: 1 },
      { name: "Billing", displayOrder: 2 },
    ]);
    const viaRest = await (await rest("customer")).get("/api/guide-categories");
    const viaMcp = await call("customer", "list_guideline_categories");
    expect(viaMcp.data.categories.map((c: { name: string }) => c.name)).toEqual(viaRest.body.map((c: { name: string }) => c.name));
    expect(viaMcp.data.categories[0]).toEqual({ id: viaRest.body[0].id, name: "Onboarding", description: "First steps", icon: null, displayOrder: 1 });

    const created = await call("admin", "create_guideline", {
      title: "First login",
      category: "Onboarding",
      content: "<p>Open the <b>portal</b> and sign in.</p><script>alert(1)</script>",
      description: "How to sign in the first time",
      type: "scribehow",
      scribehowUrl: "https://scribehow.com/shared/first-login",
      tags: ["login"],
    });
    expect(created.isError).toBe(false);
    expect(created.data).toMatchObject({
      type: "guideline",
      title: "First login",
      category: "Onboarding",
      guideType: "scribehow",
      scribehowUrl: "https://scribehow.com/shared/first-login",
      videoUrl: null,
      description: "How to sign in the first time",
      isPublished: true,
    });
    expect(created.data.content).toBe("<p>Open the <b>portal</b> and sign in.</p>");
    expect(created.data.text).toBe("How to sign in the first time\n\nOpen the portal and sign in.");

    const viaRestGuide = await (await rest("customer")).get(`/api/guides/${created.data.id}`);
    expect(viaRestGuide.status).toBe(200);
    expect(viaRestGuide.body).toMatchObject({ title: "First login", category: "Onboarding", type: "scribehow", content: created.data.content });

    const read = await call("customer", "get_document", { type: "guideline", id: created.data.id });
    expect(read.data).toMatchObject({ description: "How to sign in the first time", content: created.data.content, guideType: "scribehow", category: "Onboarding" });
    const hits = await search("customer", "portal", "guideline");
    expect(hits.map((h) => [h.type, h.id, h.category])).toEqual([["guideline", created.data.id, "Onboarding"]]);
    expect(hits[0].snippet).toContain("Open the portal and sign in.");
    expect(hits[0].snippet).not.toMatch(/<|>/);
  });

  it("a draft guideline is seen by staff only, exactly as REST; update_guideline publishes and unpublishes it", async () => {
    const created = await call("admin", "create_guideline", {
      title: "Payroll export",
      category: "Billing",
      content: "Export payroll from the Reports tab.",
      isPublished: false,
      type: "video",
      videoUrl: "https://videos.example.test/payroll",
    });
    const id = created.data.id as number;
    expect(created.data).toMatchObject({ isPublished: false, videoUrl: "https://videos.example.test/payroll" });

    async function expectVisible(who: Who, visible: boolean) {
      for (const type of [undefined, "guideline"]) {
        expect([who, type, (await search(who, "payroll", type)).map((h) => h.id)]).toEqual([who, type, visible ? [id] : []]);
      }
      const doc = await call(who, "get_document", { type: "guideline", id });
      expect([who, doc.isError ? doc.data.code : "ok"]).toEqual([who, visible ? "ok" : "NOT_FOUND"]);
      const agent = await rest(who);
      expect([who, (await agent.get(`/api/guides/${id}`)).status]).toEqual([who, visible ? 200 : 404]);
      const listed = (await agent.get("/api/guides")).body.map((g: { id: number }) => g.id);
      expect([who, listed.includes(id)]).toEqual([who, visible]);
    }

    // REST shows drafts to staff (admin, manager, agent), not to customers.
    await expectVisible("customer", false);
    for (const who of ["agent", "manager", "admin"] as Who[]) await expectVisible(who, true);

    expect((await call("admin", "update_guideline", { id, isPublished: true })).data.isPublished).toBe(true);
    await expectVisible("customer", true);
    expect((await call("admin", "update_guideline", { id, isPublished: false, title: "Payroll export (old)" })).data).toMatchObject({
      isPublished: false,
      title: "Payroll export (old)",
    });
    await expectVisible("customer", false);
    await expectVisible("agent", true);
  });

  it("guideline writes are admin-only, as REST, and a bad type or URL is a coded VALIDATION", async () => {
    const created = await call("admin", "create_guideline", { title: "G", category: "C", content: "x" });
    for (const who of ["manager", "agent", "customer"] as Who[]) {
      expect([who, (await call(who, "create_guideline", { title: "t", category: "c", content: "x" })).data]).toEqual([who, FORBIDDEN]);
      expect([who, (await call(who, "update_guideline", { id: created.data.id, isPublished: false })).data]).toEqual([who, FORBIDDEN]);
      const agent = await rest(who);
      expect([who, (await agent.post("/api/admin/guides").send({ title: "t", category: "c", type: "html", content: "x" })).status]).toEqual([who, 403]);
      expect([who, (await agent.put(`/api/admin/guides/${created.data.id}`).send({ isPublished: false })).status]).toEqual([who, 403]);
    }
    const bad = await call("admin", "create_guideline", { title: "t", category: "c", content: "x", type: "pdf" });
    expect(bad.data.code).toBe("VALIDATION");
    expect(bad.data.details.fieldErrors.type).toBeDefined();
    const badUrl = await call("admin", "update_guideline", { id: created.data.id, videoUrl: "not a url" });
    expect(badUrl.data.details.fieldErrors.videoUrl).toBeDefined();
    const [row] = await db.select().from(userGuides).where(eq(userGuides.id, created.data.id));
    expect(row.isPublished).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------- knowledge

describe("knowledge articles", () => {
  it("create_knowledge_article makes a draft that only an admin sees; update_knowledge_article publishes and unpublishes it, as REST shows it", async () => {
    const created = await call("admin", "create_knowledge_article", {
      title: "Reset MFA",
      content: "Ask IT to clear the authenticator enrolment.",
      summary: "MFA reset steps",
      category: "security",
      tags: ["mfa"],
    });
    expect(created.isError).toBe(false);
    const id = created.data.id as number;
    expect(created.data).toMatchObject({ type: "knowledge", isPublished: false, status: "draft", published: false, category: "security" });

    async function expectVisible(who: Who, visible: boolean) {
      for (const type of [undefined, "knowledge"]) {
        expect([who, type, (await search(who, "authenticator", type)).map((h) => h.id)]).toEqual([who, type, visible ? [id] : []]);
      }
      const doc = await call(who, "get_document", { type: "knowledge", id });
      expect([who, doc.isError ? doc.data.code : "ok"]).toEqual([who, visible ? "ok" : "NOT_FOUND"]);
      if (who !== "admin") {
        const agent = await rest(who);
        const restHits = (await agent.get("/api/knowledge/search").query({ query: "authenticator" })).body.map((a: { id: number }) => a.id);
        expect([who, restHits]).toEqual([who, visible ? [id] : []]);
        const published = (await agent.get("/api/knowledge/articles")).body.map((a: { id: number }) => a.id);
        expect([who, published.includes(id)]).toEqual([who, visible]);
      }
    }

    for (const who of ["customer", "agent", "manager"] as Who[]) await expectVisible(who, false);
    await expectVisible("admin", true);
    const adminList = (await (await rest("admin")).get("/api/admin/knowledge")).body.map((a: { id: number }) => a.id);
    expect(adminList).toContain(id);

    const published = await call("admin", "update_knowledge_article", { id, isPublished: true });
    expect(published.data).toMatchObject({ isPublished: true, status: "published", published: true });
    for (const who of ["customer", "agent"] as Who[]) await expectVisible(who, true);
    const doc = await call("customer", "get_document", { type: "knowledge", id });
    expect(doc.data.text).toBe("MFA reset steps\n\nAsk IT to clear the authenticator enrolment.");
    // The existing knowledge tools agree.
    expect((await call("customer", "get_knowledge_article", { id })).isError).toBe(false);

    const unpublished = await call("admin", "update_knowledge_article", { id, isPublished: false, title: "Reset MFA (old)" });
    expect(unpublished.data).toMatchObject({ isPublished: false, status: "draft", title: "Reset MFA (old)" });
    for (const who of ["customer", "agent"] as Who[]) await expectVisible(who, false);
  });

  it("knowledge writes are admin-only, as REST", async () => {
    const created = await call("admin", "create_knowledge_article", { title: "K", content: "x", isPublished: true });
    expect(created.data.status).toBe("published");
    for (const who of ["manager", "agent", "customer"] as Who[]) {
      expect([who, (await call(who, "create_knowledge_article", { title: "t", content: "x" })).data]).toEqual([who, FORBIDDEN]);
      expect([who, (await call(who, "update_knowledge_article", { id: created.data.id, isPublished: false })).data]).toEqual([who, FORBIDDEN]);
      const agent = await rest(who);
      expect([who, (await agent.post("/api/admin/knowledge").send({ title: "t", content: "x" })).status]).toEqual([who, 403]);
      expect([who, (await agent.patch(`/api/admin/knowledge/${created.data.id}/publish`).send({ isPublished: false })).status]).toEqual([who, 403]);
    }
    const [row] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, created.data.id));
    expect(row.isPublished).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------- across sources

describe("search_documents across the four sources", () => {
  it("ranks title matches first, then content matches, newest first; the type filter keeps one source", async () => {
    const old = await call("admin", "create_help_document", { title: "Backup basics", category: "IT", content: "nothing here" });
    const body = await call("admin", "create_policy", { title: "Retention", content: "Keep each backup for a year." });
    const newer = await call("admin", "create_knowledge_article", { title: "Backup restore", content: "Steps", isPublished: true });
    const guide = await call("admin", "create_guideline", { title: "Laptops", category: "IT", content: "Run a backup weekly." });
    await db.update(helpDocuments).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(helpDocuments.id, old.data.id));
    await db.update(companyPolicies).set({ createdAt: new Date("2026-03-01T00:00:00Z") }).where(eq(companyPolicies.id, body.data.id));
    await db.update(userGuides).set({ createdAt: new Date("2026-02-01T00:00:00Z") }).where(eq(userGuides.id, guide.data.id));

    const hits = await search("customer", "backup");
    expect(hits.map((h) => `${h.type}:${h.id}`)).toEqual([
      `knowledge:${newer.data.id}`,
      `help:${old.data.id}`,
      `policy:${body.data.id}`,
      `guideline:${guide.data.id}`,
    ]);
    expect((await search("customer", "backup", "policy")).map((h) => h.type)).toEqual(["policy"]);
    const limited = await call("customer", "search_documents", { query: "backup", limit: "2" });
    expect(limited.data.returned).toBe(2);
  });

  it("refuses bad arguments with a coded VALIDATION, and a filter value nobody writes is refused, not matched to nothing", async () => {
    const long = await call("agent", "search_documents", { query: "x".repeat(201) });
    expect(long.data.code).toBe("VALIDATION");
    expect(long.data.details.fieldErrors.query).toBeDefined();
    const blank = await call("agent", "search_documents", { query: "   " });
    expect(blank.data.details.fieldErrors.query).toBeDefined();
    const badType = await call("agent", "search_documents", { query: "xy", type: "faq" });
    expect(badType.data.details.fieldErrors.type).toEqual(["Must be one of: help, policy, guideline, knowledge"]);
    const badLimit = await call("agent", "search_documents", { query: "xy", limit: 500 });
    expect(badLimit.data.details.fieldErrors.limit).toBeDefined();
    const missing = await call("agent", "search_documents", {});
    expect(missing.isError).toBe(true);

    const badId = await call("agent", "get_document", { type: "help", id: "abc" });
    expect(badId.data.details.fieldErrors.id).toBeDefined();
    const badDocType = await call("agent", "get_document", { type: "wiki", id: 1 });
    expect(badDocType.data.details.fieldErrors.type).toBeDefined();
    expect((await call("agent", "get_document", { type: "help", id: 999999 })).data.code).toBe("NOT_FOUND");

    const badExt = await call("admin", "create_help_document", { title: "t", category: "c", content: "x", filename: "a.exe", fileBase64: "eA==" });
    expect(badExt.data.details.fieldErrors.filename).toBeDefined();
    const badB64 = await call("admin", "create_policy", { title: "t", filename: "a.txt", fileBase64: "not base64!" });
    expect(badB64.data.details.fieldErrors.fileBase64).toBeDefined();
    const lonely = await call("admin", "create_policy", { title: "t", content: "x", filename: "a.txt" });
    expect(lonely.data.details.fieldErrors.fileBase64).toBeDefined();
    const empty = await call("admin", "create_policy", { title: "t" });
    expect(empty.data.details.fieldErrors.content).toBeDefined();
    const nothing = await call("admin", "update_knowledge_article", { id: 1 });
    expect(nothing.data.code).toBe("VALIDATION");
    expect((await call("admin", "update_policy", { id: 999999, title: "x" })).data.code).toBe("NOT_FOUND");
    expect(await db.select().from(helpDocuments)).toHaveLength(0);
    expect(await db.select().from(companyPolicies)).toHaveLength(0);
  });
});

describe("R92: server instructions", () => {
  it("initialize over HTTP tells the model to search the documents before answering", async () => {
    const res = await request(ctx.app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${mcp.customer.key}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.instructions).toBe(MCP_INSTRUCTIONS);
    expect(res.body.result.instructions).toMatch(/search_documents/);
  });
});

// ---------------------------------------------------------------------------------------- backfill

describe("startup backfill (R90)", () => {
  it("fills a pre-existing row whose extracted_text is null, marks an unsupported one tried (''), and the filled one becomes searchable", async () => {
    const docx = await makeDocx(["Legacy upload about the DoseSpot clinic key"]);
    const [legacy] = await db
      .insert(helpDocuments)
      .values({ title: "Legacy", filename: "Legacy.docx", content: "Dosespot testing", fileData: b64(docx) })
      .returning();
    const [oldWord] = await db
      .insert(helpDocuments)
      .values({ title: "Old Word", filename: "old.doc", content: "summary", fileData: b64(Buffer.from("binary")) })
      .returning();
    const [policy] = await db
      .insert(companyPolicies)
      .values({
        title: "Legacy policy",
        fileData: b64(makePdf("Legacy policy text about overtime")),
        fileName: "legacy.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        uploadedBy: u.admin.id,
      })
      .returning();
    expect(await search("customer", "clinic key")).toEqual([]);

    const lines: string[] = [];
    const counts = await backfillDocumentText((l) => lines.push(l));
    expect(counts).toEqual({ help: { filled: 1, unsupported: 1, failed: 0, deferred: 0 }, policies: { filled: 1, unsupported: 0, failed: 0, deferred: 0 } });
    expect(lines).toEqual([
      "Document text backfill: help documents 1 filled, 1 unsupported, 0 unreadable; policies 1 filled, 0 unsupported, 0 unreadable",
    ]);

    const [filled] = await db.select().from(helpDocuments).where(eq(helpDocuments.id, legacy.id));
    expect(filled.extractedText).toContain("DoseSpot clinic key");
    const [unsupported] = await db.select().from(helpDocuments).where(eq(helpDocuments.id, oldWord.id));
    // '' = tried, nothing extractable (review I1): never read again. NULL = never tried.
    expect(unsupported.extractedText).toBe("");
    const [p] = await db.select().from(companyPolicies).where(eq(companyPolicies.id, policy.id));
    expect(p.extractedText).toContain("overtime");

    const hits = await search("customer", "clinic key");
    expect(hits.map((h) => h.id)).toEqual([legacy.id]);
    expect(hits[0].snippet).toContain("DoseSpot clinic key");

    // A second run finds nothing left to do: every row was tried once.
    const again = await backfillDocumentText(() => undefined);
    expect(again).toEqual({ help: { filled: 0, unsupported: 0, failed: 0, deferred: 0 }, policies: { filled: 0, unsupported: 0, failed: 0, deferred: 0 } });
  });

  it("review N1: hostile files (a 1 GB lying docx, a 1 GB pdf bomb, a zip bomb, a corrupt pdf) are tried once, in the bounded extractor, and skipped by the next start", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const bomb = await makeDocx([], { documentXml: documentXml(["ha ".repeat(4_000_000)]) });
      const insertHelp = async (title: string, filename: string, data: Buffer) =>
        (await db.insert(helpDocuments).values({ title, filename, content: "x", fileData: b64(data) }).returning())[0];
      const bombRow = await insertHelp("Bomb", "bomb.docx", bomb);
      const liarRow = await insertHelp("Liar", "liar.docx", await inflatingDocx(1024 * 1024 * 1024 + 1));
      const good = await insertHelp("Good", "good.txt", Buffer.from("plain survivor text"));
      const insertPolicy = async (title: string, data: Buffer) =>
        (
          await db
            .insert(companyPolicies)
            .values({ title, fileData: b64(data), fileName: `${title}.pdf`, fileSize: data.length, mimeType: "application/pdf", uploadedBy: u.admin.id })
            .returning()
        )[0];
      const corrupt = await insertPolicy("Corrupt", Buffer.from("%PDF-1.4 not really"));
      const pdfBomb = await insertPolicy("PdfBomb", await inflatingPdf(1024 * 1024 * 1024 + 1));

      const rssBefore = process.memoryUsage.rss();
      const counts = await backfillDocumentText(() => undefined);
      expect((process.memoryUsage.rss() - rssBefore) / 1024 / 1024).toBeLessThan(200);
      expect(counts).toEqual({ help: { filled: 1, unsupported: 0, failed: 2, deferred: 0 }, policies: { filled: 0, unsupported: 0, failed: 2, deferred: 0 } });
      const rows = await db.select().from(helpDocuments);
      for (const r of [bombRow, liarRow]) expect([r.title, rows.find((x) => x.id === r.id)!.extractedText]).toEqual([r.title, ""]);
      expect(rows.find((r) => r.id === good.id)!.extractedText).toBe("plain survivor text");
      const policies = await db.select().from(companyPolicies);
      for (const p of [corrupt, pdfBomb]) expect([p.title, policies.find((x) => x.id === p.id)!.extractedText]).toEqual([p.title, ""]);
      // Logged by type only.
      for (const line of errors.mock.calls.map((x) => x.map(String).join(" "))) {
        expect(line).toMatch(/^Document text extraction failed \[[^\]]+\]$/);
      }

      // The next start reads none of them again.
      errors.mockClear();
      expect(await backfillDocumentText(() => undefined)).toEqual({
        help: { filled: 0, unsupported: 0, failed: 0, deferred: 0 },
        policies: { filled: 0, unsupported: 0, failed: 0, deferred: 0 },
      });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  }, 120000);

  it("review N2: a row is claimed ('') before its file is parsed, so a parse that dies leaves it tried, never retried", async () => {
    const [row] = await db
      .insert(helpDocuments)
      .values({ title: "Claimed", filename: "c.docx", content: "x", fileData: b64(await makeDocx(["claimed text"])) })
      .returning();
    const seenDuringParse: Array<string | null> = [];
    // The extractor "dies" mid-parse: it reports what the row held while it ran, then throws.
    const dying = async () => {
      const [now] = await db.select().from(helpDocuments).where(eq(helpDocuments.id, row.id));
      seenDuringParse.push(now.extractedText);
      throw new Error("killed mid-parse");
    };
    await expect(backfillDocumentText(() => undefined, { extract: dying })).rejects.toThrow("killed mid-parse");
    expect(seenDuringParse).toEqual([""]);
    const [after] = await db.select().from(helpDocuments).where(eq(helpDocuments.id, row.id));
    expect(after.extractedText).toBe("");
    // The next start does not touch it.
    const extract = jest.fn(async () => ({ text: "never", retry: false }));
    expect(await backfillDocumentText(() => undefined, { extract })).toEqual({
      help: { filled: 0, unsupported: 0, failed: 0, deferred: 0 },
      policies: { filled: 0, unsupported: 0, failed: 0, deferred: 0 },
    });
    expect(extract).not.toHaveBeenCalled();
  });

  it("review N2: an MCP upload stores the row with '' while its file is being parsed, and a hostile file leaves it ''", async () => {
    const bomb = await inflatingPdf(1024 * 1024 * 1024 + 1);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const pending = call("admin", "create_help_document", { title: "Upload in flight", category: "C", content: "x", filename: "b.pdf", fileBase64: b64(bomb) });
      let seen: string | null | undefined;
      for (let i = 0; i < 400 && seen === undefined; i++) {
        const [r] = await db.select().from(helpDocuments).where(eq(helpDocuments.title, "Upload in flight"));
        if (r) seen = r.extractedText;
        else await new Promise((res) => setTimeout(res, 25));
      }
      expect(seen).toBe("");
      const done = await pending;
      expect(done.isError).toBe(false);
      expect(done.data).toMatchObject({ title: "Upload in flight", hasFile: true, hasFileText: false });
      const [r] = await db.select().from(helpDocuments).where(eq(helpDocuments.title, "Upload in flight"));
      expect(r.extractedText).toBe("");
    } finally {
      errors.mockRestore();
    }
  }, 120000);

  it("review N9: in the backfill, a row whose parse never began (extractor busy) goes back to NULL and is filled by the next run; a failed parse stays ''", async () => {
    const insert = async (title: string) =>
      (await db.insert(helpDocuments).values({ title, filename: `${title}.docx`, content: "x", fileData: b64(await makeDocx([title])) }).returning())[0];
    const busy = await insert("busyrow");
    const broken = await insert("brokenrow");
    const lines: string[] = [];
    const first = await backfillDocumentText((l) => lines.push(l), {
      extract: async (file) => (file.filename === "busyrow.docx" ? { text: null, retry: true } : { text: null, retry: false }),
    });
    expect(first).toEqual({ help: { filled: 0, unsupported: 0, failed: 1, deferred: 1 }, policies: { filled: 0, unsupported: 0, failed: 0, deferred: 0 } });
    expect(lines).toContain("Document text backfill: 1 row(s) deferred (the extractor was busy); the next start retries them");
    const rows = await db.select().from(helpDocuments);
    expect(rows.find((r) => r.id === busy.id)!.extractedText).toBeNull();
    expect(rows.find((r) => r.id === broken.id)!.extractedText).toBe("");
    // The next run (real extraction) fills the deferred row only.
    const second = await backfillDocumentText(() => undefined);
    expect(second).toEqual({ help: { filled: 1, unsupported: 0, failed: 0, deferred: 0 }, policies: { filled: 0, unsupported: 0, failed: 0, deferred: 0 } });
    const [filled] = await db.select().from(helpDocuments).where(eq(helpDocuments.id, busy.id));
    expect(filled.extractedText).toBe("busyrow");
  });

  it("review N9: an upload that timed out in the extractor queue is stored NULL (retried later); one whose parse was killed stays ''", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const bomb = await inflatingPdf(1024 * 1024 * 1024 + 1);
      const insert = async (title: string) =>
        (await db.insert(helpDocuments).values({ title, filename: "x", content: "x", fileData: "", extractedText: "" }).returning())[0];
      const [b1, b2, queued] = [await insert("bomb1"), await insert("bomb2"), await insert("queued")];
      // Two bomb parses hold both extractor slots; the third upload waits in the queue past its time limit.
      const holders = [fillHelpDocumentText(b1.id, { filename: "b1.pdf", data: bomb }), fillHelpDocumentText(b2.id, { filename: "b2.pdf", data: bomb })];
      const text = await fillHelpDocumentText(queued.id, { filename: "q.docx", data: await makeDocx(["queued text"]) }, { timeoutMs: 200 });
      expect(text).toBeNull();
      await Promise.all(holders);
      const rows = await db.select().from(helpDocuments);
      expect(rows.find((r) => r.id === queued.id)!.extractedText).toBeNull();
      expect(rows.find((r) => r.id === b1.id)!.extractedText).toBe("");
      expect(rows.find((r) => r.id === b2.id)!.extractedText).toBe("");
    } finally {
      errors.mockRestore();
    }
  }, 120000);

  it("does nothing, and marks nothing, when the extractor file cannot be found", async () => {
    await db.insert(helpDocuments).values({ title: "Waiting", filename: "w.txt", content: "x", fileData: b64(Buffer.from("later")) });
    const lines: string[] = [];
    const counts = await backfillDocumentText((l) => lines.push(l), { workerAvailable: () => false });
    expect(counts).toBeNull();
    expect(lines).toEqual(["Document text backfill skipped: the extractor file was not found"]);
    const [row] = await db.select().from(helpDocuments);
    expect(row.extractedText).toBeNull();
  });

  it("startDocumentTextBackfill never rejects: a failure is one line by error type", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        startDocumentTextBackfill(async () => {
          throw Object.assign(new Error("connect postgres://u:secret@db"), { code: "ECONNREFUSED" });
        })
      ).resolves.toBeUndefined();
      expect(errors.mock.calls.map((c) => c.join(" "))).toEqual(["Document text backfill failed [Error ECONNREFUSED]"]);
    } finally {
      errors.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------------------- review fixes

describe("review I2: keyword search", () => {
  it("finds a document from the key words of a question, in any order, and ranks the all-terms match first", async () => {
    const doc = await call("admin", "create_help_document", {
      title: "Prescribing setup",
      category: "Technical",
      content: "Enter the DoseSpot clinic key under Settings",
    });
    const partial = await call("admin", "create_help_document", { title: "Office", category: "General", content: "Who holds the office key" });
    for (const query of ["DoseSpot key", "clinic key settings", "How do I set the DoseSpot clinic key?", "Dose Spot"]) {
      const res = await call("customer", "search_documents", { query });
      expect([query, res.isError]).toEqual([query, false]);
      expect([query, res.data.results[0]?.id]).toEqual([query, doc.data.id]);
      expect([query, res.data.results[0].snippet]).toEqual([query, expect.stringContaining("DoseSpot clinic key")]);
    }
    const question = await call("customer", "search_documents", { query: "How do I set the DoseSpot clinic key?" });
    expect(question.data.terms).toEqual(["set", "dosespot", "clinic", "key"]);
    expect(question.data.results.map((r: { id: number }) => r.id)).toEqual([doc.data.id, partial.data.id]);
    expect(question.data.results.map((r: { matchedTerms: number }) => r.matchedTerms)).toEqual([4, 1]);
  });

  it("review N4: 'it' is a keyword: \"IT policy\" ranks the document titled \"IT policy\" first", async () => {
    const it_ = await call("admin", "create_policy", { title: "IT policy", content: "Laptops are encrypted." });
    await call("admin", "create_policy", { title: "Travel policy", content: "Book economy class." });
    const res = await call("customer", "search_documents", { query: "IT policy" });
    expect(res.data.terms).toEqual(["it", "policy"]);
    expect(res.data.results[0]).toMatchObject({ id: it_.data.id, title: "IT policy", matchedTerms: 2 });
  });

  it("review N4: a query with no keyword left (\"AT&T\") is searched as one phrase, and finds it", async () => {
    const att = await call("admin", "create_help_document", { title: "Carrier billing", category: "General", content: "Our phones are on AT&T." });
    await call("admin", "create_help_document", { title: "Other", category: "General", content: "at the office" });
    const res = await call("customer", "search_documents", { query: "AT&T" });
    expect(res.isError).toBe(false);
    expect(res.data.terms).toEqual(["at&t"]);
    expect(res.data.results.map((r: { id: number }) => r.id)).toEqual([att.data.id]);
    expect(res.data.results[0].snippet).toContain("AT&T");
    // Review N11: a keyword or phrase needs 2+ characters, so "x" (or a lone "&") is refused rather
    // than matching every title that contains an x; so are an empty and a blank query.
    for (const query of ["", "   ", "x", " & "]) {
      const blank = await call("customer", "search_documents", { query });
      expect([query, blank.isError, blank.data.code]).toEqual([query, true, "VALIDATION"]);
    }
    // Stopwords alone become a phrase too: no error, and nothing is matched by accident.
    const stop = await call("customer", "search_documents", { query: "how do I do" });
    expect(stop.isError).toBe(false);
    expect(stop.data.terms).toEqual(["how do i do"]);
    expect(stop.data.results).toEqual([]);
  });

  it("punctuation, LIKE wildcards included, separates keywords; a wildcard-only query is a literal phrase", async () => {
    await call("admin", "create_help_document", { title: "Discounts", category: "General", content: "Take 100% off" });
    await call("admin", "create_help_document", { title: "Plain", category: "General", content: "Nothing special 100 here" });
    await call("admin", "create_help_document", { title: "Code", category: "General", content: "The token %_% is literal" });
    const hits = await search("customer", "100%");
    expect(hits.map((h) => h.title).sort()).toEqual(["Discounts", "Plain"]);
    // "%_%" has no keyword, so it is one phrase, escaped: it matches only the literal text.
    expect((await search("customer", "%_%")).map((h) => h.title)).toEqual(["Code"]);
  });
});

describe("review minors", () => {
  it("M2 (review M5): a policy file name outside Latin-1 downloads with an ASCII fallback and an RFC 5987 filename*", async () => {
    const name = 'Zasady "łódź" 政策.txt';
    const created = await call("admin", "create_policy", { title: "Unicode", filename: name, fileBase64: b64(Buffer.from("unicode policy body")) });
    expect(created.isError).toBe(false);
    const res = await (await rest("customer")).get(`/api/company-policies/${created.data.id}/download`);
    expect(res.status).toBe(200);
    expect(res.text).toBe("unicode policy body");
    const header = res.headers["content-disposition"] as string;
    expect(header).toBe(
      `attachment; filename="Zasady ___d__ __.txt"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`
    );
    expect(header).not.toMatch(/[\r\n]/);
  });

  it("M4: null in an optional argument counts as absent, not as a protocol error", async () => {
    const policy = await call("admin", "create_policy", { title: "Nulls", content: "text", description: null, isActive: null, filename: null, fileBase64: null });
    expect(policy.isError).toBe(false);
    expect(policy.data.isActive).toBe(true);
    const updated = await call("admin", "update_policy", { id: policy.data.id, description: null, isActive: false });
    expect(updated.isError).toBe(false);
    expect(updated.data.isActive).toBe(false);
    const found = await call("admin", "search_documents", { query: "Nulls", type: null, limit: null });
    expect(found.isError).toBe(false);
    const article = await call("admin", "create_knowledge_article", { title: "A", content: "B", tags: null, summary: null, category: null, isPublished: null });
    expect(article.isError).toBe(false);
    expect(article.data).toMatchObject({ isPublished: false, category: "general" });
    const guide = await call("admin", "create_guideline", { title: "G", category: "C", content: "x", type: null, tags: null, isPublished: null, videoUrl: null });
    expect(guide.isError).toBe(false);
    const help = await call("admin", "update_help_document", {
      id: (await call("admin", "create_help_document", { title: "H", category: "C", content: "x", tags: null })).data.id,
      title: "H2",
      tags: null,
      filename: null,
    });
    expect(help.data.title).toBe("H2");
  });
});
