export function toConfidencePercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;

  let v = value;

  // If it looks like a 0–1 float, scale to 0–100
  if (v <= 1) v = v * 100;

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, v));
}
