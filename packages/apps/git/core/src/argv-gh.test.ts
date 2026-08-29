import test from 'node:test';
import assert from 'node:assert/strict';
import { ghPrList, ghPrCheckout, ghPrCreate } from './argv-gh.js';

test('ghPrList: builds valid gh pr list command', () => {
  const res = ghPrList({ state: 'open', limit: 10 });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.argv, [
      'pr',
      'list',
      '--json',
      'number,title,author,headRefName,baseRefName,isDraft,url,updatedAt,reviewDecision,state,body,comments,additions,deletions,changedFiles,labels',
      '--state',
      'open',
      '--limit',
      '10',
    ]);
  }
});

test('ghPrCheckout: validates positive PR number', () => {
  const bad = ghPrCheckout({ number: -1 });
  assert.equal(bad.ok, false);

  const good = ghPrCheckout({ number: 42 });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.deepEqual(good.argv, ['pr', 'checkout', '42']);
  }
});

test('ghPrCreate: builds pr create command with title and body', () => {
  const res = ghPrCreate({ title: 'Fix bug', body: 'Resolves #12', base: 'main', draft: true });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.argv, ['pr', 'create', '--title', 'Fix bug', '--body', 'Resolves #12', '--base', 'main', '--draft']);
  }
});
