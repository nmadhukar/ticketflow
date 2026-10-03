import request from "supertest";
import type { Express } from "express";
import type { User } from "@shared/schema";
import { issueApiKey } from "../../../services/auth/apiKeys";

let ip = 10;

export interface McpResult {
  isError: boolean;
  data: any;
  raw: string;
}

/** Calls one MCP tool over POST /api/mcp with a bearer key (omit the key for no credential). */
export async function callTool(
  app: Express,
  key: string | undefined,
  name: string,
  args: object
): Promise<McpResult & { status: number }> {
  const r = request(app)
    .post("/api/mcp")
    .set("X-Forwarded-For", `203.0.113.${(++ip % 250) + 1}`)
    .set("Accept", "application/json, text/event-stream");
  const res = await (key ? r.set("Authorization", `Bearer ${key}`) : r).send({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (res.status !== 200) return { status: res.status, isError: true, data: res.body, raw: res.text };
  const text = res.body.result.content[0].text as string;
  return { status: 200, isError: !!res.body.result.isError, data: JSON.parse(text), raw: text };
}

/** An API key for the user plus a bound caller. */
export async function mcpFor(app: Express, user: User) {
  const { plaintext } = await issueApiKey({ userId: user.id, name: "mcp-test" });
  return {
    key: plaintext,
    call: (name: string, args: object = {}) => callTool(app, plaintext, name, args),
  };
}

export type McpCaller = Awaited<ReturnType<typeof mcpFor>>;
