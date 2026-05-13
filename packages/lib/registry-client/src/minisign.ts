// Minisign verification for the Ikenga registry. Implements the subset of
// the minisign format that the publisher actually emits: prehashed (`ED`)
// signatures over BLAKE2b-512(content) using Ed25519.
//
// Spec: https://jedisct1.github.io/minisign/
//
// We intentionally do not verify the *global* signature (4th line of the
// .minisig file), because:
//   - It signs `data_signature || trusted_comment` and only protects the
//     trusted_comment from tampering. Our trust model treats the trusted
//     comment as informational, not load-bearing.
//   - Doing so would force every consumer to re-implement the concat rule
//     and pull a second Ed25519 verify into the hot path.

import * as ed from '@noble/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { sha512 } from '@noble/hashes/sha512';

// @noble/ed25519 v2 requires the consumer to wire a SHA-512 impl for HMAC use.
// Webview/Node both lack a sync sha512 by default; @noble/hashes provides one.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/** Algorithm bytes at the head of pubkey / signature payloads. */
const ALG_ED25519_LEGACY = new Uint8Array([0x45, 0x64]); // "Ed" — sign content directly
const ALG_ED25519_PREHASHED = new Uint8Array([0x45, 0x44]); // "ED" — sign BLAKE2b-512(content)

export interface MinisignPublicKey {
  /** 8-byte opaque id, used to match a signature to its key. */
  keyId: Uint8Array;
  /** Ed25519 public key (32 bytes). */
  publicKey: Uint8Array;
}

export interface MinisignSignature {
  /** 'pure' = legacy Ed prefix; 'prehashed' = ED prefix (BLAKE2b-512 of content). */
  algorithm: 'pure' | 'prehashed';
  keyId: Uint8Array;
  signature: Uint8Array; // 64 bytes
}

/**
 * Decode a minisign public key. Accepts either:
 *   - The two-line file format (`untrusted comment: ...\n<base64>\n`), or
 *   - The bare base64 payload line (what the shell embeds as a constant).
 *
 * Throws on malformed input.
 */
export function decodePublicKey(input: string): MinisignPublicKey {
  const b64 = extractBase64Line(input);
  const raw = base64Decode(b64);
  if (raw.length !== 42) {
    throw new Error(
      `minisign: public key payload must be 42 bytes, got ${raw.length}`,
    );
  }
  if (!bytesEqual(raw.subarray(0, 2), ALG_ED25519_LEGACY)) {
    throw new Error(
      `minisign: public key signature_algorithm must be "Ed" (legacy)`,
    );
  }
  return {
    keyId: raw.subarray(2, 10),
    publicKey: raw.subarray(10, 42),
  };
}

/**
 * Decode a `.minisig` file. Recognizes the two-line untrusted-comment +
 * base64-signature header; ignores trailing trusted-comment / global-sig
 * lines.
 */
export function decodeSignature(input: string): MinisignSignature {
  const lines = input.split(/\r?\n/);
  // Find the first non-comment, non-empty line: that's the data signature.
  let payloadLine: string | null = null;
  for (const line of lines) {
    if (!line || line.startsWith('untrusted comment:')) continue;
    payloadLine = line;
    break;
  }
  if (!payloadLine) {
    throw new Error('minisign: no signature payload found');
  }
  const raw = base64Decode(payloadLine);
  if (raw.length !== 74) {
    throw new Error(
      `minisign: signature payload must be 74 bytes, got ${raw.length}`,
    );
  }
  const algBytes = raw.subarray(0, 2);
  let algorithm: 'pure' | 'prehashed';
  if (bytesEqual(algBytes, ALG_ED25519_LEGACY)) {
    algorithm = 'pure';
  } else if (bytesEqual(algBytes, ALG_ED25519_PREHASHED)) {
    algorithm = 'prehashed';
  } else {
    throw new Error(
      `minisign: unknown signature algorithm 0x${hex(algBytes)} (expected Ed or ED)`,
    );
  }
  return {
    algorithm,
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10, 74),
  };
}

/**
 * Verify a minisign signature against content.
 *
 * @param content    Raw content bytes (e.g., the bytes of `index.json`).
 * @param sigFile    Contents of the `.minisig` file (as a string).
 * @param pubkey     Minisign public key (base64 line, with or without the
 *                   `untrusted comment:` header).
 * @returns          `true` on a valid signature, `false` otherwise. Throws on
 *                   malformed inputs.
 */
export async function verify(
  content: Uint8Array,
  sigFile: string,
  pubkey: string,
): Promise<boolean> {
  const pk = decodePublicKey(pubkey);
  const sig = decodeSignature(sigFile);
  if (!bytesEqual(pk.keyId, sig.keyId)) {
    return false; // sig was made with a different key
  }
  const message =
    sig.algorithm === 'prehashed' ? blake2b(content, { dkLen: 64 }) : content;
  return ed.verify(sig.signature, message, pk.publicKey);
}

// ---------- helpers ----------

function extractBase64Line(input: string): string {
  const trimmed = input.trim();
  // If multiline, drop comment lines and grab the first payload line.
  if (trimmed.includes('\n')) {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line || line.startsWith('untrusted comment:')) continue;
      return line;
    }
    throw new Error('minisign: input contains no base64 payload line');
  }
  return trimmed;
}

function base64Decode(b64: string): Uint8Array {
  // `atob` is a WHATWG global in browsers/Tauri webview and in Node 16+.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
