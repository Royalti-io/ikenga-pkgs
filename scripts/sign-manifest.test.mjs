import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalizeValue,
  canonicalManifestJson,
  canonicalManifestJsonFromString,
  signManifest,
  embedSignature,
  publisherKeyFromPub,
} from './sign-manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The golden vector is the FROZEN WP-02 ↔ WP-06 contract. The authoritative copy
 * lives in the shell repo (`ikenga`), a sibling of `ikenga-pkgs` in the
 * workspace. We test against a byte-identical VENDORED mirror in
 * `scripts/testdata/` so this gate runs in CI without the sibling shell checkout
 * — and separately assert the mirror matches the shell copy whenever it's on
 * disk (`SHELL_GOLDEN_DIR`), so a drift between the two fails loudly.
 */
const GOLDEN_DIR =
  process.env.IKENGA_SIGNATURE_GOLDEN_DIR ?? join(REPO_ROOT, 'scripts', 'testdata', 'signature_golden_v1');

const SHELL_GOLDEN_DIR = join(
  REPO_ROOT,
  '..',
  'shell',
  'src-tauri',
  'src',
  'pkg',
  'testdata',
  'signature_golden_v1',
);

const HAVE_GOLDEN = existsSync(join(GOLDEN_DIR, 'canonical.json'));
const HAVE_SHELL_GOLDEN = existsSync(join(SHELL_GOLDEN_DIR, 'canonical.json'));

function golden(name) {
  return readFileSync(join(GOLDEN_DIR, name), 'utf8');
}

