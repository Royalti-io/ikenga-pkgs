#!/usr/bin/env python3
"""groundwork_state.py — the deterministic state machine behind the groundwork skill.

Python 3, stdlib only. No third-party deps, no build step — runs anywhere `python3` is.

This script is the *authoritative executor* for every mechanic that must be exact:
fence-region read/write, sha256 hash-diff idempotency, atomic `.groundwork.json`
writes, the spine-version gate, profile conformance (the 10 rules), ID allocation,
template scaffolding, and the board / status data models. The action files call
into it rather than re-deriving these by hand — an LLM cannot reliably reproduce a
byte-exact region or a real sha256 across invocations, and the skill's whole promise
is byte-exact idempotency. `lib/state.md` is the *spec* for what this script does;
this file is the implementation.

Contract summary (see lib/state.md for the prose):
  * A generated region is `<!-- groundwork:auto:start ID -->` … `<!-- groundwork:auto:end ID -->`.
  * The region's *content hash* is sha256 over the inner body, EXCLUDING the fence
    comments themselves AND an optional leading `last_action:` metadata line (whose
    timestamp must never churn the hash).
  * A write only happens when the new content hash differs from the recorded one.
  * If the on-disk body diverges from what we last wrote, the user hand-edited inside
    the fence; we refuse (SKIPPED_DIRTY) unless --force.
  * Every `.groundwork.json` write is tmp-then-rename (atomic).

Exit codes: 0 ok · 1 hard error / refusal · 2 missing-or-corrupt anchor · 3 spine-gate refusal.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import sys
import tempfile

# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #

ANCHOR = ".groundwork.json"
CURRENT_SPINE_VERSION = "1"

# Keys we genuinely substitute from real sources. Anything else in {{…}} is a
# human-fill example mistakenly using the machine sigil; we down-convert it to <…>.
def _today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).date().isoformat()


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _html_script_escape(s: str) -> str:
    """Make a JSON document safe to splice inside an HTML <script> element.
    Neutralizes `<` / `>` / `&` (and the U+2028/U+2029 JS line separators) so an
    embedded file body containing a literal `</script>` (common in code/markdown)
    can't terminate the block — which would both break JSON.parse (silent fallback
    to mock) and inject live HTML (XSS). Each replacement is a valid JSON \\u escape,
    so JSON.parse round-trips it back to the original character in the app."""
    return (s.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
             .replace(chr(0x2028), "\u2028").replace(chr(0x2029), "\u2029"))


def sha256_text(s: str) -> str:
    return "sha256:" + hashlib.sha256(s.encode("utf-8")).hexdigest()


def die(msg: str, code: int = 1) -> "NoReturn":  # type: ignore[name-defined]
    sys.stderr.write(msg.rstrip("\n") + "\n")
    sys.exit(code)


def emit(obj) -> None:
    """Print a JSON result to stdout (the action parses this)."""
    json.dump(obj, sys.stdout, indent=2, sort_keys=False)
    sys.stdout.write("\n")


def read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def atomic_write(path: str, data: str) -> None:
    d = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".gw-tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# --------------------------------------------------------------------------- #
# anchor I/O
# --------------------------------------------------------------------------- #

def anchor_path(plan: str) -> str:
    return os.path.join(plan, ANCHOR)


def load_anchor(plan: str) -> dict:
    p = anchor_path(plan)
    if not os.path.exists(p):
        die(f"not a groundwork plan folder (no {ANCHOR}); run `groundwork init` first.", 2)
    try:
        return json.loads(read_file(p))
    except json.JSONDecodeError as e:
        die(f"{ANCHOR} is corrupt JSON ({e}); restore from git.", 2)


def save_anchor(plan: str, anchor: dict) -> None:
    anchor["updated"] = _now()
    atomic_write(anchor_path(plan), json.dumps(anchor, indent=2) + "\n")


# --------------------------------------------------------------------------- #
# fence parsing
# --------------------------------------------------------------------------- #

# Recognize markdown (<!-- -->), // and # line-comment fence variants.
def _fence_patterns(fence_id: str):
    esc = re.escape(fence_id)
    start = re.compile(
        rf"^[ \t]*(?:<!--|//|#)[ \t]*groundwork:auto:start[ \t]+{esc}[ \t]*(?:-->)?[ \t]*$",
        re.M,
    )
    end = re.compile(
        rf"^[ \t]*(?:<!--|//|#)[ \t]*groundwork:auto:end[ \t]+{esc}[ \t]*(?:-->)?[ \t]*$",
        re.M,
    )
    return start, end


_META_RE = re.compile(
    r"^[ \t]*(?:<!--|//|#)[ \t]*last_action:[^\n]*?(?:-->)?[ \t]*$", re.M
)


def _strip_meta(body: str) -> str:
    """Drop a single leading `last_action:` metadata line, then trim."""
    lines = body.splitlines()
    # skip leading blank lines
    i = 0
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    if i < len(lines) and _META_RE.match(lines[i]):
        i += 1
    return "\n".join(lines[i:]).strip("\n").strip()


def find_region(text: str, fence_id: str):
    """Return (start_span, end_span, inner_body) or None. inner_body is the raw text
    between the fence comment lines (newline-delimited, fences excluded)."""
    s_re, e_re = _fence_patterns(fence_id)
    sm = s_re.search(text)
    if not sm:
        return None
    em = e_re.search(text, sm.end())
    if not em:
        return None
    inner = text[sm.end():em.start()]
    return (sm.start(), sm.end()), (em.start(), em.end()), inner


def region_content_hash(text: str, fence_id: str):
    r = find_region(text, fence_id)
    if r is None:
        return None
    _, _, inner = r
    return sha256_text(_strip_meta(inner))


# --------------------------------------------------------------------------- #
# profiles
# --------------------------------------------------------------------------- #

PROFILE_ALLOWED_KEYS = {
    "name", "extends", "spine_version", "labels",
    "optional_blocks", "produces_designs", "spine", "spine_overrides",
}
LABEL_KEYS = {"work_unit", "isolation_axis", "freeze_gate_noun"}


def _profile_json_path(root: str, name: str) -> str:
    return os.path.join(root, name, "profile.json")


def validate_profile(root: str, name: str) -> dict:
    """Run rules 1-10. Returns {name, status: conformant|rejected|warn, errors:[], warnings:[]}.
    Canonical error strings are load-bearing — do not paraphrase (lib/state.md §Profile contract)."""
    errors, warnings = [], []
    p = _profile_json_path(root, name)
    if not os.path.exists(p):  # rule 1
        return {"name": name, "status": "rejected",
                "errors": [f'profile "{name}": profile.json missing at profiles/{name}/profile.json'],
                "warnings": []}
    try:  # rule 2
        data = json.loads(read_file(p))
    except json.JSONDecodeError as e:
        return {"name": name, "status": "rejected",
                "errors": [f'profile "{name}": profile.json is not valid JSON ({e})'],
                "warnings": []}

    is_shared = name == "_shared"
    if data.get("name") != name:  # rule 3
        errors.append(f'profile "{name}": profile.json declares name="{data.get("name")}" but lives in profiles/{name}/')
    if not is_shared and data.get("extends") != "_shared":  # rule 4
        errors.append(f'profile "{name}": extends must be "_shared" (got {data.get("extends")})')
    sv = str(data.get("spine_version"))  # rule 5
    if sv > CURRENT_SPINE_VERSION:
        errors.append(f'profile "{name}": spine_version={data.get("spine_version")} exceeds skill\'s current spine_version={CURRENT_SPINE_VERSION}')
    labels = data.get("labels")  # rule 6
    if not isinstance(labels, dict):
        errors.append(f'profile "{name}": labels.work_unit missing or empty')
    else:
        for k in LABEL_KEYS:
            v = labels.get(k)
            if not isinstance(v, str) or not v.strip():
                errors.append(f'profile "{name}": labels.{k} missing or empty')
    ob = data.get("optional_blocks")  # rule 7
    if not (isinstance(ob, list) and all(isinstance(x, str) for x in ob)):
        errors.append(f'profile "{name}": optional_blocks must be an array of strings')
    if not isinstance(data.get("produces_designs"), bool):  # rule 8
        errors.append(f'profile "{name}": produces_designs must be true or false')
    so = data.get("spine_overrides")  # rule 9
    if not isinstance(so, dict):
        errors.append(f'profile "{name}": spine_overrides must be an object')
    else:
        for fname, rel in so.items():
            if not os.path.exists(os.path.join(root, name, rel)):
                errors.append(f'profile "{name}": spine_overrides["{fname}"] points to {rel}, which does not exist')
    for k in data:  # rule 10 (warn)
        if k not in PROFILE_ALLOWED_KEYS:
            warnings.append(f'profile "{name}": unknown top-level key "{k}" (allowed: {", ".join(sorted(PROFILE_ALLOWED_KEYS))})')

    status = "rejected" if errors else ("warn" if warnings else "conformant")
    return {"name": name, "status": status, "errors": errors, "warnings": warnings}


def resolve_profile(root: str, name: str) -> dict:
    """Merge <name> over _shared. Returns the effective profile + the vocab map + spine list."""
    base = json.loads(read_file(_profile_json_path(root, "_shared")))
    if name == "_shared":
        overlay = base
    else:
        overlay = json.loads(read_file(_profile_json_path(root, name)))
    eff = dict(base)
    eff["name"] = name
    eff["labels"] = {**base.get("labels", {}), **overlay.get("labels", {})}
    eff["optional_blocks"] = list(dict.fromkeys(
        base.get("optional_blocks", []) + overlay.get("optional_blocks", [])))
    if "produces_designs" in overlay:
        eff["produces_designs"] = overlay["produces_designs"]
    eff["spine"] = overlay.get("spine", base.get("spine", []))
    eff["spine_overrides"] = {**base.get("spine_overrides", {}), **overlay.get("spine_overrides", {})}
    return eff


# --------------------------------------------------------------------------- #
# template rendering
# --------------------------------------------------------------------------- #

# Match {{name}} or {{vocab.work_unit}} — identifier-style keys only, no spaces or
# punctuation in the key body. This is narrow on purpose: JSX inline-style objects
# (`style={{ color: 'x' }}`) and template-literal expressions (`${'{X}'}`) must not
# look like placeholders to the substitutor. Allowed chars in a key: A-Z, a-z, 0-9,
# `_`, `.`, `-`. Whitespace inside the braces still permitted only as padding.
_PLACEHOLDER_RE = re.compile(r"\{\{[ \t]*([A-Za-z][A-Za-z0-9_.\-]*)[ \t]*\}\}")


def render_template(text: str, subs: dict) -> str:
    """Substitute known machine keys. Any leftover {{…}} is a human-fill example
    using the wrong sigil — down-convert it to <…> so output is clean and the
    'no stray {{}}' contract holds without inventing content."""
    def repl(m):
        key = m.group(1).strip()
        if key in subs:
            return str(subs[key])
        # vocab.* that resolved are in subs; anything else is human-fill
        return "<" + key + ">"
    return _PLACEHOLDER_RE.sub(repl, text)


def build_subs(profile: dict, goal: str, plan_slug: str, extra: dict | None = None) -> dict:
    labels = profile.get("labels", {})
    # Default display title from the slug: "my-feature" → "My-feature". A leading
    # YYYY-MM-DD- date prefix is stripped first, so a date-stamped folder
    # (plans/2026-05-28-my-feature/) yields "my-feature", not the dated slug.
    # The artifact init renders {{plan_title}} into <h1>; hand-edit afterwards if you
    # want a different display string (e.g. lowercase project codename).
    title_src = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", plan_slug) if plan_slug else ""
    plan_title = title_src or "plan"
    subs = {
        "date": _today(),
        "goal": goal,
        "profile": profile["name"],
        "plan_slug": plan_slug,
        "plan_title": plan_title,
        "vocab.work_unit": labels.get("work_unit", "work item"),
        "vocab.isolation_axis": labels.get("isolation_axis", "owner + scope"),
        "vocab.freeze_gate_noun": labels.get("freeze_gate_noun", "decision lock"),
    }
    if extra:
        subs.update(extra)
    return subs


# Region IDs we record per spine file at scaffold time (from the templates).
SCAFFOLD_REGIONS = {
    "00-README.md": ["spine-index", "status-block"],
    "01-plan.md": ["goal", "ids"],
    "02-research-external.md": ["findings", "sources"],
    "03-research-internal.md": ["findings"],
    "04-discussion.md": ["rounds-index"],
    "05-tracking.md": ["round-fold", "wp-matrix", "wave-plan", "critical-path"],
    "artifact/index.html": ["spec-state"],
}

# Files under artifact/ that init drops from the _shared template tree. Same
# convention as drafts/README.md — written only if absent (the artifact may have
# been hand-customized after scaffolding; we never clobber).
SCAFFOLD_ARTIFACT_FILES = [
    "artifact/index.html",
    "artifact/manifest.json",
]


def template_path(root: str, profile: dict, fname: str) -> str:
    """spine_overrides win, else _shared/templates/<fname>."""
    so = profile.get("spine_overrides", {})
    if fname in so:
        cand = os.path.join(root, profile["name"], so[fname])
        if os.path.exists(cand):
            return cand
    return os.path.join(root, "_shared", "templates", fname)


# --------------------------------------------------------------------------- #
# command: spine-gate
# --------------------------------------------------------------------------- #

def cmd_spine_gate(args):
    anchor = load_anchor(args.plan)
    a = str(anchor.get("spine_version"))
    e = str(args.expected)
    if a == e:
        emit({"result": "ok", "anchor": a, "expected": e})
        return
    if a < e:
        die(f"plan is on spine_version={a}, this skill expects {e}. "
            f"Run `groundwork init --migrate` to bring the folder forward.", 3)
    # a > e
    if args.readonly:
        sys.stderr.write(f"warning: plan is on spine_version={a}, this skill is on {e} — running read-only.\n")
        emit({"result": "warn-readonly", "anchor": a, "expected": e})
        return
    die(f"plan is on spine_version={a}, this skill is on {e}. "
        f"Upgrade the groundwork skill (`npx skills add royalti-io/groundwork`) before writing.", 3)


# --------------------------------------------------------------------------- #
# command: validate-profile / resolve-profile
# --------------------------------------------------------------------------- #

def cmd_validate_profile(args):
    if args.all:
        results = []
        for name in sorted(os.listdir(args.profiles_root)):
            if os.path.isdir(os.path.join(args.profiles_root, name)):
                results.append(validate_profile(args.profiles_root, name))
        emit({"profiles": results})
        if any(r["status"] == "rejected" for r in results):
            sys.exit(1)
        return
    r = validate_profile(args.profiles_root, args.name)
    emit(r)
    if r["status"] == "rejected":
        sys.exit(1)


def cmd_resolve_profile(args):
    emit(resolve_profile(args.profiles_root, args.name))


# --------------------------------------------------------------------------- #
# command: init-anchor / read-anchor
# --------------------------------------------------------------------------- #

def _new_anchor(profile: str, goal: str) -> dict:
    now = _now()
    return {
        "spine_version": CURRENT_SPINE_VERSION,
        "profile": profile,
        "created": now,
        "updated": now,
        "goal": goal,
        "docs": {},
        "ids": {},
        "designs": {},
        "subplans": {},
        "research": {},
    }


def cmd_read_anchor(args):
    emit(load_anchor(args.plan))


# --------------------------------------------------------------------------- #
# command: scaffold
# --------------------------------------------------------------------------- #

def _record_doc(anchor: dict, plan: str, relpath: str, fence_ids, action: str):
    """Record a doc's whole-file hash + region hashes. Preserves the existing
    region entry (including its last_written stamp) when the content hash is
    unchanged, so re-recording an untouched doc produces no diff — the basis of
    scaffold idempotency."""
    full = os.path.join(plan, relpath)
    text = read_file(full)
    prior = {r["id"]: r for r in anchor.get("docs", {}).get(relpath, {}).get("generated_regions", [])}
    regions = []
    for fid in fence_ids:
        h = region_content_hash(text, fid)
        if h is None:
            continue
        old = prior.get(fid)
        if old and old.get("hash") == h:
            regions.append(old)  # unchanged — keep the original stamp
        else:
            regions.append({"id": fid, "hash": h, "last_action": action, "last_written": _now()})
    anchor.setdefault("docs", {})[relpath] = {
        "hash": sha256_text(text),
        "generated_regions": regions,
    }


def cmd_scaffold(args):
    plan = args.plan
    root = args.profiles_root
    plan_slug = os.path.basename(os.path.normpath(plan))

    # conformance gate before touching disk (rules 1-9 hard)
    v = validate_profile(root, args.profile)
    if v["status"] == "rejected":
        die("\n".join(v["errors"]), 1)

    profile = resolve_profile(root, args.profile)
    subs = build_subs(profile, args.goal, plan_slug)

    existing_anchor = os.path.exists(anchor_path(plan))
    if existing_anchor and not args.force:
        anchor = load_anchor(plan)
    else:
        anchor = _new_anchor(args.profile, args.goal)
    # snapshot for true-no-op detection (everything except the volatile `updated`)
    before = json.dumps({k: v for k, v in anchor.items() if k != "updated"}, sort_keys=True)

    os.makedirs(plan, exist_ok=True)
    written, skipped = [], []
    for fname in profile["spine"]:
        dest = os.path.join(plan, fname)
        if os.path.exists(dest) and not args.force:
            skipped.append(fname)
        else:
            tpl = template_path(root, profile, fname)
            atomic_write(dest, render_template(read_file(tpl), subs))
            written.append(fname)
        _record_doc(anchor, plan, fname, SCAFFOLD_REGIONS.get(fname, []), "init")

    # designs/ + drafts/ (cheap dirs)
    os.makedirs(os.path.join(plan, "designs"), exist_ok=True)
    gitkeep = os.path.join(plan, "designs", ".gitkeep")
    if not os.path.exists(gitkeep):
        atomic_write(gitkeep, "")
    drafts_tpl = os.path.join(root, "_shared", "templates", "drafts", "README.md")
    drafts_dest = os.path.join(plan, "drafts", "README.md")
    os.makedirs(os.path.join(plan, "drafts"), exist_ok=True)
    if os.path.exists(drafts_tpl) and not os.path.exists(drafts_dest):
        atomic_write(drafts_dest, render_template(read_file(drafts_tpl), subs))
        written.append("drafts/README.md")

    # artifact/ — living-spec index.html + ikenga manifest. Written only if absent
    # (hand-edited overlays are preserved); the spec-state fence inside index.html
    # starts as an empty scaffold and is regenerated by `refresh-living-spec`.
    artifact_dir = os.path.join(plan, "artifact")
    os.makedirs(artifact_dir, exist_ok=True)
    for relpath in SCAFFOLD_ARTIFACT_FILES:
        tpl = os.path.join(root, "_shared", "templates", relpath)
        dest = os.path.join(plan, relpath)
        if not os.path.exists(tpl):
            continue
        if os.path.exists(dest) and not args.force:
            skipped.append(relpath)
        else:
            atomic_write(dest, render_template(read_file(tpl), subs))
            written.append(relpath)
        # Only record region hashes for files we know carry a fence.
        regions = SCAFFOLD_REGIONS.get(relpath, [])
        if regions:
            _record_doc(anchor, plan, relpath, regions, "init")

    after = json.dumps({k: v for k, v in anchor.items() if k != "updated"}, sort_keys=True)
    changed = (not existing_anchor) or (before != after) or bool(written)
    if changed:
        save_anchor(plan, anchor)  # bumps `updated`
    # else: true no-op — leave the anchor (and its `updated`) untouched
    emit({"result": "scaffolded" if not existing_anchor else ("reconciled" if changed else "unchanged"),
          "plan": plan, "profile": args.profile, "spine_version": CURRENT_SPINE_VERSION,
          "written": written, "skipped_existing": skipped})


# --------------------------------------------------------------------------- #
# command: read-region / write-region
# --------------------------------------------------------------------------- #

def cmd_read_region(args):
    r = find_region(read_file(args.file), args.id)
    if r is None:
        die(f"fence '{args.id}' not found in {args.file}", 1)
    _, _, inner = r
    sys.stdout.write(_strip_meta(inner) + "\n")


def cmd_write_region(args):
    plan = args.plan
    relpath = args.file
    full = os.path.join(plan, relpath)
    fid = args.id
    action = args.action
    new_content = args.content if args.content is not None else read_file(args.content_file)
    new_content = new_content.strip("\n")
    if getattr(args, "html_script_safe", False):
        new_content = _html_script_escape(new_content)
    new_hash = sha256_text(new_content.strip())

    text = read_file(full)
    r = find_region(text, fid)
    if r is None:
        die(f"fence '{fid}' not found in {relpath}", 1)
    (s0, s1), (e0, e1), inner = r

    anchor = load_anchor(plan)
    doc = anchor.get("docs", {}).get(relpath, {})
    recorded = next((x for x in doc.get("generated_regions", []) if x["id"] == fid), None)
    on_disk_hash = sha256_text(_strip_meta(inner))

    # no-op?
    if recorded and recorded["hash"] == new_hash and on_disk_hash == new_hash:
        emit({"result": "UNCHANGED", "file": relpath, "id": fid})
        return
    # dirty? (on-disk differs from what we last wrote, and content actually changed)
    if recorded and on_disk_hash != recorded["hash"] and not args.force:
        emit({"result": "SKIPPED_DIRTY", "file": relpath, "id": fid,
              "hint": f"region '{fid}' edited by hand; pass --force to overwrite"})
        sys.exit(0)

    # detect comment style from the start fence line
    start_line = text[s0:s1]
    if start_line.lstrip().startswith("//"):
        meta = f"// last_action: {action} · {_now()}"
    elif start_line.lstrip().startswith("#"):
        meta = f"# last_action: {action} · {_now()}"
    else:
        meta = f"<!-- last_action: {action} · {_now()} -->"

    new_inner = f"\n{meta}\n{new_content}\n"
    new_text = text[:s1] + new_inner + text[e0:]
    atomic_write(full, new_text)

    # update anchor
    doc = anchor.setdefault("docs", {}).setdefault(relpath, {"generated_regions": []})
    regs = doc.setdefault("generated_regions", [])
    entry = next((x for x in regs if x["id"] == fid), None)
    if entry is None:
        entry = {"id": fid}
        regs.append(entry)
    entry.update({"hash": new_hash, "last_action": action, "last_written": _now()})
    doc["hash"] = sha256_text(new_text)
    save_anchor(plan, anchor)
    emit({"result": "WRITTEN", "file": relpath, "id": fid})


# --------------------------------------------------------------------------- #
# command: next-id / register-id
# --------------------------------------------------------------------------- #

def cmd_next_id(args):
    anchor = load_anchor(args.plan)
    ids = anchor.get("ids", {})
    kind = args.kind
    if kind in ("gap", "wp", "design"):
        prefix = {"gap": "G", "wp": "WP", "design": "D"}[kind]
        nums = []
        pat = re.compile(rf"^{prefix}-(\d+)")
        for k in ids:
            m = pat.match(k)
            if m:
                nums.append(int(m.group(1)))
        nxt = (max(nums) + 1) if nums else 1
        emit({"kind": kind, "next": f"{prefix}-{nxt:02d}"})
    elif kind == "gate":
        if not args.name:
            die("gate IDs require --name (e.g. --name SCHEMA → G-SCHEMA)", 1)
        emit({"kind": kind, "next": f"G-{args.name.upper()}"})
    else:
        die(f"unknown id kind: {kind}", 1)


def cmd_stamp_research(args):
    anchor = load_anchor(args.plan)
    anchor.setdefault("research", {}).setdefault(args.file, {})["stamped"] = args.date or _today()
    save_anchor(args.plan, anchor)
    emit({"result": "stamped", "file": args.file, "stamped": anchor["research"][args.file]["stamped"]})


def cmd_register_subplan(args):
    anchor = load_anchor(args.plan)
    full = os.path.join(args.plan, args.file)
    h = sha256_text(read_file(full)) if os.path.exists(full) else None
    anchor.setdefault("subplans", {})[args.file] = {
        "archetype": args.archetype, "topic": args.topic,
        "ref": args.ref if args.ref not in (None, "", "none") else None,
        "created": _now(), "hash": h, "status": "active",
    }
    save_anchor(args.plan, anchor)
    emit({"result": "registered-subplan", "file": args.file,
          "entry": anchor["subplans"][args.file]})


def cmd_register_id(args):
    anchor = load_anchor(args.plan)
    ids = anchor.setdefault("ids", {})
    entry = ids.get(args.id, {})
    entry["doc"] = args.doc
    for kv in (args.field or []):
        if "=" not in kv:
            die(f"--field expects k=v, got {kv}", 1)
        k, v = kv.split("=", 1)
        try:
            v = json.loads(v)
        except json.JSONDecodeError:
            pass
        entry[k] = v
    ids[args.id] = entry
    save_anchor(args.plan, anchor)
    emit({"result": "registered", "id": args.id, "entry": entry})


# --------------------------------------------------------------------------- #
# command: board-data / status-data
# --------------------------------------------------------------------------- #

def _plan_title(plan: str, anchor: dict) -> str:
    f = os.path.join(plan, "01-plan.md")
    if os.path.exists(f):
        for line in read_file(f).splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    return anchor.get("goal", "")


def _extract_wp_briefs(plan: str) -> dict:
    """Parse 09-orchestration.md for `### WP-NN — title` sections; return {WP-NN: brief-body}.

    A brief runs from its `### WP-` header to the next `### `/`## ` header or a `---` rule.
    Returns {} if 09 is absent. Used by `board-data --with-briefs` so the workflow
    generator can inline each self-contained brief as a string constant at emit time.
    """
    f = os.path.join(plan, "09-orchestration.md")
    if not os.path.exists(f):
        return {}
    briefs, cur, buf = {}, None, []
    hdr = re.compile(r"^### (WP-\d+[a-z]?)(?![\w])")  # letter slices (WP-18a) — \b fails between digit+letter
    for line in read_file(f).splitlines():
        m = hdr.match(line)
        if m:
            if cur:
                briefs[cur] = "\n".join(buf).strip()
            cur, buf = m.group(1), [line]
        elif cur is not None:
            if line.startswith("## ") or re.match(r"^---\s*$", line) or hdr.match(line):
                briefs[cur] = "\n".join(buf).strip()
                cur, buf = None, []
            else:
                buf.append(line)
    if cur:
        briefs[cur] = "\n".join(buf).strip()
    return briefs


def cmd_board_data(args):
    plan = args.plan
    anchor = load_anchor(plan)
    ids = anchor.get("ids", {})
    briefs = _extract_wp_briefs(plan) if getattr(args, "with_briefs", False) else {}
    wps, gates = [], []
    for k, v in ids.items():
        if k.startswith("WP-"):
            wp = {"id": k, "title": v.get("title", ""), "wave": v.get("wave"),
                  "deps": v.get("depends_on", []), "status": v.get("status", "queued"),
                  "gate": v.get("gate"), "tier": v.get("tier")}
            if getattr(args, "with_briefs", False):
                wp["brief"] = briefs.get(k)
            wps.append(wp)
        elif k.startswith("G-") and v.get("kind") == "freeze_gate":
            gates.append({"id": k, "wp": v.get("wp"), "status": v.get("status", "pending")})
    designs = [{"path": p, "phase": d.get("phase"), "wp": d.get("wp"), "locked": d.get("locked", False)}
               for p, d in anchor.get("designs", {}).items()]
    subplans = [{"path": p, "archetype": d.get("archetype"), "ref": d.get("ref"),
                 "status": d.get("status", "active")} for p, d in anchor.get("subplans", {}).items()]
    emit({
        "plan": {"title": _plan_title(plan, anchor), "profile": anchor.get("profile"),
                 "goal": anchor.get("goal"), "slug": os.path.basename(os.path.normpath(plan))},
        "gates": gates, "wps": wps, "designs": designs, "subplans": subplans,
        "research": {k: v.get("stamped") for k, v in anchor.get("research", {}).items()},
    })


def cmd_status_data(args):
    plan = args.plan
    anchor = load_anchor(plan)
    docs = anchor.get("docs", {})
    doc_report = []
    for relpath, meta in docs.items():
        full = os.path.join(plan, relpath)
        if not os.path.exists(full):
            doc_report.append({"file": relpath, "state": "missing"})
            continue
        text = read_file(full)
        whole_ok = sha256_text(text) == meta.get("hash")
        dirty = []
        for reg in meta.get("generated_regions", []):
            cur = region_content_hash(text, reg["id"])
            if cur is not None and cur != reg["hash"]:
                dirty.append(reg["id"])
        doc_report.append({"file": relpath,
                           "state": "in-sync" if (whole_ok and not dirty) else "drift",
                           "whole_file_match": whole_ok, "dirty_regions": dirty})
    ids = anchor.get("ids", {})
    gaps = sum(1 for k, v in ids.items() if k.startswith("G-") and v.get("kind") != "freeze_gate")
    gates = sum(1 for k, v in ids.items() if k.startswith("G-") and v.get("kind") == "freeze_gate")
    wps = sum(1 for k in ids if k.startswith("WP-"))
    designs_n = sum(1 for k in ids if k.startswith("D-"))
    profiles_report = None
    if args.profiles_root:
        profiles_report = [validate_profile(args.profiles_root, n)
                           for n in sorted(os.listdir(args.profiles_root))
                           if os.path.isdir(os.path.join(args.profiles_root, n))]
    emit({
        "profile": anchor.get("profile"), "spine_version": anchor.get("spine_version"),
        "goal": anchor.get("goal"), "created": anchor.get("created"), "updated": anchor.get("updated"),
        "docs": doc_report,
        "ids": {"gaps": gaps, "gates": gates, "wps": wps, "designs": designs_n, "total": len(ids)},
        "subplans": [{"path": p, "archetype": d.get("archetype"), "status": d.get("status", "active"),
                      "ref": d.get("ref")} for p, d in anchor.get("subplans", {}).items()],
        "designs": anchor.get("designs", {}),
        "research": anchor.get("research", {}),
        "profile_conformance": profiles_report,
    })


# --------------------------------------------------------------------------- #
# command: explorer-data
# --------------------------------------------------------------------------- #

# Extension → viewer type. `design` is derived from path (under designs/), not here.
_EXPLORER_EXT_TYPE = {
    ".md": "markdown", ".markdown": "markdown", ".mdx": "markdown",
    ".html": "html-artifact", ".htm": "html-artifact",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
    ".webp": "image", ".avif": "image", ".bmp": "image", ".ico": "image",
    ".svg": "svg", ".pdf": "pdf", ".json": "json",
    ".js": "code", ".mjs": "code", ".cjs": "code", ".ts": "code", ".tsx": "code",
    ".jsx": "code", ".css": "code", ".scss": "code", ".py": "code", ".sh": "code",
    ".rb": "code", ".go": "code", ".rs": "code", ".yml": "code", ".yaml": "code",
    ".toml": "code", ".sql": "code",
    ".txt": "text", ".csv": "text", ".log": "text", ".env": "text",
}
# Types whose content we embed verbatim into explorer-data (cheap text). Everything
# else (image / pdf / html-artifact / design) is referenced by relative path so the
# artifact stays small and relative token/asset imports keep resolving.
_EXPLORER_EMBED_TYPES = {"markdown", "svg", "json", "code", "text"}
_EXPLORER_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".next", "dist",
                       "build", ".turbo", ".cache", ".vercel"}
_EXPLORER_SKIP_FILES = {".DS_Store", "Thumbs.db"}
# Self-referential / volatile files excluded from the model so re-runs are a true
# no-op. `.groundwork.json` is machine state that *this* action mutates (via
# write-region) every run, and `artifact/explorer.html` is the artifact itself —
# embedding either makes the model churn on every regenerate. Their content/size
# changing each run would otherwise make `explorer` perpetually "drifted".
_EXPLORER_SELF_SKIP = {".groundwork.json", "artifact/explorer.html"}
_EXPLORER_PER_FILE_CAP = 96 * 1024      # 96 KB — no single embed bigger than this
_EXPLORER_TOTAL_BUDGET = 768 * 1024     # 768 KB total embed — well under the 2 MB error
# Embed priority (lower = embedded first, so the planning core never loses to the
# long tail of parts/ mockup-spec docs). Within a tier, smaller files win.
_EXPLORER_PRIORITY = {"spine": 0, "subplan": 1, "draft": 2, "artifact": 2,
                      "anchor": 3, "parts": 4, "asset": 4, "design": 5, "other": 4}


def _explorer_node_type(name: str, relposix: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    t = _EXPLORER_EXT_TYPE.get(ext, "file")
    # A .html under designs/ is a design mockup, not a generic artifact.
    if t == "html-artifact" and (relposix == "designs" or relposix.startswith("designs/")):
        t = "design"
    return t


def _explorer_node_kind(relposix: str, name: str, anchor: dict) -> str:
    if relposix == ".groundwork.json":
        return "anchor"
    if relposix in anchor.get("subplans", {}):
        return "subplan"
    if relposix in anchor.get("designs", {}):
        return "design"
    # top-level numbered docs
    m = re.match(r"^(\d\d)-.*\.md$", name)
    if m and "/" not in relposix:
        n = m.group(1)
        if n in {"00", "01", "02", "03", "04", "05", "09"}:
            return "spine"
        return "subplan"
    head = relposix.split("/", 1)[0]
    if head == "artifact":
        return "asset" if "/assets/" in ("/" + relposix) else "artifact"
    if head == "designs":
        return "design"
    if head == "drafts":
        return "draft"
    if head in {"assets", "foundations", "parts"}:
        return head if head != "assets" else "asset"
    return "other"


def _explorer_badges(relposix: str, ntype: str, kind: str, anchor: dict) -> dict:
    b = {}
    d = anchor.get("designs", {}).get(relposix)
    if d:
        b["design"] = {"phase": d.get("phase"), "wp": d.get("wp"),
                       "locked": d.get("locked", False), "locked_in": d.get("locked_in")}
    sp = anchor.get("subplans", {}).get(relposix)
    if sp:
        b["subplan"] = {"archetype": sp.get("archetype"), "ref": sp.get("ref"),
                        "status": sp.get("status", "active")}
    # drift state for tracked docs is computed by the walker once content is read
    # (it needs the file body); referenced files carry the node.registered flag only.
    return b


def _explorer_walk(plan: str, rel: str, anchor: dict, budget: dict) -> dict | None:
    """Build a typed tree node for `<plan>/<rel>` (rel uses os.sep). Returns None
    for skipped entries. Mutates budget['spent'] / budget['truncated']."""
    full = os.path.join(plan, rel) if rel else plan
    name = os.path.basename(rel) if rel else os.path.basename(os.path.normpath(plan))
    relposix = rel.replace(os.sep, "/")

    if os.path.isdir(full):
        # Skip noise dirs — but only for descendants, never the plan root itself
        # (a plan legitimately named `build`/`dist`/… must still render).
        if rel and name in _EXPLORER_SKIP_DIRS:
            return None
        # Symlink-loop / re-entry guard: a dir symlink pointing at an ancestor would
        # otherwise recurse until ELOOP, producing a phantom tree that eats the embed
        # budget. Skip any real directory we've already entered.
        try:
            real = os.path.realpath(full)
        except OSError:
            real = full
        if real in budget["seen_dirs"]:
            return None
        budget["seen_dirs"].add(real)
        children = []
        try:
            entries = sorted(os.listdir(full))
        except OSError:
            entries = []
        for child in entries:
            if child in _EXPLORER_SKIP_FILES:
                continue
            node = _explorer_walk(plan, os.path.join(rel, child) if rel else child, anchor, budget)
            if node is not None:
                children.append(node)
        # dotfiles last, then alpha (numeric-prefixed docs sort first naturally)
        children.sort(key=lambda n: (n["name"].startswith("."), n["name"].lower()))
        budget["dirs"] += 1
        return {"name": name, "path": relposix, "type": "dir", "kind": "dir",
                "registered": True, "children": children, "empty": len(children) == 0}

    # file
    if name in _EXPLORER_SKIP_FILES or name == ".gitkeep" or relposix in _EXPLORER_SELF_SKIP:
        return None
    ntype = _explorer_node_type(name, relposix)
    kind = _explorer_node_kind(relposix, name, anchor)
    try:
        size = os.path.getsize(full)
    except OSError:
        size = 0
    registered = (relposix in anchor.get("docs", {}) or relposix in anchor.get("subplans", {})
                  or relposix in anchor.get("designs", {}) or relposix == ".groundwork.json")
    badges = _explorer_badges(relposix, ntype, kind, anchor)
    node = {"name": name, "path": relposix, "type": ntype, "kind": kind,
            "registered": registered, "size": size}
    budget["files"] += 1

    if ntype in _EXPLORER_EMBED_TYPES:
        node["embedded"] = False  # decided in the greedy priority pass after the walk
        budget["embeddable"].append((node, full, relposix, size))
    else:
        node["embedded"] = False
        budget["referenced"] += 1
    if badges:
        node["badges"] = badges
    return node


def _explorer_embed_pass(anchor: dict, budget: dict):
    """Second phase: embed file contents in priority order until the budget is
    spent, so the planning core (spine, subplans, quality-gate) always wins over
    the long tail of parts/ mockup specs. Computes drift for tracked docs here,
    where the body is in hand."""
    def rank(item):
        node, _full, _rel, size = item
        tier = _EXPLORER_PRIORITY.get(node["kind"], 4)
        if node["name"] == "quality-gate.md":
            tier = 1
        return (tier, size)
    for node, full, relposix, size in sorted(budget["embeddable"], key=rank):
        if size > _EXPLORER_PER_FILE_CAP or budget["spent"] + size > _EXPLORER_TOTAL_BUDGET:
            budget["truncated"].append(relposix)
            continue
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            budget["truncated"].append(relposix)
            continue
        node["content"] = text
        node["embedded"] = True
        budget["spent"] += size
        budget["embedded"] += 1
        # refine drift state for tracked docs now that we have content
        doc = anchor.get("docs", {}).get(relposix)
        if doc:
            badges = node.setdefault("badges", {})
            whole_ok = sha256_text(text) == doc.get("hash")
            dirty = [reg["id"] for reg in doc.get("generated_regions", [])
                     if (region_content_hash(text, reg["id"]) or reg["hash"]) != reg["hash"]]
            badges["drift"] = "in-sync" if (whole_ok and not dirty) else "drift"
            if dirty:
                badges["dirty_regions"] = dirty
            fences = [reg["id"] for reg in doc.get("generated_regions", [])]
            if fences:
                badges["fences"] = fences


def cmd_explorer_data(args):
    plan = args.plan
    anchor = load_anchor(plan)
    budget = {"spent": 0, "files": 0, "dirs": 0, "embedded": 0,
              "referenced": 0, "truncated": [], "embeddable": [], "seen_dirs": set()}
    root = _explorer_walk(plan, "", anchor, budget)
    _explorer_embed_pass(anchor, budget)
    tree = root["children"] if root else []
    emit({
        "plan": {"title": _plan_title(plan, anchor), "profile": anchor.get("profile"),
                 "goal": anchor.get("goal"),
                 "slug": os.path.basename(os.path.normpath(plan))},
        "tree": tree,
        "ids": anchor.get("ids", {}),
        "designs": anchor.get("designs", {}),
        "subplans": anchor.get("subplans", {}),
        "research": {k: v.get("stamped") for k, v in anchor.get("research", {}).items()},
        "stats": {"files": budget["files"], "dirs": budget["dirs"],
                  "embedded": budget["embedded"], "referenced": budget["referenced"],
                  "embedded_bytes": budget["spent"], "truncated": budget["truncated"]},
    })


# --------------------------------------------------------------------------- #
# command: plans-index-data — cross-plan rollup for a whole plans/ directory
# --------------------------------------------------------------------------- #

def _plan_rollup(plan_dir: str, name: str) -> dict | None:
    """Lightweight metadata-only rollup for one plan (no doc embedding). Returns
    None if the dir isn't a groundwork plan or the anchor is corrupt."""
    ap = os.path.join(plan_dir, ANCHOR)
    if not os.path.exists(ap):
        return None
    try:
        anchor = json.loads(read_file(ap))
    except Exception:
        return None
    ids = anchor.get("ids", {})
    wp = {}
    for k, v in ids.items():
        if k.startswith("WP-"):
            s = v.get("status", "queued"); wp[s] = wp.get(s, 0) + 1
    gates = [v for k, v in ids.items() if k.startswith("G-") and v.get("kind") == "freeze_gate"]
    gate = {}
    for v in gates:
        s = v.get("status", "pending"); gate[s] = gate.get(s, 0) + 1
    designs = anchor.get("designs", {})
    subs = anchor.get("subplans", {})
    # drift: any tracked doc whose on-disk hash diverged (or vanished)
    drift = False
    for rel, meta in anchor.get("docs", {}).items():
        f = os.path.join(plan_dir, rel)
        if not os.path.exists(f) or sha256_text(read_file(f)) != meta.get("hash"):
            drift = True; break
    return {
        "slug": name, "path": name, "title": _plan_title(plan_dir, anchor),
        "profile": anchor.get("profile"), "goal": anchor.get("goal"),
        "updated": (anchor.get("updated") or "")[:10],
        "wps": {"total": sum(wp.values()), **wp},
        "gates": {"total": len(gates), **gate},
        "designs": {"total": len(designs), "locked": sum(1 for x in designs.values() if x.get("locked"))},
        "subplans": {"total": len(subs), "active": sum(1 for x in subs.values() if x.get("status", "active") == "active")},
        "research": {k: v.get("stamped") for k, v in anchor.get("research", {}).items()},
        "drift": drift,
        "has": {"board": os.path.exists(os.path.join(plan_dir, "artifact", "board.html")),
                "explorer": os.path.exists(os.path.join(plan_dir, "artifact", "explorer.html")),
                "livingspec": os.path.exists(os.path.join(plan_dir, "artifact", "index.html"))},
    }


