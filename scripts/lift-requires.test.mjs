import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  frontmatter,
  parseDependsOn,
  computeRequires,
  requiresEqual,
  applyRequires,
  liftPackage,
} from './lift-requires.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(REPO_ROOT, 'packages', 'skills');

// ── frontmatter + depends_on parsing ────────────────────────────────────────

test('parseDependsOn: block list', () => {
  const fm = 'name: x\ndepends_on:\n  - skill-core\nallowed-tools: Read';
  assert.deepEqual(parseDependsOn(fm), ['skill-core']);
});

test('parseDependsOn: inline empty + inline list', () => {
  assert.deepEqual(parseDependsOn('depends_on: []'), []);
  assert.deepEqual(parseDependsOn('depends_on: [skill-core]'), ['skill-core']);
  assert.deepEqual(parseDependsOn('depends_on: [a, b]'), ['a', 'b']);
});

test('parseDependsOn: absent key → []', () => {
  assert.deepEqual(parseDependsOn('name: x\ndescription: y'), []);
});

test('frontmatter: extracts between fences', () => {
  assert.equal(frontmatter('---\nname: x\n---\nbody'), 'name: x');
  assert.equal(frontmatter('no frontmatter'), '');
});

// ── computeRequires against the REAL packages ───────────────────────────────

test('computeRequires: skill-pa lifts depends_on → [skill-core]', () => {
  assert.deepEqual(computeRequires(join(SKILLS, 'pa')), [
    { kind: 'skill', name: 'skill-core' },
  ]);
});

test('computeRequires: skill-core (the hub) → []', () => {
  assert.deepEqual(computeRequires(join(SKILLS, 'core')), []);
});

test('computeRequires: studio suite (9 SKILL.md, no depends_on) → []', () => {
  assert.deepEqual(computeRequires(join(SKILLS, 'studio-archetypes')), []);
});

// ── G-04 enforcement ────────────────────────────────────────────────────────

test('computeRequires: rejects a non-skill-core depends_on (G-04)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lift-g04-'));
  try {
    mkdirSync(join(dir, 'skills', 'bad'), { recursive: true });
    writeFileSync(
      join(dir, 'skills', 'bad', 'SKILL.md'),
      '---\nname: bad\ndepends_on:\n  - some-other-skill\n---\nbody\n',
    );
    assert.throws(() => computeRequires(dir), /G-04 violation/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeRequires: unions + dedupes across multiple SKILL.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lift-union-'));
  try {
    for (const n of ['a', 'b']) {
      mkdirSync(join(dir, 'skills', n), { recursive: true });
      writeFileSync(
        join(dir, 'skills', n, 'SKILL.md'),
        '---\nname: ' + n + '\ndepends_on:\n  - skill-core\n---\n',
      );
    }
    assert.deepEqual(computeRequires(dir), [{ kind: 'skill', name: 'skill-core' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── requiresEqual ───────────────────────────────────────────────────────────

test('requiresEqual: order-insensitive', () => {
  assert.ok(
    requiresEqual(
      [{ kind: 'skill', name: 'a' }, { kind: 'skill', name: 'b' }],
      [{ kind: 'skill', name: 'b' }, { kind: 'skill', name: 'a' }],
    ),
  );
  assert.ok(!requiresEqual([{ kind: 'skill', name: 'a' }], []));
});

// ── applyRequires (surgical text edit) ──────────────────────────────────────

const MANIFEST_NO_REQ = `{
  "id": "com.ikenga.x",
  "name": "X",
  "permissions": { "net": [] }
}
`;

test('applyRequires: inserts as last key, preserves the rest', () => {
  const out = applyRequires(MANIFEST_NO_REQ, [{ kind: 'skill', name: 'skill-core' }]);
  const obj = JSON.parse(out);
  assert.deepEqual(obj.requires, [{ kind: 'skill', name: 'skill-core' }]);
  // untouched keys preserved verbatim
  assert.ok(out.includes('"permissions": { "net": [] }'));
});

test('applyRequires: idempotent', () => {
  const once = applyRequires(MANIFEST_NO_REQ, [{ kind: 'skill', name: 'skill-core' }]);
  const twice = applyRequires(once, [{ kind: 'skill', name: 'skill-core' }]);
  assert.equal(once, twice);
});

test('applyRequires: empty strips an existing requires block', () => {
  const withReq = applyRequires(MANIFEST_NO_REQ, [{ kind: 'skill', name: 'skill-core' }]);
  const stripped = applyRequires(withReq, []);
  assert.equal(JSON.parse(stripped).requires, undefined);
});

test('applyRequires: carries source + ref when present', () => {
  const out = applyRequires(MANIFEST_NO_REQ, [
    { kind: 'skill', name: 'skill-core', source: 'npx', ref: 'v1.0.0' },
  ]);
  assert.deepEqual(JSON.parse(out).requires, [
    { kind: 'skill', name: 'skill-core', source: 'npx', ref: 'v1.0.0' },
  ]);
});

// ── --check drift detection (semantic, not byte) ────────────────────────────

test('liftPackage checkOnly: reports drift when manifest requires is stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lift-drift-'));
  try {
    mkdirSync(join(dir, 'skills', 's'), { recursive: true });
    writeFileSync(
      join(dir, 'skills', 's', 'SKILL.md'),
      '---\nname: s\ndepends_on:\n  - skill-core\n---\n',
    );
    // manifest claims NO requires, but SKILL.md declares the edge → drift
    writeFileSync(join(dir, 'manifest.json'), '{\n  "id": "com.ikenga.s",\n  "name": "S"\n}\n');
    const res = liftPackage(dir, { checkOnly: true });
    assert.equal(res.changed, true);
    // checkOnly must NOT write
    assert.ok(!readFileSync(join(dir, 'manifest.json'), 'utf8').includes('requires'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('liftPackage: no rewrite when requires already correct (no reformat churn)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lift-stable-'));
  try {
    mkdirSync(join(dir, 'skills', 's'), { recursive: true });
    writeFileSync(join(dir, 'skills', 's', 'SKILL.md'), '---\nname: s\ndepends_on: []\n---\n');
    // hand-compact manifest, already correct (no requires) — must stay byte-identical
    const original = '{ "id": "com.ikenga.s", "name": "S", "author": { "name": "R" } }\n';
    writeFileSync(join(dir, 'manifest.json'), original);
    const res = liftPackage(dir, {});
    assert.equal(res.changed, false);
    assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
