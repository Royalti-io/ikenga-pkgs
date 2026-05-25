// Triage / Health view — ported from routes/tasks/_components/-triage-view.tsx.

import { html, cn, useMemo, useQuery } from '../../lib/ui.js';
import { triageCountsQuery } from '../../lib/queries.js';
import {
  assigneeIsAgent,
  avatarInitial,
  buildTriage,
  dueLabel,
  priorityClass,
  relativeAgo,
} from '../../lib/shared.js';

/** @typedef {import('../../lib/queries.js').Task} Task */
/** @typedef {import('../../lib/queries.js').TriageCounts} TriageCounts */
/** @typedef {import('../../lib/shared.js').TriageBucketKey} TriageBucketKey */

/** @type {Array<{ key: TriageBucketKey, label: string, sub: string, cls: string }>} */
const STAT_META = [
  { key: 'overdue', label: 'Overdue', sub: 'past due', cls: 'is-danger' },
  { key: 'stale', label: 'Stale > 7d', sub: 'no activity', cls: 'is-warn' },
  { key: 'unassigned', label: 'Unassigned', sub: 'no owner', cls: 'is-sys' },
  { key: 'blocked', label: 'Blocked', sub: 'awaiting dep', cls: 'is-danger' },
];

/** @param {{ task: Task }} props */
function MiniRow({ task }) {
  const isAgent = assigneeIsAgent(task);
  const due = dueLabel(task.due_date);
  const stale = relativeAgo(task.updated_at);
  return html`
    <div class="tr-mini">
      <span class=${cn('pri-dot', priorityClass(task.priority))}></span>
      <span class="title">${task.title}</span>
      ${task.assigned_to
        ? html`
            <span class=${cn('tk-assignee', isAgent && 'is-agent')}>
              ${isAgent
                ? html`<span class="dot"></span>`
                : html`<span class="avatar">${avatarInitial(task.assigned_to)}</span>`}
              ${task.assigned_to}
            </span>
          `
        : html`<span class="tk-execmode is-approval_required">needs owner</span>`}
      <span class=${cn('age', due.cls === 'is-overdue' && 'is-bad')}>
        ${due.cls === 'is-overdue' ? due.label : stale}
      </span>
    </div>
  `;
}

/** @param {{ listTasks: Task[] }} props */
export function TriageView({ listTasks }) {
  const { data: counts } = useQuery(triageCountsQuery());
  const buckets = useMemo(() => buildTriage(listTasks), [listTasks]);

  /** @param {TriageBucketKey} k @returns {number|null} */
  const countFor = (k) => (counts ? counts[k] : null);
  const needAttention = counts ? counts.needsAttention : null;

  return html`
    <div class="tr-wrap">
      <div class="tr-stats">
        ${STAT_META.map((s) => {
          const n = countFor(s.key);
          return html`
            <div key=${s.key} class=${cn('tr-stat', s.cls)}>
              <div class="n">${n ?? '—'}</div>
              <div class="k">${s.label}</div>
              <div class="sub">${s.sub}</div>
            </div>
          `;
        })}
      </div>

      ${buckets.map((b) => {
        const total = countFor(b.key);
        if (b.sample.length === 0 && (total == null || total === 0)) return null;
        return html`
          <div key=${b.key} class="tr-bucket">
            <div class="tr-bucket-head">
              ${b.label}
              <span class="ct">${total ?? b.sample.length}</span>
            </div>
            ${b.sample.length > 0
              ? html`
                  ${b.sample.map((t) => html`<${MiniRow} key=${t.id} task=${t} />`)}
                  ${total != null && total > b.sample.length && html`
                    <div class="tr-more">showing ${b.sample.length} of ${total}</div>
                  `}
                `
              : html`<div class="tr-more">${total} match — not in the current list view</div>`}
          </div>
        `;
      })}

      <div class="tr-health">
        <span class="score">${healthGrade(counts)}</span>
        <span>
          <b style=${{ color: 'var(--fg)' }}>Backlog health.</b>${' '}
          ${needAttention != null
            ? `${needAttention} need attention (overdue + unassigned).`
            : 'Computing…'}${' '}
          Clear the overdue items and the sidebar${' '}
          <span style=${{ color: 'var(--achievement)' }}>Overdue</span> badge drops to 0.
        </span>
      </div>
    </div>
  `;
}

/**
 * @param {TriageCounts|undefined} c
 * @returns {string}
 */
function healthGrade(c) {
  if (!c) return '·';
  const pressure = c.overdue * 2 + c.unassigned + c.blocked;
  if (pressure === 0) return 'A';
  if (pressure <= 3) return 'A-';
  if (pressure <= 6) return 'B+';
  if (pressure <= 10) return 'B';
  return 'C';
}
