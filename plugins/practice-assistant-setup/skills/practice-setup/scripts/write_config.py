#!/usr/bin/env python3
"""write_config.py: the ONLY way this plugin writes practice app settings.

Reads, validates, merges, and atomically writes the practice app's config.json.
Python 3 standard library only. Safe by construction:

  - STRICT allowlist of settings paths; anything else is rejected.
  - The Practice Profile is schema-validated on every write (embedded rules
    mirroring practice-profile.schema.json, including aiEnabled == false).
  - app.dataMode and every credential-like key are structurally impossible to
    write because they are not on the allowlist.
  - Existing settings are preserved by a deep merge (objects merge, arrays and
    scalars replace), matching the app's own merge semantics. The one exception
    is practiceProfile, which is REPLACED wholesale after validation: the app
    treats a profile with any extra key as absent, so no stale key from an old
    profile may survive a write.
  - practiceProfile.createdAt is preserved from an existing profile (re-runs
    never reset the original setup date).
  - A timestamped backup of any existing config.json is made before writing.
  - Writes are atomic (temp file then replace) with mode 0600 where supported.

Usage:
  python3 write_config.py --config-dir DIR --read
  python3 write_config.py --config-dir DIR --payload FILE --dry-run
  python3 write_config.py --config-dir DIR --payload FILE

Exit codes: 0 ok, 1 validation or usage error, 2 unexpected I/O error.
"""

import argparse
import fnmatch
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime

CONFIG_NAME = "config.json"

# ---------------------------------------------------------------- allowlist

# Top-level namespace -> allowed second-level keys. This IS the contract from
# references/provisioning-map.md section 2. Nothing else can be written.
ALLOWED = {
    "practiceProfile": None,  # whole block, schema-validated below
    "app": {"productName", "enabledModules"},
    "notes": {"defaultFormat", "formats"},
    "intake": {"fields"},
    "scheduling": {"defaultModality", "defaultDurationMinutes"},
    "reminders": {"defaultTemplate", "leadHours"},
    "billing": {"currency"},
}

MODULE_IDS = ["notes", "intake", "scheduling", "billing"]
NOTE_FORMATS = ["SOAP", "DAP", "BIRP"]
FIELD_TYPES = ["text", "multiline", "date", "boolean", "select"]
KNOWN_INTAKE_COLUMNS = {
    "prior_therapy", "hospitalizations", "current_medications",
    "substance_use", "family_mh_history", "consent_acknowledged",
}
PROFILE_ENUMS = {
    "practiceType": ["individual", "couples", "family", "group", "mixed"],
    "careSetting": ["in_person", "telehealth", "both"],
    "noteFormat": NOTE_FORMATS,
    "billsInsurance": ["insurance", "cash_pay", "both"],
    "weeklyVolume": ["low", "medium", "high"],
    "aiComfort": ["keen", "cautious", "off_for_now"],
    "privacyPosture": ["maximum", "standard"],
}
PROFILE_REQUIRED = [
    "schemaVersion", "createdAt", "practiceName", "practiceType", "careSetting",
    "noteFormat", "billsInsurance", "weeklyVolume", "wantsIntake",
    "wantsScheduling", "aiComfort", "privacyPosture", "provisioning",
]
PROVISIONING_REQUIRED = ["enabledModules", "appliedConfigs", "aiEnabled", "completedAt"]


def fail(errors):
    for e in errors:
        print("ERROR: " + e, file=sys.stderr)
    sys.exit(1)


def clip_at_word_boundary(name, limit):
    """Clip name to at most limit characters, never cutting a word in half.

    Backs up to the last space inside the limit when the cut would land
    mid-word. A single word longer than the limit is hard-clipped, since no
    word boundary exists to respect."""
    name = name.strip()
    if len(name) <= limit:
        return name
    cut = name[:limit]
    if not name[limit].isspace() and not cut[-1].isspace():
        space = cut.rfind(" ")
        if space > 0:
            cut = cut[:space]
    return cut.rstrip()


# ---------------------------------------------------------------- validation

