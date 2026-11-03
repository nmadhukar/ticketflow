import { expect, test, type Page } from "@playwright/test";
import { loginViaUi, watchCsp } from "./helpers";

/**
 * The assistant panel's layout and behaviour in a real browser, under the production CSP. The e2e
 * server runs without the assistant (no sidecar, no model): the page is told it is available, and
 * the real server then refuses the chat itself, which must reach the user as one readable line.
 */
async function pretendAssistantIsOn(page: Page) {
  await page.route("**/api/assistant/availability", (route) =>
    route.fulfill({ json: { enabled: true, agentId: "ticket-assistant", history: false, historyRetentionDays: null } }),
  );
}

test("on a phone the assistant fills the screen, explains a refused chat, and Escape returns to the page", async ({ page }) => {
  const csp = watchCsp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await pretendAssistantIsOn(page);
  await loginViaUi(page, "admin");

  const launcher = page.getByRole("button", { name: "Ticket assistant", exact: true });
  await expect(launcher).toBeVisible();
  // Icon only on a phone: it must not cover the page with a long label.
  expect((await launcher.boundingBox())!.width).toBeLessThanOrEqual(56);
  await launcher.click();

  const panel = page.getByRole("dialog", { name: "Ticket assistant" });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(390);
  expect(box.height).toBe(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // No sidecar here: whatever the refusal, the user reads a sentence, never an HTTP dump.
  const alert = panel.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).not.toContainText(/HTTP \d{3}|\{"error"/);

  await panel.locator("textarea").first().focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(launcher).toBeFocused();
  expect(csp.violations).toEqual([]);
});

test("on a desktop the assistant opens beside the sidebar, not over it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await pretendAssistantIsOn(page);
  await loginViaUi(page, "admin");
  await page.getByRole("button", { name: "Ticket assistant", exact: true }).click();

  const panel = page.getByRole("dialog", { name: "Ticket assistant" });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const sidebar = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
  expect(box.width).toBe(400);
  expect(box.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(box.y + box.height).toBeLessThanOrEqual(1000);
});
