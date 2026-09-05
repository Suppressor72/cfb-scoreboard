/** ESPN ships colors like "FF7300" — CSS needs "#FF7300". */
export function normalizeHex(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  return `#${m[1].toLowerCase()}`;
}

/** WCAG-ish contrast pick for text on team-brand-colored blocks. */
export function textColorFor(hex: string | undefined): string {
  if (!hex) return "#e8eaed";
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#e8eaed";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const channel = (start: number): number =>
    parseInt(h.slice(start, start + 2), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2;
  const L =
    0.2126 * lin(channel(0)) + 0.7152 * lin(channel(2)) + 0.0722 * lin(channel(4));
  return L > 0.35 ? "#14161a" : "#f2f4f7";
}
