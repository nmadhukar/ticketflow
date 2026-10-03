function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex
    .replace("#", "")
    .match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// WCAG relative luminance
function luminance({ r, g, b }: { r: number; g: number; b: number }) {
  const srgb = [r, g, b]
    .map((v) => v / 255)
    .map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function getReadableForeground(hex: string): "#000" | "#fff" {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#fff";
  const L = luminance(rgb);
  return L > 0.5 ? "#000" : "#fff";
}

export function mix(hex: string, withHex: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  if (!a || !b) return hex;
  const t = clamp01(amount);
  const r = Math.round(a.r * (1 - t) + b.r * t);
  const g = Math.round(a.g * (1 - t) + b.g * t);
  const bl = Math.round(a.b * (1 - t) + b.b * t);
  return rgbToHex(r, g, bl);
}

export function deriveHover(hex: string, isDark: boolean): string {
  // Darken in light mode, lighten in dark mode
  return isDark ? mix(hex, "#ffffff", 0.08) : mix(hex, "#000000", 0.12);
}

export function setThemeFromPrimary(primaryHex: string) {
  if (!primaryHex || !/^#?[0-9a-fA-F]{6}$/.test(primaryHex)) return;
  const hex = primaryHex.startsWith("#") ? primaryHex : `#${primaryHex}`;
  const fg = getReadableForeground(hex);
  const isDark = document.documentElement.classList.contains("dark");
  const hover = deriveHover(hex, isDark);
  const root = document.documentElement;
  root.style.setProperty("--primary", hex);
  root.style.setProperty("--ring", hex);
  root.style.setProperty("--primary-foreground", fg);
  root.style.setProperty("--primary-hover", hover);
  // derive accent as a subtle tint of primary on light surfaces
  const accent = mix(hex, isDark ? "#000000" : "#ffffff", 0.9);
  const accentFg = getReadableForeground(accent);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-foreground", accentFg);
}
