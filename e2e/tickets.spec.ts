import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cspEvents, loginViaUi, openTicket, signedInContext, watchCsp } from "./helpers";

test.describe("the app under the strict CSP", () => {
  test("loads from script-src 'self' with no CSP violations", async ({ page }) => {
    const csp = watchCsp(page);
    const response = await page.goto("/login");
    const header = response?.headers()["content-security-policy"] ?? "";
    expect(header).toContain("script-src 'self'");
    const scriptSrc =
      header
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("script-src ")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");

    // The React app really rendered (a blocked bundle would leave a blank page).
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();

    await loginViaUi(page, "customerA");
    expect(await cspEvents(page)).toEqual([]);
    expect(csp.violations).toEqual([]);
  });
});

test.describe.serial("ticket lifecycle: create, comment, reply, close, reopen", () => {
  const title = `E2E lifecycle ${Date.now()}`;
  let ticketNumber = "";
  let ticketId = 0;
  let customer: { context: BrowserContext; page: Page; csp: { violations: string[] } };

  test.beforeAll(async ({ browser }) => {
    // signedInContext attaches the CSP watcher before the login.
    customer = await signedInContext(browser, "customerA");
  });

  test.afterAll(async () => {
    await customer.context.close();
  });

  test("customer creates a ticket and sees its TKT number", async () => {
    const { page } = customer;
    await page.goto("/tickets");
    await page
      .getByRole("button", { name: /create first ticket|new ticket/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Task Title").fill(title);
    await dialog.getByLabel("Description").fill("Created by the Playwright lifecycle flow.");
    // Category is required; the form defaults the assignment to a Team, which needs a
    // department and team, so the customer leaves the ticket unassigned (staff route it).
    await dialog.getByRole("combobox").filter({ hasText: "Select category" }).click();
    await page.getByRole("option", { name: "Support" }).click();
    await dialog.getByRole("combobox").filter({ hasText: /^Team$/ }).click();
    await page.getByRole("option", { name: "Unassigned" }).click();
    const created = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/tasks" && r.request().method() === "POST"
    );
    await dialog.getByRole("button", { name: "Create Ticket" }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    ticketId = (await response.json()).id;

    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText(/^TKT-/)).toBeVisible();
    ticketNumber = (await row.getByText(/^TKT-/).innerText()).trim();
    expect(ticketNumber).toMatch(/^TKT-/);
  });

  test("customer adds a comment", async () => {
    const { page } = customer;
    await openTicket(page, ticketNumber);
    await page.getByPlaceholder("Add a comment...").fill("Customer comment from e2e");
    await page.getByRole("button", { name: "Send Comment" }).click();
    await expect(page.getByText("Customer comment from e2e")).toBeVisible();
  });

  test("an agent replies and closes the ticket; the customer sees the reply and the closed status", async ({
    browser,
  }) => {
    const agent = await signedInContext(browser, "agent");
    const admin = await signedInContext(browser, "admin");
    try {
      // Put the ticket in the agent's scope (the owner's visibility rule): the admin assigns it.
      const me = await agent.page.request.get("/api/auth/user");
      expect(me.ok()).toBeTruthy();
      const agentId = (await me.json()).id as string;
      const assign = await admin.page.request.patch(`/api/tasks/${ticketId}`, {
        data: { assigneeType: "user", assigneeId: agentId },
      });
      expect(assign.status()).toBe(200);

      await agent.page.goto("/tickets");
      await openTicket(agent.page, ticketNumber);
      await agent.page.getByPlaceholder("Add a comment...").fill("Agent reply from e2e");
      await agent.page.getByRole("button", { name: "Send Comment" }).click();
      await expect(agent.page.getByText("Agent reply from e2e")).toBeVisible();

      const row = agent.page.getByRole("row").filter({ hasText: ticketNumber });
      await row.getByRole("button", { name: "Ticket actions" }).click();
      await agent.page.getByRole("menuitem", { name: "Update Status" }).click();
      await agent.page.getByRole("menuitem", { name: /^closed$/i }).click();
      await expect(row.getByText(/^closed$/i).first()).toBeVisible();
    } finally {
      await agent.context.close();
      await admin.context.close();
    }

    const { page } = customer;
    await page.reload();
    await openTicket(page, ticketNumber);
    await expect(page.getByText("Agent reply from e2e")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: ticketNumber }).getByText(/^closed$/i).first()
    ).toBeVisible();
  });

  test("the customer who created it reopens it", async () => {
    const { page } = customer;
    const row = page.getByRole("row").filter({ hasText: ticketNumber });
    await row.getByRole("button", { name: "Ticket actions" }).click();
    await page.getByRole("menuitem", { name: "Reopen ticket" }).click();
    await expect(row.getByText(/^open$/i).first()).toBeVisible();
    await expect(row.getByText(/^closed$/i)).toHaveCount(0);

    // And it is open on the server, not just in the cache.
    await page.reload();
    await expect(
      page.getByRole("row").filter({ hasText: ticketNumber }).getByText(/^open$/i).first()
    ).toBeVisible();
  });

  test("no CSP violation was reported during the lifecycle", async () => {
    expect(await cspEvents(customer.page)).toEqual([]);
    expect(customer.csp.violations).toEqual([]);
  });
});

test.describe("a ticket whose title is markup (Y7)", () => {
  const MARKUP = "<img src=x onerror=alert(1)><script>x</script>";

  test("renders as literal text on the list and the detail panel; nothing runs and no CSP violation is reported", async ({
    browser,
  }) => {
    const customer = await signedInContext(browser, "customerA");
    const dialogs: string[] = [];
    customer.page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    try {
      const { page } = customer;
      const created = await page.request.post("/api/tasks", {
        data: { title: MARKUP, description: "Markup in the title", category: "support", priority: "medium" },
      });
      expect(created.status()).toBe(201);
      const body = await created.json();
      expect(body.title).toBe(MARKUP); // stored verbatim (R27): safety is output escaping plus the CSP

      // List page: the row shows the characters, and no element was built from them.
      await page.goto("/tickets");
      const row = page.getByRole("row").filter({ hasText: body.ticketNumber });
      await expect(row).toBeVisible();
      await expect(row).toContainText(MARKUP);
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
      await expect(page.locator("main script, table script")).toHaveCount(0);

      // Detail panel: the same, in the heading the user reads.
      await openTicket(page, body.ticketNumber);
      await expect(page.getByText(MARKUP, { exact: true }).first()).toBeVisible();
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
      await expect(page.locator("main script, [role=dialog] script, table script")).toHaveCount(0);

      // Give a would-be onerror handler time to fire, then check nothing did.
      await page.waitForTimeout(500);
      expect(dialogs).toEqual([]);
      expect(await cspEvents(page)).toEqual([]);
      expect(customer.csp.violations).toEqual([]);
    } finally {
      await customer.context.close();
    }
  });
});