// SchemaForm: a REUSABLE, config-driven form. It renders inputs from a list of
// FormFieldDef (the same shape config stores under intake.fields) and reports the
// collected values back by field key. It hard-codes NO field: change the field list
// in config and this component renders the new form with no code change. That is the
// renderer half of hard rule 6 (the service half lives in intakeService).
//
// It is intentionally generic (intake uses it first, but any future config-driven
// form can reuse it). It holds only the in-progress values in local state; it has no
// API knowledge and no PHI logic. The parent decides what to do on submit.

import React, { useRef, useState } from 'react';
import type { FormFieldDef } from '../../shared/types/module.js';

export interface SchemaFormProps {
  fields: FormFieldDef[];
  /** initial values keyed by field key (optional; defaults to empty). */
  initial?: Record<string, unknown>;
  submitLabel?: string;
  busy?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}

function defaultFor(field: FormFieldDef): unknown {
  return field.type === 'boolean' ? false : '';
}

// A required field is empty when it is a blank string or an unchecked boolean.
function isEmpty(field: FormFieldDef, value: unknown): boolean {
  if (field.type === 'boolean') return value !== true;
  return value === undefined || value === null || String(value).trim() === '';
}

export function SchemaForm(props: SchemaFormProps): React.ReactElement {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const f of props.fields) {
      seed[f.key] = props.initial?.[f.key] ?? defaultFor(f);
    }
    return seed;
  });
  // B1: per-field validation errors, keyed by field key. A field appears here only
  // after a failed submit; clearing the field removes its error on the next submit.
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Refs to focusable controls so we can move focus to the first invalid field.
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const set = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear a field's error as soon as the user gives it a value.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // B1: validate required fields. On failure, mark fields invalid, link each to
    // its error message, and move focus to the first invalid control.
    const found: Record<string, string> = {};
    for (const f of props.fields) {
      if (f.required && isEmpty(f, values[f.key])) {
        found[f.key] = `${f.label} is required.`;
      }
    }
    setErrors(found);
    const firstInvalid = props.fields.find((f) => found[f.key]);
    if (firstInvalid) {
      fieldRefs.current[firstInvalid.key]?.focus();
      return;
    }
    props.onSubmit(values);
  };

  return (
    <form className="schema-form" onSubmit={submit} noValidate>
      {props.fields.map((f) => {
        const err = errors[f.key];
        const errId = `${f.key}-error`;
        // aria-describedby links the control to its hint and/or its error message.
        const describedBy = [f.hint ? `${f.key}-hint` : null, err ? errId : null]
          .filter(Boolean)
          .join(' ');
        const aria = {
          'aria-invalid': err ? (true as const) : undefined,
          'aria-describedby': describedBy || undefined,
        };
        return (
          <div key={f.key} className="schema-field">
            {f.type === 'boolean' ? (
              <label className="checkbox">
                <input
                  type="checkbox"
                  ref={(el) => (fieldRefs.current[f.key] = el)}
                  checked={Boolean(values[f.key])}
                  onChange={(e) => set(f.key, e.target.checked)}
                  {...aria}
                />
                <span>{f.label}</span>
              </label>
            ) : (
              <label>
                <span className="field-label">
                  {f.label}
                  {f.required && <span className="req"> *</span>}
                </span>
                {f.type === 'multiline' ? (
                  <textarea
                    rows={3}
                    ref={(el) => (fieldRefs.current[f.key] = el)}
                    value={String(values[f.key] ?? '')}
                    onChange={(e) => set(f.key, e.target.value)}
                    {...aria}
                  />
                ) : f.type === 'select' ? (
                  <select
                    ref={(el) => (fieldRefs.current[f.key] = el)}
                    value={String(values[f.key] ?? '')}
                    onChange={(e) => set(f.key, e.target.value)}
                    {...aria}
                  >
                    <option value="">Select...</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : 'text'}
                    ref={(el) => (fieldRefs.current[f.key] = el)}
                    value={String(values[f.key] ?? '')}
                    onChange={(e) => set(f.key, e.target.value)}
                    {...aria}
                  />
                )}
              </label>
            )}
            {f.hint && (
              <p id={`${f.key}-hint`} className="field-hint muted">
                {f.hint}
              </p>
            )}
            {err && (
              <p id={errId} className="field-error" role="alert">
                {err}
              </p>
            )}
          </div>
        );
      })}
      <button className="primary" type="submit" disabled={props.busy} aria-busy={props.busy}>
        {props.submitLabel ?? 'Save'}
      </button>
    </form>
  );
}
