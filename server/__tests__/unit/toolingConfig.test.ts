/**
 * Guards for the build/test tooling itself, read as text because the jest
 * config and scripts/test-db.mjs are ES modules the CommonJS test runtime
 * cannot import.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("tooling config", () => {
  it("jest's ts transform pattern escapes the dot, so only .ts and .tsx files match", () => {
    const source = read("jest.config.mjs");
    const literal = /'(\^\.\+[^']*tsx\?\$)'/.exec(source)?.[1];
    expect(literal).toBeDefined();
    // The literal in the file is a JS string: "\\." there is "\." in the regex.
    const pattern = new RegExp(literal!.replace(/\\\\/g, "\\"));
    expect(pattern.test("a.ts")).toBe(true);
    expect(pattern.test("a.tsx")).toBe(true);
    // An unescaped dot would also match these.
    expect(pattern.test("atsx")).toBe(false);
    expect(pattern.test("a-ts")).toBe(false);
  });

  it("scripts/test-db.mjs and the integration env helper default to the same database URL", () => {
    const urlOf = (text: string) => /"(postgres:\/\/[^"]+)"/.exec(text)?.[1];
    const script = urlOf(read("scripts/test-db.mjs"));
    const helper = urlOf(read("server/__tests__/integration/helpers/env.ts"));
    expect(script).toBeDefined();
    expect(script).toBe(helper);
  });
});
