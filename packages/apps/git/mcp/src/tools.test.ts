/**
 * `tools.ts` — the G-MCP tool surface is exactly what was signed off.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOLS } from './tools.js';
import { MCP_TOOLS, RpcSpec, type RpcMethod } from '../../core/src/rpc.js';

test('TOOLS is exactly the frozen G-MCP list — 6 read + 1 mutating (git_commit)', () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [...MCP_TOOLS].sort());
  assert.equal(TOOLS.length, 7);
});

test('every tool declares required "repo" and forbids additionalProperties', () => {
  for (const t of TOOLS) {
    const schema = t.inputSchema as { required?: string[]; additionalProperties?: boolean };
    assert.ok(schema.required?.includes('repo'), `${t.name} must require repo`);
    assert.equal(schema.additionalProperties, false, `${t.name} must reject unknown args`);
  }
});

test('exactly one tool maps to a mutating RpcSpec method, and it is git_commit', () => {
  const mutatingMethods = (Object.keys(RpcSpec) as RpcMethod[]).filter(
    (m) => RpcSpec[m].mutating && RpcSpec[m].mcp !== null
  );
  assert.equal(mutatingMethods.length, 1);
  assert.equal(RpcSpec[mutatingMethods[0] as RpcMethod].mcp, 'git_commit');
});

test('git_commit requires a non-empty paths array in its JSON schema', () => {
  const commit = TOOLS.find((t) => t.name === 'git_commit');
  assert.ok(commit);
  const props = (commit.inputSchema as { properties: Record<string, unknown> }).properties;
  const paths = props.paths as { minItems?: number };
  assert.equal(paths.minItems, 1);
});

test('git_commit HANDLER rejects `paths: []` before it can reach git', async () => {
  // The declared `minItems: 1` is what a well-behaved MCP client enforces.
  // This drives the handler directly with the payload a client that ignores
  // the schema would send, because that is the caller this tool has to
  // survive (01-plan.md §MCP threat model: the MCP path escapes the shell).
  // The refusal happens before `resolveRepo`, so no repo and no bridge are
  // needed — and the deliberately bogus `repo` below proves it: if the guard
  // ever moved after resolution, this call would fail on `repo-not-known`
  // instead.
  const commit = TOOLS.find((t) => t.name === 'git_commit');
  assert.ok(commit);
  const res = await commit.handler({
    repo: '/definitely/not/a/known/root',
    paths: [],
    message: 'x',
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unsafe-argument');
  assert.match(res.message as string, /at least one explicit path/);
});
