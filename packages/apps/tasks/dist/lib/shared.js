// Pure transforms + label helpers — ported from src/routes/tasks/-_shared.ts.
// Types carried via JSDoc; imports the Task typedef from queries.js.

/** @typedef {import('./queries.js').Task} Task */
/** @typedef {import('./queries.js').TaskPriority} TaskPriority */
/** @typedef {import('./queries.js').TaskStatus} TaskStatus */

/** @typedef {'full'|'compact'|'side'} Density */
/** @typedef {'overdue'|'today'|'week'|'later'|'autoclosed'} GroupKey */
/** @typedef {{ key: GroupKey, label: string, tasks: Task[] }} TaskGroup */

const ONE_DAY = 24 * 60 * 60 * 1000;

/** @param {Date} d */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * @param {Task[]} tasks
 * @param {boolean} showAutoclosed
 * @returns {TaskGroup[]}
 */
export function groupTasks(tasks, showAutoclosed) {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + ONE_DAY);
  const weekEnd = new Date(today.getTime() + 7 * ONE_DAY);

  /** @type {Task[]} */ const overdue = [];
  /** @type {Task[]} */ const todayG = [];
  /** @type {Task[]} */ const week = [];
  /** @type {Task[]} */ const later = [];
  /** @type {Task[]} */ const autoclosed = [];

  for (const t of tasks) {
    const isAutoClosedT =
      t.status === 'completed' &&
      !!t.outcome_notes &&
      t.outcome_notes.startsWith('Auto-closed by task-health');
    if (isAutoClosedT) {
      if (showAutoclosed) autoclosed.push(t);
      continue;
    }
    if (t.status === 'completed' || t.status === 'cancelled') continue;
    const due = t.due_date ? new Date(t.due_date) : null;
    if (!due) {
      later.push(t);
      continue;
    }
    if (due < today) overdue.push(t);
    else if (due < tomorrow) todayG.push(t);
    else if (due < weekEnd) week.push(t);
    else later.push(t);
  }

  /** @type {TaskGroup[]} */ const out = [];
  if (overdue.length) out.push({ key: 'overdue', label: 'Overdue', tasks: overdue });
  if (todayG.length) out.push({ key: 'today', label: 'Today', tasks: todayG });
  if (week.length) out.push({ key: 'week', label: 'This week', tasks: week });
  if (later.length) out.push({ key: 'later', label: 'Later', tasks: later });
  if (autoclosed.length)
    out.push({ key: 'autoclosed', label: 'Auto-closed', tasks: autoclosed });
  return out;
}

// ─── In-body view switcher (Round 16 · D-2 / D-3) ───────────────────────────
/** @typedef {'tasks'|'agenda'|'triage'} TaskView */

// ─── Agenda / Today (D-2) ────────────────────────────────────────────────────
/** @typedef {'me'|'agent'|'silent'|'deadline'} AgendaLane */
/** @typedef {{ task: Task, lane: AgendaLane, done: boolean }} AgendaBlock */
/** @typedef {{ key: string, time: string, hour: number, blocks: AgendaBlock[] }} AgendaSlot */

/**
 * @param {Task} t
 * @param {boolean} overdue
 * @returns {AgendaLane}
 */
function agendaLane(t, overdue) {
  if (overdue) return 'deadline';
  if (t.execution_mode === 'report') return 'silent';
  if (assigneeIsAgent(t)) return 'agent';
  return 'me';
}

/**
 * Project the already-fetched task list onto a time rail for *today* — overdue
 * items pulled to a leading bucket, the rest grouped by due-hour.
 * @param {Task[]} tasks
 * @param {Date} [now]
 * @returns {AgendaSlot[]}
 */
export function buildAgenda(tasks, now = new Date()) {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + ONE_DAY);

  /** @type {AgendaBlock[]} */ const overdueBlocks = [];
  /** @type {Map<number, AgendaBlock[]>} */ const byHour = new Map();

  for (const t of tasks) {
    if (t.status === 'cancelled') continue;
    const done = isAutoClosed(t) || t.status === 'completed';
    if (!t.due_date) continue; // no due → not on today's rail
    const due = new Date(t.due_date);
    if (due >= tomorrow) continue; // future days not shown on the Today rail
    if (due < today) {
      if (!done) overdueBlocks.push({ task: t, lane: agendaLane(t, true), done });
      continue;
    }
    const hour = due.getHours();
    /** @type {AgendaBlock} */ const block = { task: t, lane: agendaLane(t, false), done };
    const bucket = byHour.get(hour);
    if (bucket) bucket.push(block);
    else byHour.set(hour, [block]);
  }

  /** @type {AgendaSlot[]} */ const slots = [];
  if (overdueBlocks.length) {
    slots.push({ key: 'overdue', time: 'overdue', hour: -1, blocks: overdueBlocks });
  }
  for (const hour of [...byHour.keys()].sort((a, b) => a - b)) {
    slots.push({
      key: `${hour}:00`,
      time: `${String(hour).padStart(2, '0')}:00`,
      hour,
      blocks: /** @type {AgendaBlock[]} */ (byHour.get(hour)),
    });
  }
  return slots;
}

