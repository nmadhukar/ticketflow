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
  if (!response || response.trim().length === 0) {
    return "";
  }

  // Step 1: Remove all markdown code block markers completely
  // This handles malformed blocks like "}  ```json" or "```json\n...\n```"
  let cleaned = response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Step 2: Find the first JSON object/array start
  // Handle leading whitespace by finding the first { or [
  const jsonStart = cleaned.search(/[{[]/);

  if (jsonStart === -1) {
    // No JSON found, return empty
    return "";
  }

  // Extract from the first JSON start
  cleaned = cleaned.substring(jsonStart);

  // Step 3: Extract the complete JSON object/array by counting braces/brackets
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

  return cleaned.trim();
}
