// Content main view — Pipeline (kanban default + list toggle) / Calendar / Published.
//
// Composition follows plans/atelier-design-system/parts/screens/content.md §§1–4:
//   Views: ?view=0 Pipeline (kanban default + list toggle) | ?view=1 Calendar | ?view=2 Published
//
//   Kit parts consumed:
//   - .frame / .frame-head / .frame-body-flush (part 30 pkg-pane-frame)
//   - .ip-split / .ip-split-list / .ip-split-divider / .ip-split-pane (part 25 inspector-detail)
//   - .split-row / .split-row-* / .split-group / .split-detail / .split-detail-* (list-detail)
//   - .dense-row.dense-row--pipeline / .dense-row-* (part 20 table-dense-row)
//   - .kb-board / .kb-col / .kb-card / .kb-mini-avatar / .kb-add (part 28 kanban)
//   - .nav-group[data-kind] / .nav-item / .nav-item.is-on / .nav-item.is-hot (part 22)
//   - .seg.nav-view-seg / .seg button.is-on (part 14 segmented-tabs, list-kanban-switch)
//   - .atelier-state.is-{loading,empty,error,streaming} / .atelier-spin (part 26 feedback-state)
//   - .stage-chip / .next-chip / .ux-dot (part 11 badge-tag-chip)
//   - .btn / .btn-icon / .btn-sm / .btn.affirmative (part 10 buttons)
//
//   Domain-local (content.css .ct-*):
//   - .ct-cal-grid / .ct-cal-pill / .ct-cal-legend (Calendar view)
//   - .ct-pub-kpis / .ct-pub-kpi / .ct-pub-table / .ct-mv-badge (Published view)
//   - Kanban stage dot colours for Idea/Outline/Draft/Review/Scheduled
//
// Data: host.dbQuery + host.dbExec via AppBridge. TanStack Query for caching.
// Migration: 0047_content_domain.sql — content_pieces, content_published, content_stage_transitions.
// Stage enum: idea → outline → draft → review → scheduled. Terminal: published.
//
// Mock contract 2 (calendar-derivation fallback): when content_pieces is empty,
// derives piece rows from content_calendar (status→stage, type→content_type).
// Demoted to a console warning once real rows exist.

import {
  html, cn, Icon,
  useState, useEffect, useMemo, useCallback,
  useQuery, useMutation, useQueryClient,
} from '../../lib/ui.js';
import { hostDbQuery, hostDbExec, setMenu, isStandalone } from '../../lib/bridge.js';

// ─── Stage enum ───────────────────────────────────────────────────────────────
// Content editorial pipeline stages — idea → outline → draft → review → scheduled.
// Per R-04 Pipeline-stages, defined here as the owning pkg and documented in README.

const STAGES = ['idea', 'outline', 'draft', 'review', 'scheduled'];

const STAGE_LABEL = {
  idea: 'Idea',
  outline: 'Outline',
  draft: 'Draft',
  review: 'Review',
  scheduled: 'Scheduled',
};

/** Tolerant grouping — rows with a non-enum stage render as their own visible
 *  group/column (raw value as label) instead of silently vanishing.
 *  Same pattern as sales-view.js stagesWithExtras (WP-18b live-verify follow-up). */
function stagesWithExtras(grouped) {
  const extras = Object.keys(grouped)
    .filter((s) => !STAGES.includes(s) && grouped[s].length > 0)
    .sort();
  return [...STAGES, ...extras];
}

// ─── Fixture data (canonical — mirrors content.md §1 C-01..C-08) ─────────────
// Used as primary data source until 0047 migration applies and real rows exist.
// Mock contract 2: calendar-derivation fallback. Must demote to console warning
// before sign-off once real pieces are present.

const PIECES_FIXTURE = [
  { id: 'C-01', title: 'Behind the catalog — Mavin',         content_type: 'video',      channel: 'youtube',     stage: 'idea',      owner: 'content-agent', format: 'video',     due_at: null,       next_action: 'Outline concept',           next_action_mode: 'silent'  },
  { id: 'C-02', title: 'Webinar recap + replay',              content_type: 'newsletter', channel: 'listmonk',    stage: 'idea',      owner: 'nedjamez',      format: 'broadcast', due_at: null,       next_action: 'Approve send date',         next_action_mode: 'confirm' },
  { id: 'C-03', title: 'Distributor comparison 2026',         content_type: 'blog',       channel: 'royalti.io',  stage: 'outline',   owner: 'nedjamez',      format: 'pillar',    due_at: 'Next wk',  next_action: 'Draft outline',             next_action_mode: 'confirm' },
  { id: 'C-04', title: 'How royalty splits actually work',    content_type: 'blog',       channel: 'royalti.io',  stage: 'draft',     owner: 'blog-writer',   format: '1,800 wd',  due_at: 'Fri',      next_action: 'Approve draft for publish', next_action_mode: 'approve' },
  { id: 'C-05', title: 'Customer story: Aristokrat',          content_type: 'blog',       channel: 'royalti.io',  stage: 'draft',     owner: 'blog-writer',   format: '900 wd',    due_at: 'Next wk',  next_action: 'Confirm story angle',       next_action_mode: 'confirm' },
  { id: 'C-06', title: 'May newsletter — DDEX delivery update', content_type: 'newsletter', channel: 'listmonk',  stage: 'review',    owner: 'nedjamez',      format: 'broadcast', due_at: 'Today',    next_action: 'Approve for send',          next_action_mode: 'approve' },
  { id: 'C-07', title: 'LinkedIn: seed round announcement',   content_type: 'social',     channel: 'linkedin',    stage: 'review',    owner: 'cmo-agent',     format: 'post',      due_at: 'Today',    next_action: 'Approve post',              next_action_mode: 'approve' },
  { id: 'C-08', title: '5 royalty myths — X thread',          content_type: 'social',     channel: 'x',           stage: 'scheduled', owner: 'social-agent',  format: '7 posts',   due_at: 'Tue 09:00',next_action: 'Scheduled — no action',     next_action_mode: 'silent'  },
];

