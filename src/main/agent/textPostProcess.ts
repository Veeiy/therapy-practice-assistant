// textPostProcess: F5 deterministic em-dash / en-dash removal for model output.
//
// Two halves of F5 work together:
//   1. The prompt library tells the model not to use em or en dashes (a soft
//      instruction the model can still violate).
//   2. This deterministic pass runs on EVERY piece of AI-drafted text before it
//      is shown or saved, and replaces any em/en dash that slipped through. This
//      is the guarantee; the prompt is the hint.
//
// Replacement rules (operator rule 7: no em dashes anywhere in user-facing text):
//   * em dash  (U+2014) between spaces  -> ", "  (clause break)
//   * em dash  (U+2014) tight           -> ", "
//   * en dash  (U+2013) between numbers -> " to " (range, e.g. "3 to 5")
//   * en dash  (U+2013) otherwise       -> "-" (hyphen)
//   * also normalizes the "horizontal bar" U+2015 and double-hyphen "--".

const EM_DASH = '—';
const EN_DASH = '–';
const HORIZONTAL_BAR = '―';

export function stripDashes(input: string): string {
  let s = input;

  // en dash used as a numeric range -> " to "
  s = s.replace(new RegExp(`(\\d)\\s*${EN_DASH}\\s*(\\d)`, 'g'), '$1 to $2');

  // em dash and horizontal bar -> comma + space (clause separator), collapsing
  // any surrounding spaces so we do not leave " , ".
  s = s.replace(new RegExp(`\\s*[${EM_DASH}${HORIZONTAL_BAR}]\\s*`, 'g'), ', ');

  // remaining en dashes -> hyphen
  s = s.replace(new RegExp(`\\s*${EN_DASH}\\s*`, 'g'), '-');

  // ascii double hyphen sometimes stands in for an em dash
  s = s.replace(/\s*--\s*/g, ', ');

  return s;
}

/** True if a string contains any dash character we prohibit. For test asserts. */
export function hasProhibitedDash(input: string): boolean {
  return new RegExp(`[${EM_DASH}${EN_DASH}${HORIZONTAL_BAR}]`).test(input);
}
