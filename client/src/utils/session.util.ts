/**
 * Utility functions for session management
 */

/**
 * Formats a date to a localized string
 * @param date - Date object or date string
 * @returns Formatted date string
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Extracts device type from user agent string
 * @param userAgent - User agent string from browser
 * @returns Device type description
 */
export function getDeviceInfo(userAgent?: string): string {
  if (!userAgent) return "Unknown device";
  if (userAgent.includes("Mobile")) return "Mobile device";
  if (userAgent.includes("Tablet")) return "Tablet";
  return "Desktop";
}