def cmd_plans_index_data(args):
    root = args.plans_dir
    plans = []
    try:
        entries = sorted(os.listdir(root))
    except OSError:
        entries = []
    for name in entries:
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        r = _plan_rollup(d, name)
        if r is not None:
            plans.append(r)
    by_profile = {}
    for p in plans:
        by_profile[p["profile"]] = by_profile.get(p["profile"], 0) + 1
    emit({
        "root": {"name": os.path.basename(os.path.normpath(root)), "path": root},
        "plans": plans,
        "stats": {"count": len(plans), "by_profile": by_profile,
                  "wps_total": sum(p["wps"]["total"] for p in plans),
                  "wps_done": sum(p["wps"].get("done", 0) for p in plans),
                  "drifted": sum(1 for p in plans if p["drift"])},
    })


def cmd_write_region_plain(args):
    """Splice a fenced region in a STANDALONE file (no .groundwork.json anchor) —
    for the cross-plan plans-index, which spans many plans and is owned by none.
    Idempotent: compares the new content (excluding the meta line) to what's on
    disk and writes only if changed."""
    full = args.file
    fid = args.id
    new_content = (args.content if args.content is not None else read_file(args.content_file)).strip("\n")
    if getattr(args, "html_script_safe", False):
        new_content = _html_script_escape(new_content)
    text = read_file(full)
    r = find_region(text, fid)
    if r is None:
        die(f"fence '{fid}' not found in {full}", 1)
    (s0, s1), (e0, e1), inner = r
    if _strip_meta(inner).strip() == new_content.strip():
        emit({"result": "UNCHANGED", "file": full, "id": fid}); return
    start_line = text[s0:s1]
    if start_line.lstrip().startswith("//"):
        meta = f"// last_action: plans-index · {_now()}"
    elif start_line.lstrip().startswith("#"):
        meta = f"# last_action: plans-index · {_now()}"
    else:
        meta = f"<!-- last_action: plans-index · {_now()} -->"
    new_text = text[:s1] + f"\n{meta}\n{new_content}\n" + text[e0:]
    atomic_write(full, new_text)
    emit({"result": "WRITTEN", "file": full, "id": fid})


