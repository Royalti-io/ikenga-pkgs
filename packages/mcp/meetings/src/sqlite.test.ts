import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertInScope, tablesReferenced, ALLOWED_TABLES } from './sqlite.js';

/**
 * A pkg's backend process opens ikenga.db with full read/write over every
 * table — there is no scoped accessor for it the way `host.dbQuery` scopes the
 * iframe. These tests pin the in-code guard that re-imposes the manifest scope.
 * Fabricated rows were written into the user's real database earlier in this
 * plan's history through exactly this unguarded path.
 */
describe('meetings pkg sqlite scope guard', () => {
  it('allows the pkg its own tables', () => {
    for (const t of ALLOWED_TABLES) {
      assertInScope(`SELECT * FROM ${t} WHERE id = ?`);
    }
  });

  it('refuses tables belonging to other domains', () => {
    for (const sql of [
      'SELECT * FROM tasks',
      'INSERT INTO email_index (id) VALUES (?)',
      'UPDATE deals SET amount = ?',
      'DELETE FROM _pa_migrations',
    ]) {
      assert.throws(() => assertInScope(sql), /may not touch table/, sql);
    }
  });

  it('catches a joined table, not just the leading one', () => {
    assert.throws(
      () => assertInScope('SELECT * FROM meetings JOIN tasks ON tasks.id = meetings.id'),
      /tasks/
    );
  });

  it('extracts every referenced table', () => {
    const t = tablesReferenced('SELECT * FROM meetings JOIN meeting_speakers ON 1=1');
    assert.ok(t.includes('meetings'));
    assert.ok(t.includes('meeting_speakers'));
  });
});
