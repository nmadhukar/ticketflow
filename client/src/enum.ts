/**
 * Enum types for user preferences and settings
 */

export type Theme = "light" | "dark" | "system";

export type Language = "en" | "es" | "fr" | "de" | "zh";

export type DateFormat =
  | "MM/DD/YYYY"
  | "DD/MM/YYYY"
  | "YYYY-MM-DD"
  | "DD MMM YYYY";

// Theme options array for UI
export const THEME_OPTIONS: Theme[] = ["light", "dark", "system"];

// Language options array for UI
export const LANGUAGE_OPTIONS: Language[] = ["en", "es", "fr", "de", "zh"];

// Date format options array for UI
export const DATE_FORMAT_OPTIONS: DateFormat[] = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "DD MMM YYYY",
];