# --------------------------------------------------------------------------- #
# command: living-spec-data
# --------------------------------------------------------------------------- #

# `## Phase N — <title>` heading in 05-tracking.md (or `## Phase N: <title>`).
_PHASE_HEAD_RE = re.compile(r"^##\s+Phase\s+(\d+(?:\.\d+)?)\s*[—:\-]\s*(.+?)\s*$", re.M)
# `### WP-<id> — <title>` heading underneath a phase.
_WP_HEAD_RE = re.compile(r"^###\s+WP-([A-Za-z0-9]+)\s*[—:\-]\s*(.+?)\s*$", re.M)
# `## Round N — <title> (<date>)` heading in 04-discussion.md.
_ROUND_HEAD_RE = re.compile(r"^##\s+Round\s+(\d+)\s*[—:\-]\s*(.+?)\s*$", re.M)
# Date inside parentheses at the end of a round heading: `… (2026-05-27)`.
_PAREN_DATE_RE = re.compile(r"\((\d{4}-\d{2}-\d{2})\)\s*$")
# `## Risks` section heading variants in 01-plan.md.
_RISKS_HEAD_RE = re.compile(r"^##\s+Risks(\s|\b|$)", re.M)
# Next H2 after a section we want to delimit on.
_NEXT_H2_RE = re.compile(r"^##\s", re.M)


