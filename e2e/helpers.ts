import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_USERS } from "./global-setup";

export type E2EUser = keyof typeof E2E_USERS;

/** Every console message and CSP violation seen on a page, so a spec can fail on them. */
export function watchCsp(page: Page): { violations: string[] } {
  const violations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/content security policy|refused to (load|execute|apply|connect)/i.test(text)) {
      violations.push(`console: ${text}`);
    }
  });
  page.on("pageerror", (err) => {
    if (/content security policy/i.test(err.message)) violations.push(`pageerror: ${err.message}`);
  });
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return { violations };
}

export async function cspEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

/** Signs in through the real login form and waits for the signed-in app. */
export async function loginViaUi(page: Page, who: E2EUser): Promise<void> {
  const spec = E2E_USERS[who];
  await page.goto("/login");
  await page.getByLabel("Email").first().fill(spec.email);
  await page.getByLabel("Password").first().fill(process.env[spec.env]!);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByRole("button", { name: /^sign in$/i })).toHaveCount(0);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * A fresh browser context signed in as `who`. The CSP watcher is attached
 * BEFORE the login, so a violation while signing in is recorded too.
 */
export async function signedInContext(
  browser: Browser,
  who: E2EUser
): Promise<{ context: BrowserContext; page: Page; csp: { violations: string[] } }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const csp = watchCsp(page);
  await loginViaUi(page, who);
  return { context, page, csp };
}

/** Opens the detail panel (the Eye action) of the row holding `ticketNumber`. */
export async function openTicket(page: Page, ticketNumber: string): Promise<void> {
  const row = page.getByRole("row").filter({ hasText: ticketNumber });
  await row.getByRole("button", { name: "View ticket" }).click();
}
