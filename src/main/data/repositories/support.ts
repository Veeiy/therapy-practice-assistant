// Shared repository support: a Clock + IdGen so services and tests are
// deterministic, plus tiny JSON helpers for the *_json columns.
//
// Injecting clock+id (rather than calling Date.now()/uuid() inline) is what lets
// the integration test assert exact ordering and stable ids.

import { v4 as uuidv4 } from 'uuid';

export interface Clock {
  nowIso(): string;
}
export interface IdGen {
  next(): string;
}

export const systemClock: Clock = { nowIso: () => new Date().toISOString() };
export const uuidGen: IdGen = { next: () => uuidv4() };

/** Parse a JSON text column to T, falling back to a default if null/empty. */
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Stringify a value for a *_json column. undefined/null -> SQL null. */
export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export const boolToInt = (b: boolean): 0 | 1 => (b ? 1 : 0);
export const intToBool = (n: number): boolean => n === 1;