def _read_optional(plan: str, rel: str) -> str | None:
    p = os.path.join(plan, rel)
    return read_file(p) if os.path.exists(p) else None


def _section_body(text: str, head_match: re.Match, *, stop_levels: tuple[int, ...] = (2,)) -> str:
    """Slice from the line after `head_match` up to the next heading at any of
    the given levels (default: next H2). stop_levels=(2, 3) stops at H2 or H3 —
    useful when slicing the body under a `### New risks folded` block so we
    don't bleed into the next `### Strengths to defend` section."""
    start = head_match.end()
    # Build a regex that matches `## ` or `### ` (etc.) per stop_levels.
    hashes = "|".join("#" * lvl for lvl in sorted(stop_levels))
    pat = re.compile(rf"^(?:{hashes})\s", re.M)
    nxt = pat.search(text, start)
    return text[start:nxt.start()] if nxt else text[start:]


def _roll_up_phase_status(wp_statuses: list[str]) -> str:
    """Roll WP statuses up to a phase status. Mirrors the convention used by the
    handful of plans that have hand-carved this so the action's auto-fill stays
    consistent."""
    if not wp_statuses:
        return "stub"
    s = set(wp_statuses)
    if s == {"done"}:
        return "shipped"
    if "in_progress" in s:
        return "in_progress"
    if "blocked" in s:
        return "queued"  # treat blocked as queued for phase-level rollup
    if s == {"queued"} or s == {"queued", "done"}:
        return "queued"
    if "done" in s and ("queued" in s or "in_progress" in s):
        return "in_progress"
    return "queued"


