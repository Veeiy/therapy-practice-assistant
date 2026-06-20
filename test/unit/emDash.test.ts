// TEST: the em-dash / en-dash post-processor (F5, operator rule 7).
//
// F5 has two halves: the prompt asks the model not to use em/en dashes, and this
// DETERMINISTIC pass is the guarantee that runs on every drafted/edited string
// before it is shown or saved. We prove the guarantee, not the hint:
//  (a) em dashes (spaced and tight) become a comma + space,
//  (b) en dashes between numbers become " to " (a range),
//  (c) en dashes elsewhere become a hyphen,
//  (d) the horizontal bar and the ascii "--" stand-in are also handled,
//  (e) after processing, hasProhibitedDash() is false for any mix of these,
//  (f) ordinary text and real hyphens are left intact (no over-eager rewriting).

import { describe, it, expect } from 'vitest';
import { stripDashes, hasProhibitedDash } from '../../src/main/agent/textPostProcess.js';

const EM = '—'; // —
const EN = '–'; // –
const BAR = '―'; // ―

describe('stripDashes (F5)', () => {
  it('(a) replaces spaced and tight em dashes with a comma + space', () => {
    expect(stripDashes(`the client was calm ${EM} then tearful`)).toBe(
      'the client was calm, then tearful'
    );
    expect(stripDashes(`calm${EM}then tearful`)).toBe('calm, then tearful');
  });

  it('(b) turns an en dash between numbers into a range " to "', () => {
    expect(stripDashes(`sessions 3${EN}5 were missed`)).toBe('sessions 3 to 5 were missed');
    expect(stripDashes(`rated 7 ${EN} 8 on the scale`)).toBe('rated 7 to 8 on the scale');
  });

  it('(c) turns a non-numeric en dash into a hyphen', () => {
    expect(stripDashes(`pre ${EN} post comparison`)).toBe('pre-post comparison');
  });

  it('(d) handles the horizontal bar and the ascii double-hyphen', () => {
    expect(stripDashes(`one ${BAR} two`)).toBe('one, two');
    expect(stripDashes('one -- two')).toBe('one, two');
  });

  it('(e) leaves NO prohibited dash behind for an arbitrary mix', () => {
    const messy = `Mood ${EM} anxious; sleep 4${EN}6 hrs; pre ${EN} post review ${BAR} ongoing -- stable.`;
    const cleaned = stripDashes(messy);
    expect(hasProhibitedDash(cleaned)).toBe(false);
    expect(cleaned).not.toContain(EM);
    expect(cleaned).not.toContain(EN);
    expect(cleaned).not.toContain(BAR);
  });

  it('(f) leaves ordinary text and genuine hyphens untouched', () => {
    const plain = 'A well-rested, self-aware client made follow-up plans.';
    expect(stripDashes(plain)).toBe(plain);
    expect(hasProhibitedDash(plain)).toBe(false);
  });

  it('hasProhibitedDash detects each prohibited character', () => {
    expect(hasProhibitedDash(`a${EM}b`)).toBe(true);
    expect(hasProhibitedDash(`a${EN}b`)).toBe(true);
    expect(hasProhibitedDash(`a${BAR}b`)).toBe(true);
    expect(hasProhibitedDash('a-b')).toBe(false);
  });
});
