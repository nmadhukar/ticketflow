import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";

test("customer B cannot open customer A's ticket and does not see it listed", async ({ browser }) => {
  // Customer A creates a ticket (through the API: the UI create flow is tickets.spec.ts).
  const a = await signedInContext(browser, "customerA");
  const title = `E2E isolation ${Date.now()}`;
  const create = await a.page.request.post("/api/tasks", {
    data: { title, description: "Private to customer A", category: "support", priority: "medium" },
  });
  expect(create.status()).toBe(201);
  const ticket = await create.json();
  const ticketNumber: string = ticket.ticketNumber;
  expect(ticketNumber).toMatch(/^TKT-/);

  // Sanity: A does see it.
  await a.page.goto("/tickets");
  await expect(a.page.getByText(ticketNumber)).toBeVisible();
  await a.context.close();

  const b = await signedInContext(browser, "customerB");
  try {
    // Its list never contains it.
    await b.page.goto("/tickets");
    await expect(b.page.getByRole("button", { name: /create first ticket|new ticket/i }).first()).toBeVisible();
    await expect(b.page.getByText(ticketNumber)).toHaveCount(0);
    await expect(b.page.getByText(title)).toHaveCount(0);

    // Opening its URL: the SPA has no per-ticket page, so the app's not-found state renders.
    await b.page.goto(`/tickets/${ticket.id}`);
    await expect(b.page.getByText(/404|not found/i).first()).toBeVisible();
    await expect(b.page.getByText(ticketNumber)).toHaveCount(0);

    // And the API refuses it, on the by-id path and the comments the panel reads.
    for (const path of [`/api/tasks/${ticket.id}`, `/api/tasks/${ticket.id}/comments`]) {
      const res = await b.page.request.get(path);
      expect([403, 404]).toContain(res.status());
      const body = await res.text();
      expect(body).not.toContain(title);
      expect(body).not.toContain(ticketNumber);
    }
  } finally {
    await b.context.close();
  }
});