def _rounds_from_index(rounds_index_text: str) -> list[dict]:
    """Parse the rounds-index fence body — a markdown table. Returns one entry
    per data row with {round, date, topic, status}. Skips header + separator."""
    rounds = []
    for line in rounds_index_text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        # Skip header + separator (e.g. "| Round | …" and "| --- | …")
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        first = cells[0]
        if not first or first.lower() == "round" or set(first) <= set("-: "):
            continue
        try:
            rnd = int(first)
        except ValueError:
            continue
        date = cells[1] if len(cells) > 1 else ""
        topic = cells[2] if len(cells) > 2 else ""
        status = cells[3] if len(cells) > 3 else ""
        rounds.append({"round": rnd, "date": date, "topic": topic, "status": status})
    return rounds


def _severity_hint(line: str) -> str:
    low = line.lower()
    if "critical" in low:
        return "critical"
    if "important" in low or "blocker" in low:
        return "important"
    if "nice" in low or "nice-to-have" in low:
        return "nice"
    return "important"  # default — risks are usually important until proven otherwise


_BOLD_PREFIX_RE = re.compile(r"^\*\*([^*]+?)\*\*\s*(.*)$")


def _split_title_and_body(text: str) -> tuple[str, str]:
    """Risk bullets typically look like `**R6 — Contract freeze headline.** Mitigation: …`
    or `**Inventory bias.** P1 might over-classify …`. Split the bold prefix into
    a title (with any `R<n> —` / `G-NN —` ID-prefix stripped from the front) and
    return the remaining body unchanged. If there's no bold prefix, the whole
    text is the body and title is empty."""
    m = _BOLD_PREFIX_RE.match(text)
    if not m:
        return "", text
    title = m.group(1).strip().rstrip(".:")
    # Strip a leading ID prefix like "R6 —" / "G-VERB —" / "GAP-04 ·".
    id_strip = re.sub(r"^(?:R\d+|G(?:-[A-Z0-9_-]+|\d+)|GAP-\d+|E-\d+)\s*[—\-·:]\s*",
                      "", title)
    return id_strip or title, m.group(2).strip()


