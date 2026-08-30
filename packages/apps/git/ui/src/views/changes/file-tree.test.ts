import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileTree, countTreeFiles } from './file-tree.js';
import type { FileChange } from '../../app/rpc';

const mockFile = (path: string): FileChange => ({
  path,
  origPath: null,
  kind: 'ordinary',
  staged: '.',
  unstaged: 'M',
  score: null,
  submodule: null,
  added: 1,
  deleted: 1,
  binary: false,
});

test('buildFileTree: builds hierarchical directory tree with compaction', () => {
  const files: FileChange[] = [
    mockFile('packages/apps/git/src/index.ts'),
    mockFile('packages/apps/git/src/utils/helpers.ts'),
    mockFile('package.json'),
  ];

  const tree = buildFileTree(files, 'unstaged');

  assert.equal(tree.length, 2);
  assert.equal(tree[0]?.isDir, true);
  assert.equal(tree[0]?.name, 'packages/apps/git/src'); // single child chain compacted
  assert.equal(tree[1]?.isDir, false);
  assert.equal(tree[1]?.name, 'package.json');

  const pkgSrcChildren = tree[0]?.children ?? [];
  assert.equal(pkgSrcChildren.length, 2);
  assert.equal(pkgSrcChildren[0]?.name, 'utils');
  assert.equal(pkgSrcChildren[1]?.name, 'index.ts');

  assert.equal(countTreeFiles(tree), 3);
});