// Calendar fixture (2-week: Apr 28 – May 9, 2026). Dates are ISO YYYY-MM-DD —
// the single key format the grid is built on (live content_calendar.publish_date
// is also ISO). The fixture anchor week is the Monday of the earliest event.
const CALENDAR_FIXTURE = [
  { id: 'CAL-01', date: '2026-04-28', title: 'Splits engine deep-dive',    channel: 'blog' },
  { id: 'CAL-02', date: '2026-04-28', title: 'Weekly digest',              channel: 'newsletter' },
  { id: 'CAL-03', date: '2026-04-29', title: 'Behind the rebuild',         channel: 'social' },
  { id: 'CAL-04', date: '2026-04-30', title: 'Royalty calc walkthrough',   channel: 'video' },
  { id: 'CAL-05', date: '2026-05-01', title: 'Label onboarding tips',      channel: 'blog' },
  { id: 'CAL-06', date: '2026-05-02', title: 'Founder note',               channel: 'newsletter' },
  { id: 'CAL-07', date: '2026-05-05', title: 'DDEX, explained',            channel: 'social' },
  { id: 'CAL-08', date: '2026-05-07', title: 'Catalog import demo',        channel: 'video' },
  { id: 'CAL-09', date: '2026-05-08', title: 'Q2 product update',          channel: 'blog' },
];

// Published fixture (6 rows)
const PUBLISHED_FIXTURE = [
  { id: 'P-01', title: 'Why we rewrote the splits engine',          channel: 'blog',       published_at: 'Apr 24', views: 12400, engagement_pct: 5.1 },
  { id: 'P-02', title: 'The least glamorous part of running a label', channel: 'social',   published_at: 'Apr 22', views: 8900,  engagement_pct: 4.2 },
  { id: 'P-03', title: 'Statement ingest at 90s for 30k rows',      channel: 'newsletter', published_at: 'Apr 18', views: 6200,  engagement_pct: 6.0 },
  { id: 'P-04', title: 'How a Lagos label ingested 880 contracts',  channel: 'blog',       published_at: 'Apr 15', views: 9100,  engagement_pct: 3.4 },
  { id: 'P-05', title: 'Royalty calculator overhaul',               channel: 'video',      published_at: 'Apr 10', views: 5600,  engagement_pct: 2.9 },
  { id: 'P-06', title: 'Splits, explained in 4 minutes',            channel: 'video',      published_at: 'Apr 4',  views: 6000,  engagement_pct: 3.1 },
];

// ─── Calendar date helpers ──────────────────────────────────────────────────
// The grid is keyed on ISO YYYY-MM-DD — the same format content_calendar.publish_date
// uses — so live pills land in the right cell. The two-week Mon–Sun grid is DERIVED
// from the actual event dates (anchored to the Monday of the earliest event's week)
// rather than pinned to a hard-coded fixture window, so it follows whatever the DB holds.

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Coerce any incoming date value (ISO `YYYY-MM-DD`, ISO datetime, or a Date) to an
 *  ISO `YYYY-MM-DD` key. Returns '' if it can't be parsed. */
