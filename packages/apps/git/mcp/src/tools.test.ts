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
