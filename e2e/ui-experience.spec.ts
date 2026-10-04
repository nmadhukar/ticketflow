import { expect, test } from "@playwright/test";
import { loginViaUi } from "./helpers";

async function dismissNotifications(page: import("@playwright/test").Page) {
  const dismiss = page.getByRole("button", { name: "Dismiss notification" });
  if (await dismiss.count()) {
    await dismiss.first().click();
    await expect(dismiss).toHaveCount(0);
  }
}

test("mobile navigation stays usable and closes after choosing a page", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUi(page, "admin");
  await dismissNotifications(page);
  await page.screenshot({ path: testInfo.outputPath("mobile-workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "Navigation" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("link", { name: "Tickets", exact: true }).click();
  await expect(navigation).not.toBeVisible();
  await expect(page).toHaveURL(/\/tickets/);
  await expect(page.getByRole("button", { name: /new ticket/i }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-tickets.png"), fullPage: true });
});

test("desktop workspace exposes named controls and a clear dashboard", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginViaUi(page, "admin");
  await dismissNotifications(page);
  await expect(page.getByRole("heading", { name: /overview|dashboard/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activity", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Activity", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Open navigation" })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-dashboard.png"), fullPage: true });
  await page.getByRole("link", { name: "Tickets", exact: true }).click();
  await expect(page.getByRole("link", { name: "Tickets", exact: true })).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: testInfo.outputPath("desktop-tickets.png"), fullPage: true });
});

test("customer can follow a direct ticket link and recover from an empty search", async ({ page }, testInfo) => {
  await loginViaUi(page, "customerA");
  await dismissNotifications(page);
  const title = `UI navigation ${Date.now()}`;
  const response = await page.request.post("/api/tasks", {
    data: { title, description: "A ticket for browser navigation checks.", category: "support", priority: "medium" },
  });
  expect(response.status()).toBe(201);
  const ticket = await response.json();
  await page.goto(`/tickets?ticket=${ticket.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: /close ticket details/i }).click();
  const search = page.getByPlaceholder(/search.*ticket|search.*title/i);
  await search.fill("no-matching-ticket-for-ui-test");
  await expect(page.getByText(/no tickets found/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /new ticket/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /clear filters/i }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("row").filter({ hasText: ticket.ticketNumber })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("customer-tickets.png"), fullPage: true });
});

test("agent workspace remains usable with dark mode and reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await loginViaUi(page, "agent");
  const preference = await page.request.patch("/api/user/preferences", { data: { theme: "dark" } });
  expect(preference.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Statistics", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Statistics", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Statistics", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("agent-dark.png"), fullPage: true });
});

test("manager navigation and settings work on a narrow screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUi(page, "manager");
  await dismissNotifications(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "Navigation" });
  await expect(navigation.getByRole("link", { name: "Departments", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Teams", exact: true })).toBeVisible();
  await expect(navigation.getByText("Administration", { exact: true })).toHaveCount(0);
  await navigation.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("manager-settings-mobile.png"), fullPage: true });
});

test("unknown admin links explain the problem instead of showing the wrong section", async ({ page }) => {
  await loginViaUi(page, "admin");
  await page.goto("/admin/missing-section");
  await expect(page.getByRole("heading", { name: "Admin page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to users" })).toHaveAttribute("href", "/admin/users");
});

test("mobile navigation motion stays contained and restores keyboard focus", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUi(page, "manager");
  await dismissNotifications(page);
  const animation = await page.context().newCDPSession(page);
  await animation.send("Animation.enable");
  await animation.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  const navigation = page.getByRole("dialog", { name: "Navigation" });
  await expect(navigation).toBeVisible();
  // Capture the entrance midway through its deliberately slowed playback.
  await page.waitForTimeout(750);
  await page.screenshot({ path: testInfo.outputPath("navigation-motion.png"), animations: "allow" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await animation.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await page.keyboard.press("Escape");
  await expect(navigation).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await animation.detach();
});

test("mobile ticket form keeps its fields, attachments, and actions reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUi(page, "customerA");
  await dismissNotifications(page);
  await page.getByRole("button", { name: /new ticket/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Ticket title")).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Create Ticket", exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-ticket-form.png"), fullPage: true });
  await dialog.getByRole("tab", { name: /attachments/i }).click();
  await expect(dialog.getByRole("button", { name: /upload|choose files/i }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-attachments.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