def _risk_bullets(risks_section_body: str, source_label: str) -> list[dict]:
    """Extract `- ` bullets from a §Risks section body, one per risk. Captures
    the first line of each bullet plus any continuation lines until the next
    bullet or blank line. Returns {title, body, severity_hint, source} per
    bullet; title is empty when the bullet has no `**bold prefix**`."""
    out = []
    cur = None

    def _finalize(entry: dict) -> dict:
        text = entry.pop("_raw")
        title, body = _split_title_and_body(text)
        entry["title"] = title
        entry["body"] = body
        # Severity hint is derived from the full text (title + body).
        entry["severity_hint"] = _severity_hint(text)
        return entry

    for raw in risks_section_body.splitlines():
        line = raw.rstrip()
        if not line.strip():
            if cur is not None:
                out.append(_finalize(cur))
                cur = None
            continue
        if re.match(r"^\s*[-*]\s+", line):
            if cur is not None:
                out.append(_finalize(cur))
            body = re.sub(r"^\s*[-*]\s+", "", line)
            cur = {"_raw": body, "source": source_label}
        elif cur is not None:
            cur["_raw"] += " " + line.strip()
    if cur is not None:
        out.append(_finalize(cur))
    return out


def cmd_living_spec_data(args):
    plan = args.plan
    anchor = load_anchor(plan)
    ids = anchor.get("ids", {})

    # ---- phases (05-tracking.md) ---- #
    phases = []
    tracking = _read_optional(plan, "05-tracking.md")
    if tracking:
        phase_matches = list(_PHASE_HEAD_RE.finditer(tracking))
        for i, pm in enumerate(phase_matches):
            phase_id_str = pm.group(1)
            phase_title = pm.group(2).strip()
            body_end = phase_matches[i + 1].start() if i + 1 < len(phase_matches) else len(tracking)
            phase_body = tracking[pm.end():body_end]
            wp_ids = []
            for wm in _WP_HEAD_RE.finditer(phase_body):
                wp_id = "WP-" + wm.group(1)
                wp_ids.append(wp_id)
            wp_statuses = []
            for wid in wp_ids:
                entry = ids.get(wid, {})
                if isinstance(entry, dict):
                    wp_statuses.append(entry.get("status", "queued"))
            status = _roll_up_phase_status(wp_statuses)
            phases.append({
                "id": f"P{phase_id_str}",
                "title": phase_title,
                "status": status,
                "wp_ids": wp_ids,
                "wp_statuses": wp_statuses,
            })

    # ---- rounds (04-discussion.md) ---- #
    rounds = []
    discussion = _read_optional(plan, "04-discussion.md")
    if discussion:
        # Prefer the rounds-index fence (canonical).
        r = find_region(discussion, "rounds-index")
        if r is not None:
            _, _, inner = r
            rounds = _rounds_from_index(_strip_meta(inner))
        # If the index fence is empty/absent, fall back to scanning round headings.
        if not rounds:
            head_matches = list(_ROUND_HEAD_RE.finditer(discussion))
            for hm in head_matches:
                rnd = int(hm.group(1))
                rest = hm.group(2).strip()
                date = ""
                pm = _PAREN_DATE_RE.search(rest)
                if pm:
                    date = pm.group(1)
                    rest = _PAREN_DATE_RE.sub("", rest).strip()
                rounds.append({"round": rnd, "date": date, "topic": rest, "status": ""})
            rounds.sort(key=lambda x: x["round"], reverse=True)
        # Attach a body anchor (the heading text, useful for the agent to grep on).
        for entry in rounds:
            entry["heading_line"] = f"Round {entry['round']}"

    # ---- risks (01-plan.md §Risks + §New risks folded in 04 rounds) ---- #
    risks_raw = []
    plan_md = _read_optional(plan, "01-plan.md")
    if plan_md:
        rm = _RISKS_HEAD_RE.search(plan_md)
        if rm:
            section_body = _section_body(plan_md, rm)
            risks_raw.extend(_risk_bullets(section_body, "01-plan §Risks"))
    # Also pull `### New risks folded` blocks from 04-discussion (any round).
    # Stop at the next H2 OR sibling H3 so we don't bleed into "Strengths to
    # defend" / "Plan files touched" / etc.
    if discussion:
        for m in re.finditer(r"^###\s+New risks folded\s*$", discussion, re.M):
            head_above = None
            for rh in _ROUND_HEAD_RE.finditer(discussion[:m.start()]):
                head_above = rh
            label = f"Round {head_above.group(1)} §New risks folded" if head_above else "04 §New risks folded"
            section_body = _section_body(discussion, m, stop_levels=(2, 3))
            risks_raw.extend(_risk_bullets(section_body, label))

    # ---- ids_summary ---- #
    from collections import Counter
    wp_status_counter = Counter()
    gate_status_counter = Counter()
    gap_status_counter = Counter()
    for k, v in ids.items():
        if not isinstance(v, dict):
            continue
        kind = v.get("kind", "")
        if kind == "work_package" or k.startswith("WP-"):
            wp_status_counter[v.get("status", "queued")] += 1
        elif kind == "freeze_gate":
            gate_status_counter[v.get("status", "pending")] += 1
        elif kind == "gap" or (k.startswith("G-") and kind != "freeze_gate"):
            gap_status_counter[v.get("status", "open")] += 1

    plan_slug = os.path.basename(os.path.normpath(plan))
    emit({
        "plan": {
            "title": _plan_title(plan, anchor),
            "slug": plan_slug,
            "profile": anchor.get("profile"),
            "goal": anchor.get("goal"),
        },
        "generated_at": _now(),
        "phases": phases,
        "rounds": rounds,
        "risks_raw": risks_raw,
        "ids_summary": {
            "wps": dict(wp_status_counter),
            "gates": dict(gate_status_counter),
            "gaps": dict(gap_status_counter),
        },
    })


