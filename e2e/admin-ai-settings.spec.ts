import { expect, test } from "@playwright/test";
import { loginViaUi } from "./helpers";

test("admin separates OpenRouter controls from AWS storage credentials", async ({ page }, testInfo) => {
  let aiSettings = {
    modelId: "deepseek/deepseek-v4-pro", isActive: true, openRouterKeyConfigured: true,
    autoResponseEnabled: true, confidenceThreshold: 0.7, maxResponseLength: 1000,
    responseTimeout: 30, autoLearnEnabled: true, minResolutionScore: 0.8,
    articleApprovalRequired: true, temperature: 0.3, maxTokens: 2000,
    maxTokensPerRequest: 3000, dailyLimitUsd: 50, monthlyLimitUsd: 100,
  };
  let storageSettings = {
    bedrockAccessKeyId: "AKIA_TEST", bedrockRegion: "us-east-1",
    bedrockModelId: "amazon.titan-text-express-v1", hasBedrockSecret: true,
  };
  let savedSecret: string | undefined;

  await page.route("**/api/ai/settings", async (route) => {
    if (route.request().method() === "POST") {
      aiSettings = { ...aiSettings, ...route.request().postDataJSON() };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aiSettings) });
  });
  await page.route("**/api/ai/test-connection", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) }));
  await page.route("**/api/storage/aws-settings", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      savedSecret = payload.bedrockSecretAccessKey;
      storageSettings = { ...storageSettings, ...payload, hasBedrockSecret: true };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(storageSettings) });
  });

  await loginViaUi(page, "admin");
  await page.goto("/admin/ai-settings");
  await expect(page.getByRole("heading", { name: "AI settings" })).toBeVisible();
  await expect(page.getByText("Server key configured")).toBeVisible();
  await expect(page.getByLabel("AWS secret access key")).toHaveCount(0);
  await page.getByLabel("OpenRouter model ID").fill("openai/gpt-4o-mini");
  await page.getByLabel("Daily limit (USD)").fill("25");
  await expect(page.getByRole("button", { name: "Test connection" })).toBeDisabled();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("All changes saved.")).toBeVisible();
  await expect.poll(() => aiSettings.modelId).toBe("openai/gpt-4o-mini");
  expect(aiSettings.dailyLimitUsd).toBe(25);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("OpenRouter answered the test request.")).toBeVisible();
  await page.getByRole("heading", { name: "AI settings" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("ai-settings-desktop.png"), fullPage: true });

  await page.getByRole("link", { name: /AWS storage settings/i }).first().click();
  await expect(page.getByRole("heading", { name: "AWS storage settings" })).toBeVisible();
  const secret = page.getByLabel("AWS secret access key");
  await expect(secret).toHaveAttribute("type", "password");
  await expect(secret).toHaveValue("");
  await expect(page.getByText("Secret configured")).toBeVisible();
  await secret.fill("replacement-secret");
  await page.getByRole("button", { name: "Save storage settings" }).click();
  await expect(page.getByText("All changes saved.")).toBeVisible();
  expect(savedSecret).toBe("replacement-secret");
  await expect(secret).toHaveValue("");
  await expect(page.getByText("replacement-secret")).toHaveCount(0);
  await page.getByRole("heading", { name: "AWS storage settings" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("storage-settings-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const saveButton = await page.getByRole("button", { name: "Save storage settings" }).boundingBox();
  const chatButton = await page.getByRole("button", { name: "Open help assistant" }).boundingBox();
  expect(saveButton && chatButton && (
    saveButton.x < chatButton.x + chatButton.width && saveButton.x + saveButton.width > chatButton.x &&
    saveButton.y < chatButton.y + chatButton.height && saveButton.y + saveButton.height > chatButton.y
  )).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("storage-settings-mobile.png"), fullPage: true });
});

test("AI analytics reports OpenRouter readiness from the provider-neutral status", async ({ page }) => {
  await page.route("**/api/ai/status", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ provider: "openrouter", providerConfigured: true, openRouterAvailable: true, modelId: "deepseek/deepseek-v4-pro", autoResponse: true, knowledgeLearning: true }),
  }));
  await loginViaUi(page, "admin");
  await page.goto("/admin/ai-analytics");
  await expect(page.getByText("AI enabled")).toBeVisible();
  await expect(page.getByText("OpenRouter", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
});