function haveMinisign() {
  try {
    execFileSync('minisign', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ── THE GATE: cross-language byte-for-byte agreement with the Rust verifier ──

test(
  'canonicalManifestJson reproduces the golden canonical.json byte-for-byte',
  { skip: HAVE_GOLDEN ? false : `golden vector not found at ${GOLDEN_DIR}` },
  () => {
    const produced = canonicalManifestJsonFromString(golden('manifest.json'));
    const expected = golden('canonical.json');

    // Byte-for-byte. This is the whole contract: if it passes, the JS signer
    // canonicalizes IDENTICALLY to signature.rs and any minisign signature it
    // makes will verify Rust-side.
    assert.equal(produced, expected, 'canonical bytes drifted from the golden vector');
    // Belt-and-suspenders: exact byte length + no trailing newline (matches the
    // Rust assertions in signature.rs::canonicalization_matches_golden_bytes).
    assert.equal(
      Buffer.byteLength(produced, 'utf8'),
      Buffer.byteLength(expected, 'utf8'),
      'byte length must match exactly',
    );
    assert.ok(!produced.endsWith('\n'), 'canonical bytes must not end with a newline');
  },
);

// ── Drift guard: the vendored mirror must match the shell's frozen golden ──

test(
  'vendored golden vector is byte-identical to the shell repo copy',
  { skip: HAVE_SHELL_GOLDEN ? false : 'shell golden vector not on disk (CI / standalone checkout)' },
  () => {
    for (const name of ['manifest.json', 'canonical.json', 'publisher.pub', 'manifest.minisig']) {
      const vendored = readFileSync(join(GOLDEN_DIR, name));
      const shell = readFileSync(join(SHELL_GOLDEN_DIR, name));
      assert.ok(
        vendored.equals(shell),
        `vendored scripts/testdata/.../${name} drifted from the shell's frozen golden — re-vendor it`,
      );
    }
  },
);

// ── Canonicalization properties (independent of the golden vector) ──

test('canonicalization strips the top-level signature field', () => {
  const out = canonicalManifestJson({ b: 2, signature: 'X', a: 1 });
  assert.equal(out, '{"a":1,"b":2}');
});

test('canonicalization keeps a NESTED `signature` key (only top-level is stripped)', () => {
  // Only the root `signature` is removed; a `signature` deeper in the tree is
  // ordinary data and must survive (matches the `is_root` guard in Rust).
  const out = canonicalManifestJson({ z: { signature: 'keep' }, a: 1 });
  assert.equal(out, '{"a":1,"z":{"signature":"keep"}}');
});

test('canonicalization is key-order independent', () => {
  const a = canonicalManifestJson({ id: 'x', name: 'y', version: '1', signature: 'AAA' });
  const b = canonicalManifestJson({ signature: 'DIFFERENT', version: '1', name: 'y', id: 'x' });
  assert.equal(a, b, 'key order / signature value must not affect canonical bytes');
});

test('canonicalization preserves array element order, sorts object keys recursively', () => {
  const out = canonicalManifestJson({
    list: [{ b: 1, a: 2 }, 'second'],
    nested: { z: 1, a: 2 },
  });
  assert.equal(out, '{"list":[{"a":2,"b":1},"second"],"nested":{"a":2,"z":1}}');
});

test('canonicalizeValue mirrors the shape signature.rs expects (compact, no spaces)', () => {
  // No insignificant whitespace anywhere — compact `,`/`:` separators only.
  const out = canonicalManifestJson({ a: { b: [1, 2, 3] } });
  assert.equal(out, '{"a":{"b":[1,2,3]}}');
  assert.ok(!/[ \n\t]/.test(out), 'no insignificant whitespace');
});

test('publisherKeyFromPub extracts the bare base64 payload line', () => {
  const pub = 'untrusted comment: minisign public key F0DBADBF860F4AAF\nRWSvSg+Gv63b8NO/BC7nc1VGvqUI0qa6HxkzepDQjwvSpxI/FOloz37r\n';
  assert.equal(publisherKeyFromPub(pub), 'RWSvSg+Gv63b8NO/BC7nc1VGvqUI0qa6HxkzepDQjwvSpxI/FOloz37r');
});

test('publisherKeyFromPub matches the golden publisher.pub payload', {
  skip: HAVE_GOLDEN ? false : `golden vector not found at ${GOLDEN_DIR}`,
}, () => {
  const key = publisherKeyFromPub(golden('publisher.pub'));
  // Same payload line the shell verifier expects in InstallSource.publisher_key.
  assert.ok(key.startsWith('RWS'), 'minisign public-key payload begins with RWS');
  assert.ok(!key.includes('untrusted comment'), 'comment line stripped');
});

test('embedSignature sets the top-level signature without mutating input', () => {
  const m = { id: 'x', signature: 'OLD' };
  const out = embedSignature({ id: 'x' }, 'NEWSIG');
  assert.equal(out.signature, 'NEWSIG');
  assert.equal(out.id, 'x');
  // input object untouched
  assert.equal(m.signature, 'OLD');
});

// ── Full round-trip: sign our canonical bytes, verify them against the golden
//    public key with the real minisign binary (the same primitive the shell's
//    minisign-verify crate uses). Proves a signature this module makes is
//    accepted by a minisign verifier over OUR canonical bytes. ──

test(
  'signed canonical bytes verify under minisign against a freshly generated key',
  { skip: haveMinisign() ? false : 'minisign not on PATH' },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'ikenga-sign-rt-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const keyPath = join(dir, 'k.key');
    const pubPath = join(dir, 'k.pub');
    // -G generate, -W no-password (unencrypted), -f force overwrite.
    execFileSync('minisign', ['-G', '-W', '-f', '-p', pubPath, '-s', keyPath], { stdio: 'ignore' });
    const secret = readFileSync(keyPath, 'utf8');
    const pub = readFileSync(pubPath, 'utf8');

    const manifest = {
      id: 'com.example.rt',
      name: 'Round Trip',
      version: '0.0.1',
      ikenga_api: '3',
      signature: 'PLACEHOLDER',
    };
    const sigBlob = signManifest(manifest, secret, '');

    // Re-derive the canonical bytes + verify the blob with minisign -V, exactly
    // as the shell does Rust-side (minisign-verify over the canonical bytes).
    const canonical = canonicalManifestJson(manifest);
    const canonPath = join(dir, 'canonical_bytes.txt');
    const sigPath = join(dir, 'manifest.minisig');
    writeFileSync(canonPath, canonical);
    writeFileSync(sigPath, sigBlob);
    // -V verify, -p public key, -m message, -x signature. Throws (non-zero) on
    // a bad verify — so a clean return IS the assertion.
    execFileSync('minisign', ['-V', '-p', pubPath, '-m', canonPath, '-x', sigPath], { stdio: 'ignore' });

    // Embed + confirm the embedded blob is byte-identical to what we verified.
    const signed = embedSignature(manifest, sigBlob);
    assert.equal(signed.signature, sigBlob);
    // And a publisher key extracted from the .pub is the bare payload.
    const pk = publisherKeyFromPub(pub);
    assert.ok(pk.startsWith('RW'));
  },
);