function toISOKey(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  // Already an ISO date or ISO datetime → take the leading date portion.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Anything else (e.g. "Apr 28") → try Date parsing; assume current era if undated.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

/** ISO `YYYY-MM-DD` → bare day-of-month number string ("28", "1") for cell labels (F-03). */
function isoToDayNum(iso) {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(iso);
  return m ? String(parseInt(m[1], 10)) : iso;
}

/** ISO `YYYY-MM-DD` → "MMM YYYY" range label component ("Apr 2026"). */
function isoToMonthYear(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return '';
  return `${MONTH_ABBR[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/** Add `n` days to an ISO `YYYY-MM-DD` key (UTC-safe). */
function isoAddDays(iso, n) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** ISO `YYYY-MM-DD` → 0=Mon … 6=Sun (Monday-first weekday index). */
function isoWeekdayMon(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  const js = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return (js + 6) % 7; // → 0=Mon..6=Sun
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Build a two-week (Mon–Sun × 2) grid of { day, iso, dim } cells.
 *  Anchored to the Monday of the *densest* 14-day window across the events (so the
 *  visible fortnight is the busiest one, matching the design's populated calendar)
 *  — or this week if there are no events. Sat/Sun are dimmed (weekend). Keys are
 *  ISO so live pills land in-cell. */
function buildCalendarWeeks(events) {
  const keys = (events ?? [])
    .map((e) => toISOKey(e.date ?? e.publish_date))
    .filter(Boolean)
    .sort();

  let anchor;
  if (keys.length === 0) {
    anchor = new Date().toISOString().slice(0, 10);
  } else {
    // Candidate windows: each event's Monday-of-week. Pick the one whose 14-day
    // span (Mon..Mon+13) contains the most events. Ties → earliest window.
    const mondayOf = (iso) => isoAddDays(iso, -isoWeekdayMon(iso));
    const candidates = [...new Set(keys.map(mondayOf))].sort();
    let best = candidates[0];
    let bestCount = -1;
    for (const start of candidates) {
      const end = isoAddDays(start, 13);
      const count = keys.filter((k) => k >= start && k <= end).length;
      if (count > bestCount) { bestCount = count; best = start; }
    }
    anchor = best;
  }

  const start = isoAddDays(anchor, -isoWeekdayMon(anchor)); // Monday of the chosen week
  // is-today highlight (D.9 / F-12): only lights up when today actually falls in
  // the shown fortnight. We keep the densest-window anchoring (live data spans
  // Oct'25–Mar'26, so the grid stays on the populated weeks) rather than forcing
  // an empty current week — today simply isn't marked when it's out of range.
  const todayIso = new Date().toISOString().slice(0, 10);
  const weeks = [];
  for (let w = 0; w < 2; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const iso = isoAddDays(start, w * 7 + d);
      row.push({ day: DOW_LABELS[d], iso, dim: d >= 5, isToday: iso === todayIso });
    }
    weeks.push(row);
  }
  return weeks;
}

/** Normalize a raw content type/channel to one of the four legend categories so
 *  the channel pill/badge colour resolves. content_calendar carries both a `type`
 *  (blog_post / social_post / email_campaign / newsletter / blog / social) and a
 *  `channel` (blog / website / email / linkedin / social) — collapse either to
 *  blog | newsletter | social | video. */
function normalizeChannel(raw) {
  const s = (raw ?? '').toString().toLowerCase();
  if (!s) return '';
  if (s.includes('video') || s.includes('youtube')) return 'video';
  if (s.includes('news') || s.includes('email') || s.includes('listmonk') || s.includes('broadcast')) return 'newsletter';
  if (s.includes('blog') || s.includes('website') || s.includes('article')) return 'blog';
  if (s.includes('social') || s.includes('linkedin') || s === 'x' || s.includes('twitter') || s.includes('instagram') || s.includes('post')) return 'social';
  return s;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

const QK = {
  pieces:       ['content', 'pieces'],
  published:    ['content', 'published'],
  calEvents:    ['content', 'calEvents'],
  transitions:  (pieceId) => ['content', 'transitions', pieceId],
};

// ─── Data fetchers ────────────────────────────────────────────────────────────

/** Ensure 0047 migration is applied (content_pieces table exists). */
async function ensureMigration() {
  try {
    // Try to create all three tables — IF NOT EXISTS is safe on re-run.
    await hostDbExec(
      `CREATE TABLE IF NOT EXISTS content_pieces (
        id TEXT PRIMARY KEY,
        title TEXT,
        content_type TEXT,
        channel TEXT,
        stage TEXT,
        owner TEXT,
        next_action TEXT,
        next_action_mode TEXT,
        format TEXT,
        due_at TEXT,
        calendar_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      ) STRICT`
    );
    await hostDbExec(
      `CREATE TABLE IF NOT EXISTS content_published (
        id TEXT PRIMARY KEY,
        piece_id TEXT,
        title TEXT,
        content_type TEXT,
        channel TEXT,
        published_at TEXT,
        views INTEGER,
        engagement_pct REAL
      ) STRICT`
    );
    await hostDbExec(
      `CREATE TABLE IF NOT EXISTS content_stage_transitions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        piece_id TEXT,
        from_stage TEXT,
        to_stage TEXT,
        transitioned_at TEXT DEFAULT (datetime('now')),
        transitioned_by TEXT
      ) STRICT`
    );
  } catch (e) {
    console.warn('[content] ensureMigration:', e?.message ?? e);
  }
}

async function fetchPieces() {
  if (isStandalone()) return PIECES_FIXTURE;
  try {
    await ensureMigration();
    const rows = await hostDbQuery(
      `SELECT id, title, content_type, channel, stage, owner, next_action,
              next_action_mode, format, due_at, calendar_id, created_at
       FROM content_pieces
       ORDER BY created_at DESC`
    );
    if (rows.length > 0) return rows;

    // Mock contract 2: calendar-derivation fallback.
    // content_pieces is empty — derive from content_calendar as a bootstrap.
    console.warn('[content] content_pieces is empty — falling back to content_calendar derivation (Mock contract 2). Add real pieces to dismiss this warning.');
    try {
      const calRows = await hostDbQuery(
        `SELECT id, title, type, channel, status, assigned_to, publish_date
         FROM content_calendar
         ORDER BY publish_date ASC
         LIMIT 20`
      );
      if (calRows.length > 0) {
        return calRows.map((r, i) => ({
          id: r.id ?? `cal-${i}`,
          title: r.title ?? '(untitled)',
          content_type: r.type ?? 'blog',
          channel: r.channel ?? 'royalti.io',
          stage: r.status ?? 'idea',
          owner: r.assigned_to ?? 'nedjamez',
          next_action: null,
          next_action_mode: 'silent',
          format: null,
          due_at: r.publish_date ?? null,
          calendar_id: r.id,
          created_at: r.publish_date ?? null,
        }));
      }
    } catch {
      // content_calendar also missing — fall through to fixture
    }

    return PIECES_FIXTURE;
  } catch {
    return PIECES_FIXTURE;
  }
}

async function fetchPublished() {
  if (isStandalone()) return PUBLISHED_FIXTURE;
  try {
    const rows = await hostDbQuery(
      `SELECT id, piece_id, title, content_type, channel, published_at, views, engagement_pct
       FROM content_published
       ORDER BY published_at DESC
       LIMIT 20`
    );
    if (rows.length > 0) return rows;

    // Supplement with social_queue WHERE status = 'posted'
    try {
      const socialRows = await hostDbQuery(
        `SELECT id, platform AS channel, content AS title, posted_at AS published_at
         FROM social_queue
         WHERE status = 'posted'
         ORDER BY posted_at DESC
         LIMIT 10`
      );
      if (socialRows.length > 0) return socialRows;
    } catch {
      // social_queue missing
    }

    return PUBLISHED_FIXTURE;
  } catch {
    return PUBLISHED_FIXTURE;
  }
}

async function fetchCalEvents() {
  if (isStandalone()) return CALENDAR_FIXTURE;
  try {
    // Try content_calendar first for publish-date anchored entries. publish_date
    // is ISO YYYY-MM-DD; both `type` and `channel` carry channel hints — fold them
    // through normalizeChannel so the pill colour resolves to a legend category.
    const calRows = await hostDbQuery(
      `SELECT id, title, type, channel, publish_date
       FROM content_calendar
       WHERE publish_date IS NOT NULL
       ORDER BY publish_date ASC
       LIMIT 60`
    );
    // Also try calendar_events for supplemental time-anchored entries
    let eventRows = [];
    try {
      eventRows = await hostDbQuery(
        `SELECT id, title, description, start_time
         FROM calendar_events
         ORDER BY start_time ASC
         LIMIT 20`
      );
    } catch {
      // calendar_events missing
    }

    const combined = [
      ...calRows.map((r) => ({
        id: r.id,
        title: r.title,
        date: toISOKey(r.publish_date),
        // Prefer the more specific signal, then fall back; normalize to a legend bucket.
        channel: normalizeChannel(r.channel) || normalizeChannel(r.type) || '',
      })),
      ...eventRows.map((r) => ({
        id: r.id,
        title: r.title ?? r.description ?? '(untitled)',
        date: toISOKey(r.start_time),
        channel: '',
      })),
    ].filter((e) => e.date);

    return combined.length > 0 ? combined : CALENDAR_FIXTURE;
  } catch {
    return CALENDAR_FIXTURE;
  }
}

async function fetchTransitions(pieceId) {
  if (isStandalone() || !pieceId) return [];
  try {
    return await hostDbQuery(
      `SELECT id, piece_id, from_stage, to_stage, transitioned_at, transitioned_by
       FROM content_stage_transitions
       WHERE piece_id = ?
       ORDER BY transitioned_at DESC
       LIMIT 3`,
      [pieceId]
    );
  } catch {
    return [];
  }
}

// ─── Menu builder ─────────────────────────────────────────────────────────────

/**
 * Build the sidebar menu items for setMenu.
 *   activeView: 0 = Pipeline | 1 = Calendar | 2 = Published
 *   pipeMode: 'kanban' | 'list' (only relevant when activeView === 0)
 *   pieces: open pieces array (for counts)
 */
function buildContentMenu(activeView, pipeMode, pieces) {
  const totalCount = pieces.length;
  const myPieces = pieces.filter((p) => p.owner === 'nedjamez');
  const dueThisWeek = pieces.filter((p) =>
    p.due_at != null &&
    (p.due_at === 'Today' || p.due_at === 'Fri' || p.due_at === 'Tue' || p.due_at === 'Next wk' || p.due_at.startsWith('May') || p.due_at.startsWith('Tue '))
  );
  const agentDrafted = pieces.filter((p) =>
    p.owner === 'blog-writer' || p.owner === 'content-agent' || p.owner === 'cmo-agent' || p.owner === 'social-agent'
  );

  const viewItems = [
    {
      id: 'v:pipeline',
      label: 'Pipeline',
      icon: 'layers',
      section: 'View',
      active: activeView === 0,
      badge: totalCount > 0 ? totalCount : undefined,
    },
    {
      id: 'v:calendar',
      label: 'Calendar',
      icon: 'calendar',
      section: 'View',
      active: activeView === 1,
    },
    {
      id: 'v:published',
      label: 'Published',
      icon: 'check-circle',
      section: 'View',
      active: activeView === 2,
    },
  ];

  // Seg control: list/kanban toggle — injected when activeView === 0 only.
  // Content defaults to kanban (pipeMode = 'kanban') — unlike Sales (list default).
  // Option ids ARE the activeFeature values the shell publishes back.
  const segItem = activeView === 0
    ? [{
        id: 'seg:list-kanban',
        kind: 'seg',
        section: 'View',
        options: [
          { id: 'seg:kanban', label: 'Kanban', active: pipeMode === 'kanban' },
          { id: 'seg:list',   label: 'List',   active: pipeMode === 'list' },
        ],
      }]
    : [];

  const filterItems = [
    {
      id: 'f:all',
      label: 'All pieces',
      icon: 'inbox',
      section: undefined,
      active: true,
      badge: totalCount,
      disabled: activeView !== 0,
    },
    {
      id: 'f:mine',
      label: 'Mine',
      icon: 'user',
      section: undefined,
      active: false,
      badge: myPieces.length || undefined,
      disabled: activeView !== 0,
    },
    {
      id: 'f:due-this-week',
      label: 'Due this week',
      icon: 'zap',
      section: undefined,
      active: false,
      hot: dueThisWeek.length > 0,
      badge: dueThisWeek.length > 0 ? dueThisWeek.length : undefined,
      disabled: activeView !== 0,
    },
    {
      id: 'f:agent-drafted',
      label: 'Agent-drafted',
      icon: 'cpu',
      section: undefined,
      active: false,
      badge: agentDrafted.length || undefined,
      disabled: activeView !== 0,
    },
  ];

  // By channel filter group
  const channels = ['blog', 'newsletter', 'social', 'video'];
  const channelItems = channels.map((ch) => ({
    id: `f:ch:${ch}`,
    label: ch.charAt(0).toUpperCase() + ch.slice(1),
    section: 'By channel',
    active: false,
    badge: pieces.filter((p) => {
      const pch = (p.channel ?? '').toLowerCase();
      return pch === ch || pch.includes(ch);
    }).length || undefined,
    disabled: activeView !== 0,
  }));

  return [...viewItems, ...segItem, ...filterItems, ...channelItems];
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Owner mini-avatar for kanban cards */
function KbAvatar({ owner }) {
  const isAgent = owner && owner !== 'nedjamez';
  // Initial: N=nedjamez, B=blog-writer, C=content/cmo-agent, S=social-agent
  const initial = !owner ? 'N'
    : owner === 'nedjamez' ? 'N'
    : owner === 'blog-writer' ? 'B'
    : owner === 'cmo-agent' ? 'C'
    : owner === 'content-agent' ? 'C'
    : owner === 'social-agent' ? 'S'
    : owner[0].toUpperCase();
  return html`<span class=${cn('kb-mini-avatar', isAgent && 'is-agent')} aria-label=${owner ?? ''}>${initial}</span>`;
}

/** Single piece row in list mode */
function PieceRow({ piece, isSelected, onClick }) {
  const isUrgent = piece.due_at === 'Today';
  return html`
    <div
      class=${cn('split-row dense-row dense-row--pipeline', isSelected && 'is-selected')}
      role="row"
      tabIndex=${0}
      onClick=${onClick}
      onKeyDown=${(e) => e.key === 'Enter' && onClick()}
    >
      <span class="split-row-accent" aria-hidden="true"></span>
      <div class="split-row-body dense-row-body">
        <div class="split-row-title dense-row-title">${piece.title}</div>
        <div class="split-row-sub dense-row-sub">
          ${piece.channel}
          ${piece.owner ? html` · <span>${piece.owner !== 'nedjamez' ? html`<span style=${{ color: 'var(--systemic)' }}>⚡</span> ${piece.owner}` : piece.owner}</span>` : null}
        </div>
      </div>
      <div class="dense-row-right" style=${{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'3px' }}>
        ${piece.format ? html`<span class="split-row-amt dense-row-amt">${piece.format}</span>` : null}
        ${piece.due_at ? html`
          <span class=${cn('pl-row-due dense-row-due', isUrgent && 'is-urgent')}>
            ${piece.due_at}
          </span>
        ` : null}
        ${piece.next_action ? html`
          <span class="next-chip">
            <span class=${cn('ux-dot', `ux-${piece.next_action_mode ?? 'silent'}`)}></span>
            ${piece.next_action}
          </span>
        ` : null}
      </div>
    </div>
  `;
}

/** Piece detail pane (list mode) */
function PieceDetail({ piece, transitions }) {
  if (!piece) {
    return html`<div class="ip-split-pane split-detail" style=${{ display:'flex', alignItems:'center', justifyContent:'center', color:'var(--fg-muted)', fontSize:'0.85rem' }}>
      Select a piece
    </div>`;
  }

  const hasApprove = piece.next_action_mode === 'approve';
  const hasConfirm = piece.next_action_mode === 'confirm';
  const showButton = hasApprove || hasConfirm;

  return html`
    <div class="ip-split-pane split-detail" style=${{ overflowY:'auto' }}>
      <div class="split-detail-wrap">
        <div class="split-detail-eyebrow">
          <span class="stage-chip">${STAGE_LABEL[piece.stage] ?? piece.stage}</span>
        </div>
        <div class="split-detail-title">${piece.title}</div>
        <div class="split-detail-sub">${piece.channel}${piece.owner ? ` · ${piece.owner}` : ''}</div>

        <div class="split-facts">
          <div><div class="split-fact-k">Format</div><div class="split-fact-v">${piece.format ?? '—'}</div></div>
          <div><div class="split-fact-k">Stage</div><div class="split-fact-v">${STAGE_LABEL[piece.stage] ?? piece.stage}</div></div>
          <div><div class="split-fact-k">Due</div><div class="split-fact-v">${piece.due_at ?? '—'}</div></div>
          <div><div class="split-fact-k">Owner</div><div class="split-fact-v">${piece.owner ?? '—'}</div></div>
        </div>

        ${piece.next_action ? html`
          <div class="split-next">
            <div class="split-next-head">
              <span class=${cn('ux-dot', `ux-${piece.next_action_mode ?? 'silent'}`)}></span>
              Next action
            </div>
            <div class="split-next-body">
              ${piece.next_action}
              ${showButton ? html`
                <div style=${{ marginTop: '10px' }}>
                  <button
                    class=${cn('btn', hasApprove ? 'affirmative' : '')}
                    type="button"
                    onClick=${() => handleAction(piece)}
                  >
                    ${hasApprove ? 'Approve & run' : 'Confirm & run'}
                  </button>
                </div>
              ` : null}
            </div>
          </div>
        ` : null}

        ${transitions && transitions.length > 0 ? html`
          <div class="split-detail-eyebrow" style=${{ marginTop:'12px' }}>Stage history</div>
          <div class="split-timeline" role="list">
            ${transitions.map((t) => html`
              <div class="split-tl-row" role="listitem" key=${t.id}>
                <span class="split-tl-dot" aria-hidden="true"></span>
                <div class="split-tl-body">
                  <div class="split-tl-title">${t.from_stage ?? '?'} → ${t.to_stage ?? '?'}</div>
                  <div class="split-tl-when">${t.transitioned_at ? t.transitioned_at.substring(0,10) : ''} · ${t.transitioned_by ?? ''}</div>
                </div>
              </div>
            `)}
          </div>
        ` : null}
      </div>
    </div>
  `;
}

/** No-op stub for approve/confirm action — real impl wires to host.dispatchAgentAction */
function handleAction(piece) {
  if (!isStandalone()) {
    hostDbExec(
      `UPDATE content_pieces SET next_action_mode = 'silent' WHERE id = ?`,
      [piece.id]
    ).catch(() => {});
  }
}

/** Pipeline list mode — grouped by stage, split list + detail */
function PipelineList({ pieces, selectedPiece, onSelectPiece, transitions }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const s of STAGES) map[s] = [];
    for (const p of pieces) {
      if (map[p.stage]) map[p.stage].push(p);
      else map[p.stage] = [p];
    }
    return map;
  }, [pieces]);

  return html`
    <div class="ip-split" style=${{ height:'100%' }}>
      ${/* app-kit .ip-split-list is display:grid; grid-template-rows:1fr — built
            for a SINGLE scroll child. This list has a sticky head + multiple
            .split-group blocks as direct children, so the 1fr track was consumed
            by the head (huge gap) and the groups spilled into implicit rows.
            Override to a flex column inline so head stays sticky and groups
            scroll naturally. */ ''}
      <div class="ip-split-list" style=${{ overflowY:'auto', display:'flex', flexDirection:'column' }} role="grid" aria-label="Content pipeline list">
        <div class="split-list-head">
          <span class="split-list-title">Content</span>
          <span class="split-list-meta">${pieces.length} open</span>
        </div>
        ${stagesWithExtras(grouped).map((s) => grouped[s]?.length > 0 ? html`
          <div class="split-group" key=${s}>
            <div class="split-group-head">${STAGE_LABEL[s] ?? s} · ${grouped[s].length}</div>
            ${grouped[s].map((p) => html`
              <${PieceRow}
                key=${p.id}
                piece=${p}
                isSelected=${selectedPiece?.id === p.id}
                onClick=${() => onSelectPiece(p)}
              />
            `)}
          </div>
        ` : null)}
      </div>
      <div class="ip-split-divider" role="separator" aria-hidden="true"></div>
      <${PieceDetail} piece=${selectedPiece} transitions=${transitions} />
    </div>
  `;
}

/** Pipeline kanban mode — five columns */
function PipelineKanban({ pieces, onStageChange }) {
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const grouped = useMemo(() => {
    const map = {};
    for (const s of STAGES) map[s] = [];
    for (const p of pieces) {
      if (map[p.stage]) map[p.stage].push(p);
      else map[p.stage] = [p];
    }
    return map;
  }, [pieces]);

  function onDragStart(p) { setDragging(p); }
  function onDragOver(e, s) { e.preventDefault(); setDropTarget(s); }
  function onDrop(e, s) {
    e.preventDefault();
    if (dragging && dragging.stage !== s) onStageChange(dragging, s);
    setDragging(null);
    setDropTarget(null);
  }
  function onDragEnd() { setDragging(null); setDropTarget(null); }

  return html`
    <div class="kb-board-wrap">
      <div class="kb-board" role="region" aria-label="Content pipeline board">
        ${stagesWithExtras(grouped).map((s) => {
          const stagePieces = grouped[s] ?? [];
          return html`
            <div
              key=${s}
              class=${cn('kb-col', dropTarget === s && 'is-drop-target')}
              data-stage=${s}
              onDragOver=${(e) => onDragOver(e, s)}
              onDrop=${(e) => onDrop(e, s)}
              role="region"
              aria-label=${'Stage: ' + (STAGE_LABEL[s] ?? s)}
            >
              <div class="kb-col-head">
                <span class="kb-col-dot" aria-hidden="true"></span>
                <span class="kb-col-name">${STAGE_LABEL[s] ?? s}</span>
                <span class="kb-col-meta">${stagePieces.length}</span>
              </div>
              <div class="kb-col-body">
                ${stagePieces.map((p) => html`
                  <div
                    key=${p.id}
                    class=${cn('kb-card', dragging?.id === p.id && 'is-dragging')}
                    draggable="true"
                    onDragStart=${() => onDragStart(p)}
                    onDragEnd=${onDragEnd}
                    tabIndex=${0}
                  >
                    <div class="kb-card-title">${p.title}</div>
                    <div class="kb-card-sub">${p.channel}${p.format ? ` · ${p.format}` : ''}</div>
                    <div class="kb-card-foot">
                      ${p.due_at ? html`<span class="kb-card-amt" style=${{ fontSize:'0.65rem', color:'var(--fg-muted)' }}>${p.due_at}</span>` : html`<span></span>`}
                      <div class="kb-card-owner">
                        <span class=${cn('ux-dot', `ux-${p.next_action_mode ?? 'silent'}`)}></span>
                        <${KbAvatar} owner=${p.owner} />
                      </div>
                    </div>
                  </div>
                `)}
                <button
                  class="kb-add btn-icon"
                  type="button"
                  aria-label=${'Add piece to ' + (STAGE_LABEL[s] ?? s)}
                >+</button>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

/** Calendar view — two-week Mon–Sun grid, ISO-keyed + data-derived */
function CalendarView({ calEvents }) {
  // Build a map of ISO date → entries for quick lookup. Both the grid cells and
  // the events are keyed on ISO YYYY-MM-DD so live pills land in their cell (F-01).
  const byDate = useMemo(() => {
    const map = {};
    for (const e of calEvents) {
      const dateKey = toISOKey(e.date ?? e.publish_date);
      if (!dateKey) continue;
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(e);
    }
    return map;
  }, [calEvents]);

  // Derive the two-week window from the events themselves (anchored to the Monday
  // of the earliest event's week), so the grid follows the live data range.
  const weeks = useMemo(() => buildCalendarWeeks(calEvents), [calEvents]);

  // Range label for the section sub-line ("Apr 2026 → May 2026" or single month).
  const firstIso = weeks[0]?.[0]?.iso ?? '';
  const lastIso = weeks[1]?.[6]?.iso ?? weeks[0]?.[6]?.iso ?? '';
  const startMY = isoToMonthYear(firstIso);
  const endMY = isoToMonthYear(lastIso);
  const rangeLabel = startMY && endMY && startMY !== endMY ? `${startMY} – ${endMY}` : startMY;

  return html`
    <div class="ct-mv-wrap">
      <div class="ct-cal-section-title">Editorial calendar · 2 weeks · Lagos time${rangeLabel ? ` · ${rangeLabel}` : ''}</div>

      <div class="ct-cal-legend">
        ${['blog', 'newsletter', 'social', 'video'].map((ch) => html`
          <div class="ct-cal-legend-item" key=${ch}>
            <span class="ct-cal-legend-dot" data-channel=${ch}></span>
            <span>${ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
          </div>
        `)}
      </div>

      ${weeks.map((week, wi) => html`
        <div key=${wi}>
          <div class="ct-cal-grid">
            ${DOW_LABELS.map((d) => html`<div class="ct-cal-dow" key=${d}>${d}</div>`)}
            ${week.map((cell) => {
              const entries = byDate[cell.iso] ?? [];
              return html`
                <div class=${cn('ct-cal-day', cell.dim && 'dim', cell.isToday && 'is-today')} key=${cell.iso} aria-current=${cell.isToday ? 'date' : undefined}>
                  <div class="ct-cal-date">${isoToDayNum(cell.iso)}${cell.isToday ? html`<span class="ct-cal-today">today</span>` : null}</div>
                  ${entries.map((e) => html`
                    <span class="ct-cal-pill" data-channel=${e.channel ?? ''} key=${e.id}>
                      ${e.title}
                    </span>
                  `)}
                </div>
              `;
            })}
          </div>
        </div>
      `)}
    </div>
  `;
}

/** Published view — KPI cells + table */
function PublishedView({ publishedItems }) {
  const kpis = useMemo(() => {
    const totalViews = publishedItems.reduce((s, p) => s + (p.views ?? 0), 0);
    const avgEng = publishedItems.length
      ? publishedItems.reduce((s, p) => s + (p.engagement_pct ?? 0), 0) / publishedItems.length
      : 0;
    const topCh = publishedItems.reduce((acc, p) => {
      const ch = p.channel ?? 'blog';
      acc[ch] = (acc[ch] ?? 0) + (p.views ?? 0);
      return acc;
    }, {});
    const topEntry = Object.entries(topCh).sort((a, b) => b[1] - a[1])[0];
    const topChannel = topEntry?.[0] ?? 'Blog';
    const topChannelViews = topEntry?.[1] ?? 21500;
    const channelCount = Object.keys(topCh).length || 4;
    return {
      count: 12, // fixture
      totalViews: totalViews || 48200,
      avgEng: avgEng.toFixed(1) || '3.8',
      topChannel: topChannel.charAt(0).toUpperCase() + topChannel.slice(1),
      topChannelViews,
      channelCount,
    };
  }, [publishedItems]);

  function fmtViews(v) {
    if (!v) return '—';
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return String(v);
  }

  return html`
    <div class="ct-pub-wrap">
      <div class="ct-pub-kpis">
        <div class="ct-pub-kpi">
          <span class="ct-kpi-k">Published this month</span>
          <span class="ct-kpi-v">${kpis.count}</span>
          <span class="ct-kpi-sub">across ${kpis.channelCount} channels</span>
        </div>
        <div class="ct-pub-kpi">
          <span class="ct-kpi-k">Total views</span>
          <span class="ct-kpi-v">${fmtViews(kpis.totalViews)}</span>
          <span class="ct-kpi-sub">vs prior period</span>
        </div>
        <div class="ct-pub-kpi">
          <span class="ct-kpi-k">Avg engagement</span>
          <span class="ct-kpi-v">${kpis.avgEng}%</span>
          <span class="ct-kpi-sub">benchmark 2–4%</span>
        </div>
        <div class="ct-pub-kpi">
          <span class="ct-kpi-k">Top channel</span>
          <span class="ct-kpi-v">${kpis.topChannel}</span>
          <span class="ct-kpi-sub">${fmtViews(kpis.topChannelViews)} views</span>
        </div>
      </div>

      <div class="ct-pub-card">
        <div class="ct-pub-card-h">Recently published</div>
        <table class="ct-pub-table" role="grid" aria-label="Published pieces">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Channel</th>
              <th>Published</th>
              <th style=${{ textAlign:'right' }}>Views</th>
              <th style=${{ textAlign:'right' }}>Engagement</th>
            </tr>
          </thead>
          <tbody>
            ${publishedItems.map((p) => html`
              <tr key=${p.id}>
                <td>${p.title}</td>
                <td>
                  <span class="ct-mv-badge" data-channel=${p.channel ?? ''}>
                    ${p.channel ?? '—'}
                  </span>
                </td>
                <td style=${{ color:'var(--fg-muted)', fontFamily:'var(--font-mono)', fontSize:'0.72rem' }}>
                  ${p.published_at ?? '—'}
                </td>
                <td style=${{ textAlign:'right' }}>
                  <span class="ct-pub-views">${fmtViews(p.views)}</span>
                </td>
                <td style=${{ textAlign:'right' }}>
                  <span class="ct-pub-eng">${p.engagement_pct != null ? `${p.engagement_pct}%` : '—'}</span>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Loading / empty / error / streaming states ────────────────────────────────

function LoadingState() {
  return html`
    <div class="atelier-state is-loading" id="view-stage">
      <span class="atelier-spin" aria-hidden="true"></span>
      <span>Loading content…</span>
    </div>
  `;
}

function EmptyState() {
  return html`
    <div class="atelier-state is-empty" id="view-stage">
      <span>No content yet</span>
      <button class="btn btn-sm" type="button" style=${{ marginTop:'8px' }}>New piece</button>
    </div>
  `;
}

function ErrorState({ error }) {
  return html`
    <div class="atelier-state is-error" id="view-stage">
      <span>Failed to load content</span>
      <span style=${{ fontSize:'0.72rem', color:'var(--fg-muted)', marginTop:'4px' }}>${error}</span>
    </div>
  `;
}

function StreamingState() {
  return html`
    <div class="atelier-state is-streaming" id="view-stage">
      <span class="atelier-prog" role="status" aria-live="polite">Content agent running…</span>
    </div>
  `;
}

// ─── ContentView root ─────────────────────────────────────────────────────────

export function ContentView({ activeFeature }) {
  // View state: 0=Pipeline | 1=Calendar | 2=Published
  const [activeView, setActiveView] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('view');
    const v = parseInt(p ?? '0', 10);
    return [0, 1, 2].includes(v) ? v : 0;
  });
  // Content defaults to kanban (unlike Sales which defaults to list)
  const [pipeMode, setPipeMode] = useState('kanban'); // 'kanban' | 'list'
  const [selectedPiece, setSelectedPiece] = useState(null);
  const qc = useQueryClient();

  // ── Data queries ────────────────────────────────────────────────────────────
  const piecesQ = useQuery({ queryKey: QK.pieces, queryFn: fetchPieces });
  const publishedQ = useQuery({ queryKey: QK.published, queryFn: fetchPublished, enabled: activeView === 2 });
  const calEventsQ = useQuery({ queryKey: QK.calEvents, queryFn: fetchCalEvents, enabled: activeView === 1 });

  const transitionsQ = useQuery({
    queryKey: QK.transitions(selectedPiece?.id ?? null),
    queryFn: () => fetchTransitions(selectedPiece?.id),
    enabled: !!selectedPiece?.id && activeView === 0 && pipeMode === 'list',
    staleTime: 60_000,
  });

  const pieces = piecesQ.data ?? [];

  // ── db-updated refresh ──────────────────────────────────────────────────────
  useEffect(() => {
    function onDbUpdated() {
      qc.invalidateQueries({ queryKey: ['content'] });
    }
    window.addEventListener('db-updated', onDbUpdated);
    return () => window.removeEventListener('db-updated', onDbUpdated);
  }, [qc]);

  // ── activeFeature → view + mode switching (side-menu item clicks) ───────────
  // PINNED WIRING CONTRACT: shell relays side-menu clicks via host-context re-emit.
  // activeFeature carries royaltiSuite.activeFeature = the clicked item's id.
  // Seg option ids ARE the activeFeature values published back from the shell.
  useEffect(() => {
    if (!activeFeature) return;
    if (activeFeature === 'v:pipeline') setActiveView(0);
    else if (activeFeature === 'v:calendar') setActiveView(1);
    else if (activeFeature === 'v:published') setActiveView(2);
    else if (activeFeature === 'seg:kanban') setPipeMode('kanban');
    else if (activeFeature === 'seg:list') setPipeMode('list');
    // Filter items (f:*) are noted but don't change view state in v1
  }, [activeFeature]);

  // ── Pre-select hero piece C-04 in list mode ─────────────────────────────────
  useEffect(() => {
    if (pieces.length > 0 && !selectedPiece && activeView === 0 && pipeMode === 'list') {
      const hero = pieces.find((p) => p.id === 'C-04') ?? pieces[0];
      setSelectedPiece(hero);
    }
  }, [pieces, activeView, pipeMode]);

  // ── setMenu publish ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isStandalone()) return;
    const items = buildContentMenu(activeView, pipeMode, pieces);
    setMenu(items).catch(() => {/* ignore */});
  }, [activeView, pipeMode, pieces]);

  // ── Stage change mutation (kanban drag) ─────────────────────────────────────
  const stageChange = useMutation({
    mutationFn: async ({ piece, newStage }) => {
      if (isStandalone()) return;
      // Record stage transition
      await hostDbExec(
        `INSERT INTO content_stage_transitions (piece_id, from_stage, to_stage, transitioned_by)
         VALUES (?, ?, ?, ?)`,
        [piece.id, piece.stage, newStage, 'nedjamez']
      ).catch(() => {});
      // Update piece stage — try content_pieces first, then content_calendar fallback
      try {
        await hostDbExec(
          `UPDATE content_pieces SET stage = ? WHERE id = ?`,
          [newStage, piece.id]
        );
      } catch {
        // Piece may have been derived from content_calendar — update status there
        if (piece.calendar_id) {
          await hostDbExec(
            `UPDATE content_calendar SET status = ? WHERE id = ?`,
            [newStage, piece.calendar_id]
          );
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.pieces }),
  });

  // ── Head label ──────────────────────────────────────────────────────────────
  const headLabel = activeView === 0
    ? `Content · ${pieces.length} open`
    : activeView === 1 ? 'Calendar'
    : 'Published';

  // ── Render ──────────────────────────────────────────────────────────────────
  let body;

  if (activeView === 0) {
    // Pipeline view (kanban default)
    if (piecesQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else if (piecesQ.isError) {
      body = html`<${ErrorState} error=${piecesQ.error?.message ?? 'unknown'} />`;
    } else if (pieces.length === 0) {
      body = html`<${EmptyState} />`;
    } else if (pipeMode === 'kanban') {
      body = html`<${PipelineKanban}
        pieces=${pieces}
        onStageChange=${(piece, newStage) => stageChange.mutate({ piece, newStage })}
      />`;
    } else {
      body = html`<${PipelineList}
        pieces=${pieces}
        selectedPiece=${selectedPiece}
        onSelectPiece=${setSelectedPiece}
        transitions=${transitionsQ.data ?? []}
      />`;
    }
  } else if (activeView === 1) {
    // Calendar view
    if (calEventsQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else {
      body = html`<${CalendarView} calEvents=${calEventsQ.data ?? CALENDAR_FIXTURE} />`;
    }
  } else {
    // Published view
    if (publishedQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else {
      body = html`<${PublishedView} publishedItems=${publishedQ.data ?? PUBLISHED_FIXTURE} />`;
    }
  }

  return html`
    <div class="frame" style=${{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div class="frame-head" style=${{ display:'flex', alignItems:'center', gap:'8px' }}>
        <!-- Content domain icon: lines/document SVG -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <span>${headLabel}</span>
      </div>
      <div class="frame-body-flush" id="view-stage" style=${{ flex:1, overflow:'hidden' }}>
        ${body}
      </div>
    </div>
  `;
}