def validate_profile(p, errors):
    if not isinstance(p, dict):
        errors.append("practiceProfile must be an object")
        return
    extras = set(p) - set(PROFILE_REQUIRED)
    if extras:
        errors.append("practiceProfile has fields that are not allowed: " + ", ".join(sorted(extras)))
    missing = [k for k in PROFILE_REQUIRED if k not in p]
    if missing:
        errors.append("practiceProfile is missing required fields: " + ", ".join(missing))
        return
    if not isinstance(p["schemaVersion"], int) or isinstance(p["schemaVersion"], bool) or p["schemaVersion"] < 1:
        errors.append("practiceProfile.schemaVersion must be a whole number of at least 1")
    if not isinstance(p["createdAt"], str) or not p["createdAt"].strip():
        errors.append("practiceProfile.createdAt must be a non-empty ISO timestamp string")
    if not isinstance(p["practiceName"], str) or len(p["practiceName"]) > 120:
        errors.append("practiceProfile.practiceName must be a string of at most 120 characters")
    for key, allowed in PROFILE_ENUMS.items():
        if p.get(key) not in allowed:
            errors.append("practiceProfile.%s must be one of: %s" % (key, ", ".join(allowed)))
    for key in ("wantsIntake", "wantsScheduling"):
        if not isinstance(p.get(key), bool):
            errors.append("practiceProfile.%s must be true or false" % key)

    prov = p.get("provisioning")
    if not isinstance(prov, dict):
        errors.append("practiceProfile.provisioning must be an object")
        return
    extras = set(prov) - set(PROVISIONING_REQUIRED)
    if extras:
        errors.append("provisioning has fields that are not allowed: " + ", ".join(sorted(extras)))
    for k in PROVISIONING_REQUIRED:
        if k not in prov:
            errors.append("provisioning is missing required field: " + k)
    if prov.get("aiEnabled") is not False:
        errors.append("provisioning.aiEnabled must be the literal false. AI is never enabled by setup.")
    mods = prov.get("enabledModules")
    if not isinstance(mods, list) or any(m not in MODULE_IDS for m in mods) or len(set(mods)) != len(mods or []):
        errors.append("provisioning.enabledModules must be a unique list drawn from: " + ", ".join(MODULE_IDS))
    elif "notes" not in mods:
        errors.append("provisioning.enabledModules must always include notes")
    ac = prov.get("appliedConfigs")
    if not isinstance(ac, dict) or any(not isinstance(v, str) for v in (ac or {}).values()):
        errors.append("provisioning.appliedConfigs must be an object of short text labels")
    elif any(len(v) > 120 for v in ac.values()):
        errors.append("provisioning.appliedConfigs values must be short labels of at most "
                      "120 characters each")
    ca = prov.get("completedAt")
    if ca is not None and not isinstance(ca, str):
        errors.append("provisioning.completedAt must be a timestamp string or null")


def validate_intake_fields(fields, errors):
    if not isinstance(fields, list) or not fields:
        errors.append("intake.fields must be a non-empty list of field definitions")
        return
    seen = set()
    for i, f in enumerate(fields):
        where = "intake.fields[%d]" % i
        if not isinstance(f, dict):
            errors.append(where + " must be an object")
            continue
        allowed = {"key", "label", "type", "hint", "required", "options", "column"}
        extras = set(f) - allowed
        if extras:
            errors.append(where + " has unknown properties: " + ", ".join(sorted(extras)))
        if not isinstance(f.get("key"), str) or not f["key"] or f["key"] in seen:
            errors.append(where + " needs a unique non-empty key")
        else:
            seen.add(f["key"])
        if not isinstance(f.get("label"), str) or not f["label"]:
            errors.append(where + " needs a label")
        if f.get("type") not in FIELD_TYPES:
            errors.append(where + " type must be one of: " + ", ".join(FIELD_TYPES))
        if "column" in f and f["column"] not in KNOWN_INTAKE_COLUMNS:
            errors.append(where + " column is not a known intake column; leave column off new fields")
        if f.get("type") == "select":
            opts = f.get("options")
            ok = isinstance(opts, list) and opts and all(
                isinstance(o, dict) and set(o) == {"value", "label"}
                and isinstance(o["value"], str) and isinstance(o["label"], str)
                for o in opts
            )
            if not ok:
                errors.append(where + " select needs options as a list of value and label pairs")


