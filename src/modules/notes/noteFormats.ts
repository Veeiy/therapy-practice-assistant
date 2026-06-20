// noteFormats: the "one schema, three configs" rule made concrete (product 3.3).
//
// SOAP / DAP / BIRP are THREE CONFIGS over the ONE note schema, not three schemas.
// Each config is an ordered list of {key, label}. The composer renders sections
// by reading this list; drafting, editing, signing, locking, and addenda are all
// format-agnostic. Adding a fourth format (GIRP, PIRP, a custom house format) is
// a config entry here, not new code or a migration.
//
// This file is the DEFAULT config. The config store (config-driven extensibility)
// can override or extend it at runtime without a rebuild.

import type { NoteFormat, NoteSection } from '@shared/types/domain.js';

export interface FormatSection {
  key: string;
  label: string;
}

export const NOTE_FORMATS: Record<NoteFormat, FormatSection[]> = {
  SOAP: [
    { key: 'subjective', label: 'Subjective' },
    { key: 'objective', label: 'Objective' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'plan', label: 'Plan' },
  ],
  DAP: [
    { key: 'data', label: 'Data' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'plan', label: 'Plan' },
  ],
  BIRP: [
    { key: 'behavior', label: 'Behavior' },
    { key: 'intervention', label: 'Intervention' },
    { key: 'response', label: 'Response' },
    { key: 'plan', label: 'Plan' },
  ],
};

/** Build empty sections for a format (used when creating a fresh draft). */
export function emptySectionsFor(format: NoteFormat): NoteSection[] {
  return NOTE_FORMATS[format].map((s) => ({ key: s.key, label: s.label, body: '' }));
}
