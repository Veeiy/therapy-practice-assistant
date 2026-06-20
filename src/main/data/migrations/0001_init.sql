-- 0001_init.sql
-- The FULL canonical v1 schema. Source of truth: product-workflow.md SECTION 4,
-- declared canonical by the audit gate (fix F3). This single file declares every
-- table, including the three whose UIs come next wave (treatment_plan,
-- treatment_plan_goal, intake_record) so their schema is committed now (F3).
--
-- Conventions:
--  * ids are TEXT uuids (clean for a future multi-tenant merge; blueprint scaling).
--  * timestamps are ISO-8601 TEXT.
--  * money is INTEGER cents (no float drift).
--  * booleans are INTEGER 0/1.
--  * demo INTEGER 0/1 marks obviously fictional seed records (hard rule 4).
--  * PHI free-text lives only in body/value columns, never in a column name/enum.

PRAGMA foreign_keys = ON;

-- ── client ────────────────────────────────────────────────────────────────────
CREATE TABLE client (
  id                        TEXT PRIMARY KEY,
  legal_first_name          TEXT NOT NULL,
  legal_last_name           TEXT NOT NULL,
  preferred_name            TEXT,
  pronouns                  TEXT,
  date_of_birth             TEXT,
  email                     TEXT,
  phone                     TEXT,
  preferred_contact_method  TEXT NOT NULL DEFAULT 'none'
                              CHECK (preferred_contact_method IN ('email','phone','none')),
  address_json              TEXT,                    -- JSON {street,city,state,postal}
  emergency_contact_json    TEXT,                    -- JSON {name,relationship,phone}
  presenting_concern        TEXT,                    -- PHI free-text
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','inactive')),
  consent_on_file           INTEGER NOT NULL DEFAULT 0 CHECK (consent_on_file IN (0,1)),
  consent_date              TEXT,
  custom_fields_json        TEXT NOT NULL DEFAULT '{}',
  demo                      INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

-- ── provider_profile (single row in v1, modeled as a table) ───────────────────
CREATE TABLE provider_profile (
  id                 TEXT PRIMARY KEY,
  legal_name         TEXT NOT NULL DEFAULT '',
  credential         TEXT NOT NULL DEFAULT '',
  license_number     TEXT NOT NULL DEFAULT '',
  license_state      TEXT NOT NULL DEFAULT '',
  npi                TEXT NOT NULL DEFAULT '',       -- she enters; app never generates
  tax_id             TEXT NOT NULL DEFAULT '',       -- she enters
  practice_address_json TEXT,
  signature_display  TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- ── code_item (user-maintained CPT/ICD-10/POS picklist; F3 FK target) ─────────
-- Codes are an FK picklist, NOT free-text strings on the note/invoice (F3).
CREATE TABLE code_item (
  id          TEXT PRIMARY KEY,
  code_type   TEXT NOT NULL CHECK (code_type IN ('CPT','ICD10','POS')),
  code        TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  demo        INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ── appointment ───────────────────────────────────────────────────────────────
CREATE TABLE appointment (
  id                 TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL REFERENCES client(id),
  starts_at          TEXT NOT NULL,
  duration_minutes   INTEGER NOT NULL DEFAULT 50,
  modality           TEXT NOT NULL DEFAULT 'in_person'
                       CHECK (modality IN ('in_person','telehealth')),
  location           TEXT,
  telehealth_link    TEXT,
  service_type       TEXT,
  status             TEXT NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled','confirmed','completed','no_show',
                                         'cancelled_by_client','cancelled_by_clinician')),
  recurrence_rule    TEXT,                            -- RRULE
  fee_flag           INTEGER NOT NULL DEFAULT 0 CHECK (fee_flag IN (0,1)),
  -- F4: denormalized reminder status mirrors the normalized reminder table's
  -- latest state for this appointment. Enum aligned with reminder.status plus the
  -- 'none'/'scheduled' app-level states.
  reminder_status    TEXT NOT NULL DEFAULT 'none'
                       CHECK (reminder_status IN ('none','scheduled','sent','failed')),
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  demo               INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_appointment_client ON appointment(client_id);
CREATE INDEX idx_appointment_starts ON appointment(starts_at);

-- ── reminder (F4: ONE canonical normalized model, email-only v1) ──────────────
CREATE TABLE reminder (
  id              TEXT PRIMARY KEY,
  appointment_id  TEXT NOT NULL REFERENCES appointment(id),
  channel         TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  send_at         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','sent','failed')),
  template_id     TEXT NOT NULL DEFAULT 'default_email',
  last_error      TEXT,
  demo            INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_reminder_appointment ON reminder(appointment_id);

-- ── treatment_plan + treatment_plan_goal (F3: declared now, UI next wave) ─────
CREATE TABLE treatment_plan (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES client(id),
  title       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','completed','archived')),
  demo        INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_plan_client ON treatment_plan(client_id);

CREATE TABLE treatment_plan_goal (
  id                 TEXT PRIMARY KEY,
  treatment_plan_id  TEXT NOT NULL REFERENCES treatment_plan(id),
  goal_text          TEXT NOT NULL,                  -- PHI free-text
  target_date        TEXT,
  status             TEXT NOT NULL DEFAULT 'not_started'
                       CHECK (status IN ('not_started','in_progress','met','discontinued')),
  demo               INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_goal_plan ON treatment_plan_goal(treatment_plan_id);

-- ── intake_record (F3: declared now, UI next wave) ────────────────────────────
CREATE TABLE intake_record (
  id                         TEXT PRIMARY KEY,
  client_id                  TEXT NOT NULL REFERENCES client(id),
  prior_therapy              TEXT,                    -- PHI free-text
  hospitalizations           TEXT,
  current_medications        TEXT,
  substance_use              TEXT,
  family_mh_history          TEXT,
  insurance_json             TEXT,                    -- JSON {carrier,member_id,group,subscriber}
  consent_acknowledged       INTEGER NOT NULL DEFAULT 0 CHECK (consent_acknowledged IN (0,1)),
  consent_acknowledged_date  TEXT,
  custom_fields_json         TEXT NOT NULL DEFAULT '{}',
  demo                       INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);
CREATE INDEX idx_intake_client ON intake_record(client_id);

-- ── note (the centerpiece) ────────────────────────────────────────────────────
-- F2: 'status' is the ONE canonical lock predicate. A note is immutable iff
--     status = 'signed'. There is NO separate locked column. The trigger below
--     and the application sign-transition both key on status = 'signed'.
-- F3: includes shorthand_input and ai_assisted; diagnosis is an FK to code_item.
CREATE TABLE note (
  id                      TEXT PRIMARY KEY,
  client_id               TEXT NOT NULL REFERENCES client(id),
  appointment_id          TEXT REFERENCES appointment(id),
  treatment_plan_goal_id  TEXT REFERENCES treatment_plan_goal(id),
  diagnosis_code_id       TEXT REFERENCES code_item(id),   -- FK picklist, never free text
  format                  TEXT NOT NULL CHECK (format IN ('SOAP','DAP','BIRP')),
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed')),
  date_of_service         TEXT,
  session_start           TEXT,                            -- HH:MM
  duration_minutes        INTEGER,
  modality                TEXT CHECK (modality IN ('in_person','telehealth')),
  place_of_service_code   TEXT,
  sections_json           TEXT NOT NULL DEFAULT '[]',      -- [{key,label,body}]; PHI in body
  shorthand_input         TEXT,                            -- F3: PHI; retained locally
  ai_assisted             INTEGER NOT NULL DEFAULT 0 CHECK (ai_assisted IN (0,1)), -- F3
  signed_by               TEXT,
  signed_at               TEXT,
  demo                    INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX idx_note_client ON note(client_id);
CREATE INDEX idx_note_status ON note(status);

-- F2: storage-level immutability bound to the ONE canonical predicate.
-- Once status = 'signed', the row can never be UPDATEd or DELETEd. The trigger
-- predicate (OLD.status = 'signed') is the SAME column the application checks and
-- the sign transition writes. Corrections go only through note_addendum inserts.
CREATE TRIGGER trg_note_no_update_when_signed
BEFORE UPDATE ON note
FOR EACH ROW
WHEN OLD.status = 'signed'
BEGIN
  SELECT RAISE(ABORT, 'signed note is immutable');
END;

CREATE TRIGGER trg_note_no_delete_when_signed
BEFORE DELETE ON note
FOR EACH ROW
WHEN OLD.status = 'signed'
BEGIN
  SELECT RAISE(ABORT, 'signed note is immutable');
END;

-- ── note_addendum (append-only child; the immutability mechanism) ─────────────
CREATE TABLE note_addendum (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES note(id),
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,                          -- PHI correction text
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_addendum_note ON note_addendum(note_id);

-- Defense in depth: an addendum, once written, is also append-only. No edit, no
-- delete; a further correction is another addendum (mirrors the clinical standard).
CREATE TRIGGER trg_addendum_no_update
BEFORE UPDATE ON note_addendum
BEGIN
  SELECT RAISE(ABORT, 'addendum is append-only');
END;

CREATE TRIGGER trg_addendum_no_delete
BEFORE DELETE ON note_addendum
BEGIN
  SELECT RAISE(ABORT, 'addendum is append-only');
END;

-- ── billing: INVOICE-CENTRIC (F3). invoice -> service_line -> payment ─────────
CREATE TABLE invoice (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES client(id),
  document_type  TEXT NOT NULL DEFAULT 'invoice'
                   CHECK (document_type IN ('invoice','superbill')),
  issue_date     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','issued','paid','partial','void')),
  total_amount_cents INTEGER NOT NULL DEFAULT 0,
  demo           INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_invoice_client ON invoice(client_id);

-- CMS-1500-compatible field set so a future claim-export reuses provider_profile
-- + service_line without remodeling. v1 renders invoice + superbill only.
CREATE TABLE service_line (
  id                     TEXT PRIMARY KEY,
  invoice_id             TEXT NOT NULL REFERENCES invoice(id),   -- F3
  appointment_id         TEXT REFERENCES appointment(id),
  client_id              TEXT NOT NULL REFERENCES client(id),
  date_of_service        TEXT NOT NULL,
  cpt_code_id            TEXT REFERENCES code_item(id),          -- she picks; app never advises
  icd10_code_id          TEXT REFERENCES code_item(id),
  place_of_service_code  TEXT,
  duration_minutes       INTEGER,
  description            TEXT NOT NULL DEFAULT '',
  fee_cents              INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents      INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL
);
CREATE INDEX idx_service_line_invoice ON service_line(invoice_id);

CREATE TABLE payment (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoice(id),             -- F3
  amount_cents INTEGER NOT NULL DEFAULT 0,
  method       TEXT NOT NULL DEFAULT 'cash'
                 CHECK (method IN ('cash','card','check','other')),
  paid_at      TEXT NOT NULL,
  note         TEXT,
  demo         INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_payment_invoice ON payment(invoice_id);

-- ── document_attachment (intake uploads / files; encrypted blob refs) ─────────
CREATE TABLE document_attachment (
  id          TEXT PRIMARY KEY,
  client_id   TEXT REFERENCES client(id),
  label       TEXT NOT NULL DEFAULT '',
  blob_uuid   TEXT NOT NULL,                          -- ref into the encrypted blobStore
  filename    TEXT NOT NULL DEFAULT '',
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  iv          TEXT NOT NULL,                          -- base64 GCM iv
  auth_tag    TEXT NOT NULL,                          -- base64 GCM tag
  demo        INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_doc_client ON document_attachment(client_id);

-- ── config_kv (runtime config overrides; not PHI) ─────────────────────────────
CREATE TABLE config_kv (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ── audit_log (non-PHI metadata trail; F4: never content) ─────────────────────
CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'app',
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT,
  summary    TEXT                                     -- counts/ids/bytes only, never body
);
CREATE INDEX idx_audit_at ON audit_log(at);
