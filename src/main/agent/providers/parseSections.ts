// parseSections: map the model's labeled-section text back into structured
// sections keyed by the format's section keys. We parse locally (product 3.4) so
// no machine-parseable schema carrying patient text ever crosses the boundary.
//
// Strategy: for each expected section label, find its header line (case-insensitive,
// tolerant of a trailing colon) and take the text up to the next expected header.
// Anything we cannot locate falls back to empty, which the therapist then fills.

export function parseSectionsFromText(
  text: string,
  expected: { key: string; label: string }[]
): { key: string; label: string; body: string }[] {
  const lines = text.split('\n');

  // Precompute a matcher for each expected label.
  const labelMatchers = expected.map((s) => ({
    ...s,
    re: new RegExp(`^\\s*(?:#+\\s*)?\\*{0,2}${escapeRe(s.label)}\\*{0,2}\\s*:?\\s*$`, 'i'),
  }));

  // Find the line index where each section header appears.
  const headerAt = new Map<string, number>();
  lines.forEach((line, i) => {
    for (const m of labelMatchers) {
      if (!headerAt.has(m.key) && m.re.test(line)) headerAt.set(m.key, i);
    }
  });

  return expected.map((s, idx) => {
    const start = headerAt.get(s.key);
    if (start === undefined) {
      // Header not found. As a fallback, if there is exactly one section, return
      // the whole text; otherwise empty.
      return { key: s.key, label: s.label, body: expected.length === 1 ? text.trim() : '' };
    }
    // End at the next found header among later sections.
    let end = lines.length;
    for (let j = idx + 1; j < expected.length; j++) {
      const nextStart = headerAt.get(expected[j].key);
      if (nextStart !== undefined && nextStart > start) {
        end = nextStart;
        break;
      }
    }
    const body = lines
      .slice(start + 1, end)
      .join('\n')
      .trim();
    return { key: s.key, label: s.label, body };
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
