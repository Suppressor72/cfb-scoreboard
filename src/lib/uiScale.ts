/**
 * Reads the CSS UI scale factor (`--s`, set by viewport media queries in
 * styles.css) so JS-computed grid dimensions match the scaled CSS geometry.
 * Returns 1 when unavailable (SSR/tests).
 */
export function uiScale(): number {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return 1;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--s");
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