def validate_note_formats(formats, errors):
    if not isinstance(formats, dict):
        errors.append("notes.formats must be an object of format name to section list")
        return
    for builtin in NOTE_FORMATS:
        if builtin not in formats:
            errors.append("notes.formats must keep the built-in format: " + builtin)
    for name, sections in formats.items():
        if not isinstance(name, str) or not name.isupper() or len(name) > 12:
            errors.append("notes.formats name %r must be a short uppercase word" % (name,))
        if not isinstance(sections, list) or not sections:
            errors.append("notes.formats.%s must be a non-empty list of sections" % name)
            continue
        for j, s in enumerate(sections):
            if not (isinstance(s, dict) and set(s) == {"key", "label"}
                    and isinstance(s.get("key"), str) and isinstance(s.get("label"), str)):
                errors.append("notes.formats.%s[%d] must have exactly key and label" % (name, j))


def validate_payload(payload, errors, warnings):
    if not isinstance(payload, dict) or not payload:
        errors.append("payload must be a non-empty object")
        return
    for ns, sub in payload.items():
        if ns not in ALLOWED:
            errors.append("setting group %r is not allowed; allowed groups: %s"
                          % (ns, ", ".join(sorted(ALLOWED))))
            continue
        if ns == "practiceProfile":
            continue  # validated as a whole below
        if not isinstance(sub, dict) or not sub:
            errors.append("%s must be an object of settings" % ns)
            continue
        for key in sub:
            if key not in ALLOWED[ns]:
                errors.append("setting %s.%s is not allowed; allowed here: %s"
                              % (ns, key, ", ".join(sorted(ALLOWED[ns]))))

    if "practiceProfile" not in payload:
        errors.append("payload must always include the full practiceProfile")
    else:
        validate_profile(payload["practiceProfile"], errors)

    app = payload.get("app", {})
    if isinstance(app, dict):
        if "productName" in app:
            pn = app["productName"]
            if not isinstance(pn, str) or not pn.strip():
                errors.append("app.productName must be a non-empty string")
            elif len(pn) > 80:
                # The app shows at most 80 characters and silently ignores longer
                # names, so clip here and say so instead of losing the name. The
                # clip lands on a word boundary, never in the middle of a word.
                clipped = clip_at_word_boundary(pn, 80)
                app["productName"] = clipped
                warnings.append("the practice name is longer than the 80 characters the app "
                                "can show, so it was shortened to: " + clipped)
        if "enabledModules" in app:
            mods = app["enabledModules"]
            if (not isinstance(mods, list) or any(m not in MODULE_IDS for m in mods)
                    or len(set(mods)) != len(mods) or "notes" not in mods):
                errors.append("app.enabledModules must be a unique list from %s and include notes"
                              % ", ".join(MODULE_IDS))
            prof = payload.get("practiceProfile") or {}
            prov = prof.get("provisioning") if isinstance(prof, dict) else None
            if isinstance(prov, dict) and isinstance(prov.get("enabledModules"), list):
                if sorted(mods or []) != sorted(prov["enabledModules"]):
                    errors.append("app.enabledModules must match practiceProfile.provisioning.enabledModules")

    notes = payload.get("notes", {})
    if isinstance(notes, dict):
        if "defaultFormat" in notes and notes["defaultFormat"] not in NOTE_FORMATS:
            errors.append("notes.defaultFormat must be one of: " + ", ".join(NOTE_FORMATS))
        if "formats" in notes:
            validate_note_formats(notes["formats"], errors)

    if isinstance(payload.get("intake"), dict) and "fields" in payload["intake"]:
        validate_intake_fields(payload["intake"]["fields"], errors)

    sched = payload.get("scheduling", {})
    if isinstance(sched, dict):
        if "defaultModality" in sched:
            if sched["defaultModality"] == "both":
                errors.append("scheduling.defaultModality cannot be 'both'. The app schedules "
                              "each appointment one way; 'both' belongs only in the profile's "
                              "careSetting. Write in_person or telehealth (telehealth when the "
                              "follow-up was skipped)")
            elif sched["defaultModality"] not in ["in_person", "telehealth"]:
                errors.append("scheduling.defaultModality must be in_person or telehealth")
        if "defaultDurationMinutes" in sched:
            d = sched["defaultDurationMinutes"]
            if not isinstance(d, int) or isinstance(d, bool) or not (10 <= d <= 240):
                errors.append("scheduling.defaultDurationMinutes must be a whole number of "
                              "minutes between 10 and 240")

    rem = payload.get("reminders", {})
    if isinstance(rem, dict):
        if "defaultTemplate" in rem:
            t = rem["defaultTemplate"]
            if not isinstance(t, str) or not t.strip():
                errors.append("reminders.defaultTemplate must be a non-empty text")
            else:
                if "—" in t or "–" in t:
                    errors.append("reminders.defaultTemplate must not contain em or en dashes")
                for ph in ("{{preferred_name}}", "{{date}}", "{{time}}"):
                    if ph not in t:
                        warnings.append("reminder wording does not include %s; the app fills that in, so it is usually kept" % ph)
        if "leadHours" in rem:
            lh = rem["leadHours"]
            if not isinstance(lh, int) or isinstance(lh, bool) or not (1 <= lh <= 168):
                errors.append("reminders.leadHours must be a whole number between 1 and 168")

    bill = payload.get("billing", {})
    if isinstance(bill, dict) and "currency" in bill:
        c = bill["currency"]
        if not (isinstance(c, str) and len(c) == 3 and c.isalpha() and c.isupper()):
            errors.append("billing.currency must be a 3-letter uppercase code such as USD")


