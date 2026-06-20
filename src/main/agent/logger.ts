// logger: F4 logging hygiene.
//
// The single rule: events and IDs, never content. No PHI, no shorthand, no draft
// text, no prompt bodies, no model responses are EVER passed to this logger. The
// type signature makes that hard to violate: you log an event name plus a small
// record of scalar metadata (numbers, ids, enums), not free strings of content.
//
// A second guard (scrubLine) strips anything that looks like an obvious
// identifier from a message before it is written, as defense in depth for the
// rare case where an upstream error string carries a stray identifier. This is
// the same posture the audit gate's Issue 4 requires: stderr/log capture must
// strip or never persist request/response content, not merely aspire to it.

export type LogMeta = Record<string, string | number | boolean | null | undefined>;

/** Patterns for obvious identifiers; used to scrub any free message text. */
const SCRUB_PATTERNS: { re: RegExp; tag: string }[] = [
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, tag: '[email]' },
  { re: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, tag: '[phone]' }, // US phone-ish
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, tag: '[ssn]' },
];

/** Strip obvious identifiers from a message string before logging. */
export function scrubLine(line: string): string {
  let out = line;
  for (const { re, tag } of SCRUB_PATTERNS) out = out.replace(re, tag);
  return out;
}

export interface Logger {
  event(name: string, meta?: LogMeta): void;
  /** Log an error by name/code + scrubbed message. Never pass body/prompt text. */
  error(name: string, message: string, meta?: LogMeta): void;
}

function fmt(meta?: LogMeta): string {
  if (!meta) return '';
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

/** Default console logger. In the Electron main process this can be swapped for a
 * file-rotating logger; the contract (no content) is identical. */
export const consoleLogger: Logger = {
  event(name, meta) {
    // eslint-disable-next-line no-console
    console.log(`[event] ${name}${fmt(meta)}`);
  },
  error(name, message, meta) {
    // eslint-disable-next-line no-console
    console.error(`[error] ${name}: ${scrubLine(message)}${fmt(meta)}`);
  },
};

/** A silent logger for tests, so test output stays clean. */
export const silentLogger: Logger = {
  event() {
    /* no-op */
  },
  error() {
    /* no-op */
  },
};
