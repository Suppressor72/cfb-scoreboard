/**
 * ESPN-style team metadata line: overall record, conference record, and
 * designated conference — e.g. "(2-0, 1-0 SEC)". Missing pieces drop out.
 */
export function teamMeta(t: {
  record?: string;
  conferenceRecord?: string;
  conference?: string;
}): string | undefined {
  const records = [t.record, t.conferenceRecord].filter(
    (r): r is string => r !== undefined,
  );
  if (records.length === 0 && !t.conference) return undefined;
  const left = records.length > 0 ? records.join(", ") : "";
  return `(${[left, t.conference].filter(Boolean).join(" ")})`;
}