# ---------------------------------------------------------------- merge + io

def deep_merge(target, source):
    """Objects merge, arrays and scalars replace. Matches the app's semantics."""
    out = dict(target)
    for k, v in source.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_json(path, what):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        fail(["%s not found: %s" % (what, path)])
    except json.JSONDecodeError as e:
        fail(["%s is not valid JSON (%s): %s" % (what, e, path)])


def load_existing(config_path):
    """Load config.json if present. Returns (data, corrupt): corrupt is True
    when the file exists but cannot be read as JSON."""
    if not os.path.exists(config_path):
        return {}, False
    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return (data if isinstance(data, dict) else {}), False
    except (json.JSONDecodeError, OSError):
        return {}, True


def read_existing(config_path):
    """Load config.json for the WRITE path. A corrupt file refuses loudly;
    only --read is allowed to report corruption gently."""
    data, corrupt = load_existing(config_path)
    if corrupt:
        # A corrupt overrides file never bricks the app; it must not brick us.
        # We refuse to overwrite it silently, though.
        fail(["the existing config.json could not be read as JSON; not touching it. "
              "Move it aside manually if it is corrupt: " + config_path])
    return data


def main():
    ap = argparse.ArgumentParser(description="Guarded settings writer for the practice app.")
    ap.add_argument("--config-dir", required=True, help="the connected app data folder")
    ap.add_argument("--payload", help="path to the composed payload JSON")
    ap.add_argument("--dry-run", action="store_true", help="validate and show the plan, write nothing")
    ap.add_argument("--read", action="store_true", help="print current profile and settings as JSON")
    args = ap.parse_args()

    config_dir = os.path.abspath(os.path.expanduser(args.config_dir))
    config_path = os.path.join(config_dir, CONFIG_NAME)

    if args.read:
        # --read never hard-fails on a damaged config.json: the interview needs
        # a calm structured answer so it can continue and use the pending-payload
        # fallback. Only the WRITE path refuses on corruption.
        existing, corrupt = ({}, False)
        if os.path.isdir(config_dir):
            existing, corrupt = load_existing(config_path)
        profile = existing.get("practiceProfile")
        # Validate the on-disk profile with the SAME rules used for writing, so
        # --read reports what the app will actually honor, not merely whether a
        # createdAt string happens to be present.
        profile_problems = []
        if profile is not None:
            validate_profile(profile, profile_problems)
        profile_valid = profile is not None and not profile_problems
        has_profile = (profile_valid
                       and bool(str(profile.get("createdAt", "")).strip()))
        current = {}
        for ns, keys in ALLOWED.items():
            if ns == "practiceProfile" or ns not in existing or not isinstance(existing[ns], dict):
                continue
            picked = {k: existing[ns][k] for k in (keys or set()) if k in existing[ns]}
            if picked:
                current[ns] = picked
        print(json.dumps({
            "configPath": config_path,
            "configFolderExists": os.path.isdir(config_dir),
            "configFileExists": os.path.exists(config_path),
            "configFileCorrupt": corrupt,
            "profileExists": has_profile,
            "profileValid": False if corrupt else (profile_valid if profile is not None else None),
            "profileProblems": profile_problems,
            "practiceProfile": profile if has_profile else None,
            "currentSettings": current,
        }, indent=2, ensure_ascii=False))
        return

    if not args.payload:
        fail(["--payload is required unless --read is used"])
    if not os.path.isdir(config_dir):
        fail(["the app data folder does not exist or is not connected: " + config_dir,
              "ask the user to open the practice app once, close it, and connect the folder, "
              "or save the payload as pending per the provisioning map"])

    payload = load_json(args.payload, "payload")
    existing = read_existing(config_path)

    errors, warnings = [], []
    validate_payload(payload, errors, warnings)
    if errors:
        fail(errors)

    # Preserve the original setup date on re-runs.
    prior = existing.get("practiceProfile")
    if isinstance(prior, dict) and str(prior.get("createdAt", "")).strip():
        payload["practiceProfile"]["createdAt"] = prior["createdAt"]

    merged = deep_merge(existing, payload)
    # The Practice Profile is plugin-owned and validated as a whole above, so it
    # is REPLACED wholesale, never merged into: the app counts the profile's
    # top-level keys exactly, and one stale extra key surviving a merge would
    # make the app treat the entire profile as absent.
    merged["practiceProfile"] = payload["practiceProfile"]

    plan = {
        "configPath": config_path,
        "configFileExisted": os.path.exists(config_path),
        "settingsWritten": sorted(
            ns if ALLOWED[ns] is None else "%s.%s" % (ns, k)
            for ns, sub in payload.items()
            for k in ([None] if ALLOWED[ns] is None else sub)
        ),
        "warnings": warnings,
    }

    if args.dry_run:
        print("DRY RUN OK. Nothing was written.")
        print(json.dumps(plan, indent=2, ensure_ascii=False))
        return

    try:
        # Best-effort sweep of stale temp files left behind by an interrupted
        # earlier write. Matches ONLY the exact ".config-*.tmp" pattern this
        # script itself creates; config.json, backups, and the app's sealed key
        # files live in the same folder and are never touched.
        try:
            for stale in os.listdir(config_dir):
                if fnmatch.fnmatch(stale, ".config-*.tmp"):
                    try:
                        os.remove(os.path.join(config_dir, stale))
                    except OSError:
                        pass
        except OSError:
            pass
        if os.path.exists(config_path):
            # Microsecond stamp plus a counter suffix if needed: two writes in
            # the same second keep two distinct restore points.
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            backup = os.path.join(config_dir, "config.backup-%s.json" % stamp)
            bump = 2
            while os.path.exists(backup):
                backup = os.path.join(config_dir, "config.backup-%s-%d.json" % (stamp, bump))
                bump += 1
            shutil.copy2(config_path, backup)
            plan["backup"] = backup
        fd, tmp = tempfile.mkstemp(prefix=".config-", suffix=".tmp", dir=config_dir)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(merged, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass  # best effort; not all mounts honor modes
        os.replace(tmp, config_path)
    except OSError as e:
        print("ERROR: could not write settings: %s" % e, file=sys.stderr)
        sys.exit(2)

    print("WROTE OK.")
    print(json.dumps(plan, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