// ─── Triage / Health (D-3) ───────────────────────────────────────────────────
/** @typedef {'overdue'|'stale'|'unassigned'|'blocked'} TriageBucketKey */
/** @typedef {{ key: TriageBucketKey, label: string, sample: Task[] }} TriageBucket */

const STALE_DAYS = 7;

/**
 * @param {Task} t
 * @returns {boolean}
 */
function isActive(t) {
  return t.status === 'pending' || t.status === 'in_progress' || t.status === 'blocked';
}

/**
 * Client-side sample rows for each health bucket, from the loaded list.
 * @param {Task[]} tasks
 * @param {Date} [now]
 * @returns {TriageBucket[]}
 */
export function buildTriage(tasks, now = new Date()) {
  const today = startOfDay(now);
  const staleBefore = now.getTime() - STALE_DAYS * ONE_DAY;

  /** @type {Task[]} */ const overdue = [];
  /** @type {Task[]} */ const stale = [];
  /** @type {Task[]} */ const unassigned = [];
  /** @type {Task[]} */ const blocked = [];

  for (const t of tasks) {
    if (!isActive(t)) continue;
    if (t.due_date && new Date(t.due_date) < today) overdue.push(t);
    if (t.updated_at && new Date(t.updated_at).getTime() < staleBefore) stale.push(t);
    if (!t.assigned_to) unassigned.push(t);
    if (t.status === 'blocked') blocked.push(t);
  }

  /** @param {Task[]} xs */
  const cap = (xs) => xs.slice(0, 3);
  return [
    { key: 'overdue', label: 'Overdue', sample: cap(overdue) },
    { key: 'stale', label: `Stale · no activity > ${STALE_DAYS}d`, sample: cap(stale) },
    { key: 'unassigned', label: 'Unassigned', sample: cap(unassigned) },
    { key: 'blocked', label: 'Blocked', sample: cap(blocked) },
  ];
}

/**
 * Human label for an execution mode.
 * @param {Task['execution_mode']} m
 * @returns {string}
 */
export function execModeLabel(m) {
  if (!m) return '';
  if (m === 'approval_required') return 'approval req';
  if (m === 'report') return 'silent';
  return m;
}

/**
 * @param {TaskPriority|null|undefined} p
 * @returns {string}
 */
export function priorityClass(p) {
  if (!p) return 'is-low';
  return `is-${p}`;
}

/**
 * @param {TaskStatus} s
 * @returns {string}
 */
export function statusClass(s) {
  return `is-${s}`;
}

/**
 * @param {string|null} d
 * @returns {{ label: string, cls: string }}
 */
export function dueLabel(d) {
  if (!d) return { label: '—', cls: '' };
  const due = new Date(d);
  const now = new Date();
  const today = startOfDay(now);
  const dueDay = startOfDay(due);
  const dayDiff = Math.round((dueDay.getTime() - today.getTime()) / ONE_DAY);

  if (dueDay.getTime() < today.getTime()) {
    const overdueDays = Math.abs(dayDiff);
    return {
      label: overdueDays === 0 ? 'overdue' : `${overdueDays}d overdue`,
      cls: 'is-overdue',
    };
  }
  if (dayDiff === 0) {
    const hh = String(due.getHours()).padStart(2, '0');
    const mm = String(due.getMinutes()).padStart(2, '0');
    return { label: `today · ${hh}:${mm}`, cls: 'is-today' };
  }
  if (dayDiff < 7) {
    return {
      label: due.toLocaleDateString(undefined, { weekday: 'short' }),
      cls: '',
    };
  }
  return {
    label: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    cls: '',
  };
}

/**
 * @param {string|null} iso
 * @returns {string}
 */
export function relativeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * @param {Pick<Task, 'status'|'outcome_notes'>} t
 * @returns {boolean}
 */
export function isAutoClosed(t) {
  return (
    t.status === 'completed' &&
    !!t.outcome_notes &&
    t.outcome_notes.startsWith('Auto-closed by task-health')
  );
}

/**
 * @param {string|null} notes
 * @returns {string|null}
 */
export function autoCloseSignal(notes) {
  if (!notes) return null;
  if (!notes.startsWith('Auto-closed by task-health')) return null;
  // "Auto-closed by task-health: email_draft 4f12 sent ..."
  const lower = notes.toLowerCase();
  if (lower.includes('email_draft')) return 'email-sent';
  if (lower.includes('social_queue')) return 'social-posted';
  if (lower.includes('blog')) return 'blog-published';
  if (lower.includes('commit')) return 'git-commit';
  if (lower.includes('deal')) return 'deal-closed';
  return 'auto-closed';
}

/**
 * @param {string} id
 * @returns {string}
 */
export function shortId(id) {
  return id.slice(0, 8);
}

/**
 * @param {Task} t
 * @returns {boolean}
 */
export function assigneeIsAgent(t) {
  if (t.assignee_type === 'agent') return true;
  if (t.assignee_type === 'human') return false;
  return !!(t.assigned_to && t.assigned_to.endsWith('-agent'));
}

/**
 * @param {string|null} name
 * @returns {string}
 */
export function avatarInitial(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}
