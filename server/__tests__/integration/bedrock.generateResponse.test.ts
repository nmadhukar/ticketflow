/**
 * bedrockIntegration.generateResponse called DIRECTLY (it was only exercised
 * through analyzeTicket / the auto-response service). AWS is faked at the SDK
 * boundary; the real prompt, JSON extraction and fallback rules run.
 */
import type { Task } from "@shared/schema";
import { bedrockMock, MOCK_MODEL_ID } from "../mocks/aws-bedrock.mock";
import { closeDb, resetDb } from "./helpers/testDb";
import { createUser } from "./helpers/fixtures";
import { storage } from "../../storage";
import { generateResponse } from "../../services/ai/bedrockIntegration";

const FALLBACK =
  "I'm unable to generate an automated response at this time. A support agent will assist you shortly.";

const ticket = {
  title: "Printer jam",
  description: "The office printer is jammed",
  category: "support",
  priority: "medium",
} as unknown as Task;

const articles = [
  { id: 7, title: "Clear a jam", summary: "Open tray two" },
  { id: 9, title: "Toner", summary: "Swap the toner" },
];

describe("bedrockIntegration.generateResponse", () => {
  beforeAll(async () => {
    await resetDb();
    const admin = await createUser({ role: "admin" });
    await storage.updateBedrockSettings(
      {
        bedrockAccessKeyId: "AKIAFAKEFAKEFAKE",
        bedrockSecretAccessKey: "fake-secret-for-tests",
        bedrockRegion: "us-east-1",
        bedrockModelId: MOCK_MODEL_ID,
        autoResponseEnabled: true,
        confidenceThreshold: "0.7",
        maxResponseLength: 1000,
        maxTokensPerRequest: 3000,
      } as never,
      admin.id
    );
  });
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(() => {
    bedrockMock.reset();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the model's reply, confidence and cited articles, and shows the model the knowledge base", async () => {
    bedrockMock.handler = () =>
      JSON.stringify({ response: "Open tray two.", confidence: 0.91, knowledgeBaseArticles: [9] });
    const out = await generateResponse(ticket, articles);
    expect(out.response).toBe("Open tray two.");
    expect(out.confidence).toBe(0.91);
    expect(out.suggestedArticles).toEqual([9]);
    expect(bedrockMock.totalCalls()).toBe(1);
    expect(bedrockMock.seen()).toContain("- Clear a jam: Open tray two");
    expect(bedrockMock.seen()).toContain("- Toner: Swap the toner");
  });

  it("unwraps a markdown-fenced reply", async () => {
    bedrockMock.handler = () => '```json\n{"response":"Fenced reply","confidence":0.6}\n```';
    const out = await generateResponse(ticket, articles);
    expect(out.response).toBe("Fenced reply");
    expect(out.confidence).toBe(0.6);
  });

  it("defaults confidence and cited articles from the knowledge base when the model omits them", async () => {
    bedrockMock.handler = () => JSON.stringify({ response: "No extras" });
    const withArticles = await generateResponse(ticket, articles);
    expect(withArticles.confidence).toBe(0.8);
    expect(withArticles.suggestedArticles).toEqual([7, 9]);

    const without = await generateResponse(ticket, []);
    expect(without.confidence).toBe(0.5);
    expect(without.suggestedArticles).toEqual([]);
  });

  it("falls back to the holding message, with confidence 0, when the reply is not JSON", async () => {
    bedrockMock.handler = () => "Sorry, I cannot help with that.";
    const out = await generateResponse(ticket, articles);
    expect(out).toMatchObject({ response: FALLBACK, confidence: 0, suggestedArticles: [] });
  });

  it("falls back the same way when the Bedrock call itself fails", async () => {
    bedrockMock.handler = () => new Error("ThrottlingException");
    const out = await generateResponse(ticket, articles);
    expect(out).toMatchObject({ response: FALLBACK, confidence: 0 });
  });
});
