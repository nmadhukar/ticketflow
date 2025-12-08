/**
 * JSON Utility Functions
 *
 * Helper functions for processing JSON responses from AI models
 */

/**
 * Extract JSON from response, handling markdown code blocks
 * Some models wrap JSON in ```json ... ``` blocks
 *
 * @param response - The raw response string that may contain JSON wrapped in markdown
 * @returns Clean JSON string ready for parsing
 */
export function extractJSON(response: string): string {
  // Remove markdown code blocks if present
  let cleaned = response.trim();

  // First, try to match complete code blocks (```json ... ``` or ``` ... ```)
  // This regex matches code blocks that may have text before/after
  // Use global flag to find all matches, then use the one with actual content
  const codeBlockRegex = /```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/g;
  const matches = Array.from(cleaned.matchAll(codeBlockRegex));

  let match: RegExpMatchArray | null = null;
  if (matches.length > 0) {
    // If multiple code blocks, find the one with the most non-empty content
    // This handles nested code blocks by selecting the innermost/actual content
    match = matches.reduce((best, current) => {
      const bestContent = best[1]?.trim() || "";
      const currentContent = current[1]?.trim() || "";

      // Prefer content that looks like JSON (starts with { or [)
      const bestIsJson =
        bestContent.startsWith("{") || bestContent.startsWith("[");
      const currentIsJson =
        currentContent.startsWith("{") || currentContent.startsWith("[");

      if (currentIsJson && !bestIsJson) return current;
      if (bestIsJson && !currentIsJson) return best;

      // If both or neither are JSON-like, prefer longer content
      return currentContent.length > bestContent.length ? current : best;
    });
  }

  if (match) {
    // Extract content from the code block
    let extracted = match[1].trim();

    // If the extracted content itself contains code blocks, recurse
    if (extracted.includes("```")) {
      extracted = extractJSON(extracted);
    }

    cleaned = extracted;
  } else {
    // If no complete code block found, try to remove partial markdown formatting
    // Remove any leading/trailing markdown formatting
    cleaned = cleaned
      .replace(/^```[a-z]*\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "");
  }

  // After extraction, try to find JSON object/array boundaries
  // This helps when there's text before/after the JSON in the code block
  const jsonStart = cleaned.indexOf("{");
  const jsonArrayStart = cleaned.indexOf("[");

  let jsonStartIndex = -1;
  if (jsonStart !== -1 && jsonArrayStart !== -1) {
    // Both found, use the earlier one
    jsonStartIndex = Math.min(jsonStart, jsonArrayStart);
  } else if (jsonStart !== -1) {
    jsonStartIndex = jsonStart;
  } else if (jsonArrayStart !== -1) {
    jsonStartIndex = jsonArrayStart;
  }

  // Always extract from JSON start if found (even if at position 0)
  if (jsonStartIndex !== -1) {
    // There's text before the JSON, extract from JSON start
    cleaned = cleaned.substring(jsonStartIndex);
  }

  // Find the matching closing brace/bracket to extract only the JSON part
  if (jsonStartIndex !== -1) {
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEndIndex = -1;

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0 && bracketCount === 0) {
          jsonEndIndex = i + 1;
          break;
        }
      } else if (char === "[") {
        bracketCount++;
      } else if (char === "]") {
        bracketCount--;
        if (braceCount === 0 && bracketCount === 0) {
          jsonEndIndex = i + 1;
          break;
        }
      }
    }

    if (jsonEndIndex > 0) {
      cleaned = cleaned.substring(0, jsonEndIndex);
    }
  }

  return cleaned.trim();
}
