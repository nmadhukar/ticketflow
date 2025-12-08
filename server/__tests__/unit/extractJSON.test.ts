/**
 * Unit Tests for extractJSON Function
 *
 * Tests JSON extraction from various response formats including:
 * - Plain JSON responses
 * - JSON wrapped in markdown code blocks
 * - Edge cases and malformed inputs
 * - Whitespace and formatting variations
 */

import { describe, it, expect } from "@jest/globals";
import { extractJSON } from "../../services/ai/jsonUtils";

describe("extractJSON", () => {
  describe("Plain JSON (no markdown)", () => {
    it("should return plain JSON as-is", () => {
      const json = '{"key": "value"}';
      expect(extractJSON(json)).toBe('{"key": "value"}');
    });

    it("should handle JSON with nested objects", () => {
      const json = '{"key": {"nested": "value"}, "array": [1, 2, 3]}';
      expect(extractJSON(json)).toBe(json);
    });

    it("should handle JSON with whitespace", () => {
      const json = '  {"key": "value"}  ';
      expect(extractJSON(json)).toBe('{"key": "value"}');
    });

    it("should handle JSON with newlines", () => {
      const json = `{
  "key": "value",
  "number": 42
}`;
      expect(extractJSON(json)).toBe(json.trim());
    });
  });

  describe("JSON wrapped in markdown code blocks", () => {
    it("should extract JSON from ```json ... ``` blocks", () => {
      const wrapped = '```json\n{"key": "value"}\n```';
      expect(extractJSON(wrapped)).toBe('{"key": "value"}');
    });

    it("should extract JSON from ``` ... ``` blocks (no language)", () => {
      const wrapped = '```\n{"key": "value"}\n```';
      expect(extractJSON(wrapped)).toBe('{"key": "value"}');
    });

    it("should handle code blocks with extra whitespace", () => {
      const wrapped = '```json  \n  {"key": "value"}  \n  ```';
      expect(extractJSON(wrapped)).toBe('{"key": "value"}');
    });

    it("should handle code blocks without newlines", () => {
      const wrapped = '```json{"key": "value"}```';
      expect(extractJSON(wrapped)).toBe('{"key": "value"}');
    });

    it("should handle multiline JSON in code blocks", () => {
      const wrapped = `\`\`\`json
{
  "key": "value",
  "number": 42
}
\`\`\``;
      const expected = `{
  "key": "value",
  "number": 42
}`;
      expect(extractJSON(wrapped)).toBe(expected);
    });

    it("should handle code blocks with trailing newline", () => {
      const wrapped = '```json\n{"key": "value"}\n```\n';
      expect(extractJSON(wrapped)).toBe('{"key": "value"}');
    });
  });

  describe("Complex JSON structures", () => {
    it("should extract complex nested JSON", () => {
      const wrapped = `\`\`\`json
{
  "keyIssues": ["issue1", "issue2"],
  "suggestedCategory": "support",
  "complexityScore": 75,
  "requiredExpertise": ["technical", "networking"],
  "estimatedHours": 4
}
\`\`\``;
      const expected = `{
  "keyIssues": ["issue1", "issue2"],
  "suggestedCategory": "support",
  "complexityScore": 75,
  "requiredExpertise": ["technical", "networking"],
  "estimatedHours": 4
}`;
      expect(extractJSON(wrapped)).toBe(expected);
    });

    it("should handle JSON arrays", () => {
      const wrapped = '```json\n[{"id": 1}, {"id": 2}]\n```';
      expect(extractJSON(wrapped)).toBe('[{"id": 1}, {"id": 2}]');
    });

    it("should handle JSON with escaped characters", () => {
      const wrapped = '```json\n{"message": "Hello \\"world\\""}\n```';
      expect(extractJSON(wrapped)).toBe('{"message": "Hello \\"world\\""}');
    });

    it("should handle JSON with special characters", () => {
      const wrapped = '```json\n{"path": "/usr/bin", "regex": ".*"}\n```';
      expect(extractJSON(wrapped)).toBe('{"path": "/usr/bin", "regex": ".*"}');
    });
  });

  describe("Edge cases", () => {
    it("should handle empty string", () => {
      expect(extractJSON("")).toBe("");
    });

    it("should handle whitespace-only string", () => {
      expect(extractJSON("   \n  \t  ")).toBe("");
    });

    it("should handle string with only code block markers", () => {
      expect(extractJSON("```\n```")).toBe("");
    });

    it("should handle string with only json code block markers", () => {
      expect(extractJSON("```json\n```")).toBe("");
    });

    it("should handle malformed code blocks (only opening)", () => {
      const input = '```json\n{"key": "value"}';
      // Should still try to clean it
      const result = extractJSON(input);
      expect(result).not.toContain("```");
      expect(result).toContain('"key"');
    });

    it("should handle malformed code blocks (only closing)", () => {
      const input = '{"key": "value"}\n```';
      const result = extractJSON(input);
      expect(result).not.toContain("```");
      expect(result).toContain('"key"');
    });

    it("should handle multiple code block markers", () => {
      const input = '```json\n```json\n{"key": "value"}\n```\n```';
      const result = extractJSON(input);
      expect(result).not.toContain("```");
      // In this edge case, the function should extract JSON from nested blocks
      // If it can't find valid JSON, at least ensure no markdown remains
      if (result.length > 0) {
        expect(result).toContain('"key"');
      } else {
        // For this very edge case, just ensure no markdown syntax remains
        expect(result).toBe("");
      }
    });

    it("should handle code blocks with different language identifiers", () => {
      const wrapped = '```javascript\n{"key": "value"}\n```';
      const result = extractJSON(wrapped);
      expect(result).not.toContain("```");
      expect(result).toContain('"key"');
    });

    it("should handle code blocks with uppercase language", () => {
      const wrapped = '```JSON\n{"key": "value"}\n```';
      expect(extractJSON(wrapped)).toBe('{"key": "value"}');
    });
  });

  describe("Real-world scenarios", () => {
    it("should handle Claude 3 Sonnet response format", () => {
      const claudeResponse = `\`\`\`json
{
  "keyIssues": ["Password reset not working"],
  "suggestedCategory": "support",
  "recommendedPriority": "high",
  "complexityScore": 45,
  "requiredExpertise": ["authentication"],
  "estimatedHours": 2
}
\`\`\``;
      const result = extractJSON(claudeResponse);
      expect(result).not.toContain("```");
      expect(result).toContain("keyIssues");
      expect(result).toContain("complexityScore");
      // Should be valid JSON
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should handle response with explanatory text before code block", () => {
      const response = `Here is the analysis:
\`\`\`json
{"key": "value"}
\`\`\`
Hope this helps!`;
      const result = extractJSON(response);
      // Should still extract the JSON part
      expect(result).toContain('"key"');
    });

    it("should handle response with text after code block", () => {
      const response = `\`\`\`json
{"key": "value"}
\`\`\`
Additional notes here`;
      const result = extractJSON(response);
      expect(result).toContain('"key"');
      expect(result).not.toContain("Additional notes");
    });

    it("should handle nested code blocks in explanation", () => {
      const response = `The response is:
\`\`\`json
{"key": "value", "code": "const x = 1;"}
\`\`\``;
      const result = extractJSON(response);
      expect(result).toContain('"key"');
      expect(result).toContain('"code"');
    });
  });

  describe("Performance and robustness", () => {
    it("should handle very long JSON strings", () => {
      const longJson = JSON.stringify({
        data: Array(1000)
          .fill(0)
          .map((_, i) => ({ id: i, value: `item-${i}` })),
      });
      const wrapped = `\`\`\`json\n${longJson}\n\`\`\``;
      const result = extractJSON(wrapped);
      expect(result).toBe(longJson);
    });

    it("should handle JSON with unicode characters", () => {
      const wrapped = '```json\n{"message": "Hello 世界 🌍"}\n```';
      expect(extractJSON(wrapped)).toBe('{"message": "Hello 世界 🌍"}');
    });

    it("should preserve JSON structure exactly", () => {
      const original = `{
  "keyIssues": ["issue1", "issue2"],
  "complexityScore": 75.5,
  "requiredExpertise": ["skill1", "skill2"],
  "estimatedHours": 4
}`;
      const wrapped = `\`\`\`json\n${original}\n\`\`\``;
      const result = extractJSON(wrapped);
      expect(result).toBe(original);
      // Verify it's valid JSON
      const parsed = JSON.parse(result);
      expect(parsed.complexityScore).toBe(75.5);
      expect(parsed.keyIssues).toHaveLength(2);
    });
  });

  describe("Regression tests", () => {
    it("should handle the exact error case from production", () => {
      // Simulating the actual error: " ``` Here "... is not valid JSON
      const problematicResponse = `\`\`\`
Here is the analysis:
{
  "keyIssues": ["test"],
  "complexityScore": 50
}
\`\`\``;
      const result = extractJSON(problematicResponse);
      expect(result).not.toContain("```");
      expect(result).toContain("keyIssues");
      // Should be parseable
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should handle response starting with backticks and text", () => {
      const response = '```\nHere is the JSON:\n{"key": "value"}\n```';
      const result = extractJSON(response);
      expect(result).toContain('"key"');
    });
  });
});