# --------------------------------------------------------------------------- #
# argparse wiring
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="groundwork_state.py", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("spine-gate", help="run the spine-version preamble gate")
    g.add_argument("--plan", required=True)
    g.add_argument("--expected", required=True)
    g.add_argument("--readonly", action="store_true")
    g.set_defaults(func=cmd_spine_gate)

    g = sub.add_parser("validate-profile", help="run the 10-rule conformance gate")
    g.add_argument("--profiles-root", required=True)
    g.add_argument("--name")
    g.add_argument("--all", action="store_true")
    g.set_defaults(func=cmd_validate_profile)

    g = sub.add_parser("resolve-profile", help="merge a profile over _shared")
    g.add_argument("--profiles-root", required=True)
    g.add_argument("--name", required=True)
    g.set_defaults(func=cmd_resolve_profile)

    g = sub.add_parser("read-anchor", help="print .groundwork.json (validates)")
    g.add_argument("--plan", required=True)
    g.set_defaults(func=cmd_read_anchor)

    g = sub.add_parser("scaffold", help="resolve+render the spine, write anchor (idempotent)")
    g.add_argument("--plan", required=True)
    g.add_argument("--profiles-root", required=True)
    g.add_argument("--profile", required=True)
    g.add_argument("--goal", required=True)
    g.add_argument("--force", action="store_true")
    g.set_defaults(func=cmd_scaffold)

    g = sub.add_parser("read-region", help="print a fence region's inner content")
    g.add_argument("--file", required=True)
    g.add_argument("--id", required=True)
    g.set_defaults(func=cmd_read_region)

    g = sub.add_parser("write-region", help="hash-diff write into a fence region")
    g.add_argument("--plan", required=True)
    g.add_argument("--file", required=True, help="path relative to --plan")
    g.add_argument("--id", required=True)
    g.add_argument("--action", required=True)
    g.add_argument("--content")
    g.add_argument("--content-file")
    g.add_argument("--force", action="store_true")
    g.add_argument("--html-script-safe", action="store_true",
                   help="escape </script>-breaking chars (<>&) — for JSON written into an HTML <script> fence")
    g.set_defaults(func=cmd_write_region)

    g = sub.add_parser("next-id", help="compute the next free ID of a kind")
    g.add_argument("--plan", required=True)
    g.add_argument("--kind", required=True, choices=["gap", "wp", "gate", "design"])
    g.add_argument("--name")
    g.set_defaults(func=cmd_next_id)

    g = sub.add_parser("stamp-research", help="set a research freshness stamp in the anchor")
    g.add_argument("--plan", required=True)
    g.add_argument("--file", required=True)
    g.add_argument("--date")
    g.set_defaults(func=cmd_stamp_research)

    g = sub.add_parser("register-subplan", help="register a sub-plan in the anchor")
    g.add_argument("--plan", required=True)
    g.add_argument("--file", required=True, help="e.g. 06-foo.md")
    g.add_argument("--archetype", required=True, choices=["diff-plan", "decision-doc", "bug-doc"])
    g.add_argument("--topic", required=True)
    g.add_argument("--ref")
    g.set_defaults(func=cmd_register_subplan)

    g = sub.add_parser("register-id", help="register an ID in the anchor")
    g.add_argument("--plan", required=True)
    g.add_argument("--id", required=True)
    g.add_argument("--doc", required=True)
    g.add_argument("--field", action="append")
    g.set_defaults(func=cmd_register_id)

    g = sub.add_parser("board-data", help="emit the board data model")
    g.add_argument("--plan", required=True)
    g.add_argument("--with-briefs", action="store_true",
                   help="include per-WP brief (parsed from 09-orchestration.md) + tier; "
                        "feeds the orchestrate --emit-workflow generator")
    g.set_defaults(func=cmd_board_data)

    g = sub.add_parser("status-data", help="emit the computed status model")
    g.add_argument("--plan", required=True)
    g.add_argument("--profiles-root")
    g.set_defaults(func=cmd_status_data)

    g = sub.add_parser("explorer-data",
                       help="emit the typed file-tree model for artifact/explorer.html "
                            "(embeds markdown/text/code under a size budget; references "
                            "html/design/image/pdf by relative path)")
    g.add_argument("--plan", required=True)
    g.set_defaults(func=cmd_explorer_data)

    g = sub.add_parser("plans-index-data",
                       help="emit a cross-plan rollup of every groundwork plan under a plans/ dir")
    g.add_argument("--plans-dir", required=True)
    g.set_defaults(func=cmd_plans_index_data)

    g = sub.add_parser("write-region-plain",
                       help="splice a fence in a standalone file (no anchor) — idempotent; for plans-index")
    g.add_argument("--file", required=True)
    g.add_argument("--id", required=True)
    g.add_argument("--content")
    g.add_argument("--content-file")
    g.add_argument("--html-script-safe", action="store_true",
                   help="escape </script>-breaking chars (<>&) — for JSON written into an HTML <script> fence")
    g.set_defaults(func=cmd_write_region_plain)

    g = sub.add_parser("living-spec-data",
                       help="emit the structured skeleton for the spec-state fence "
                            "(phases from 05, rounds from 04 rounds-index, risks from 01 §Risks)")
    g.add_argument("--plan", required=True)
    g.set_defaults(func=cmd_living_spec_data)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
