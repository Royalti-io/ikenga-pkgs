// Mail main view — Inbox / Triage / All / Drafts.
//
// Composition follows plans/atelier-design-system/parts/screens/mail.md §§1–4:
//   - .frame / .frame-head / .frame-body-flush (kit part 30 pkg-pane-frame)
//   - .pane-split two-column grid (380px list | 1fr reader) — mail-local, NOT .ip-split
//   - .mail-list / .mail-row* (mail-local domain residue)
//   - .reader-pane / .reader-toolbar / .reader-* (mail-local domain residue)
//   - .nav-group[data-kind] / .nav-item / .nav-item.is-on / .nav-item.is-hot via setMenu
//   - .atelier-state.is-{loading,empty,error,streaming} (kit part 26)
//   - .tag / .chip / .btn / .btn-icon / .btn-sm / .badge (kit parts 10, 11)
//   - .dense-row.dense-row--outbox in Triage view (kit part 20)
//   - .chat-msg* in dock area (kit part 29)

import { html, cn, Icon, useState, useEffect, useMemo, useRef, useQuery, useMutation, useQueryClient } from '../../lib/ui.js';
import {
  hostDbExec,
  setMenu,
  isStandalone,
  publishIykeState,
  hostSendToActiveSession,
} from '../../lib/bridge.js';
import {
  fetchThreadList,
  fetchUnreadCount,
  fetchTriageCount,
  fetchSnoozedCount,
  fetchDraftCount,
  fetchMessage,
  fetchReply,
  markRead,
  markUnread,
  snoozeThread,
  setThreadTags,
} from '../../lib/queries.js';

// ─── Menu model ──────────────────────────────────────────────────────────────

const VIEW_ITEMS = [
  { id: 'v:inbox',  label: 'Inbox',   icon: 'inbox'  },
  { id: 'v:triage', label: 'Triage',  icon: 'filter' },
  { id: 'v:all',    label: 'All',     icon: 'mail'   },
  { id: 'v:drafts', label: 'Drafts',  icon: 'file-text' },
];

const THREAD_ITEMS = [
  { id: 'n:by-person', label: 'By person', icon: 'user',    section: 'Threads' },
  { id: 'n:by-tag',    label: 'By tag',    icon: 'tag',     section: 'Threads' },
  { id: 'n:snoozed',   label: 'Snoozed',   icon: 'clock',   section: 'Threads' },
];

const FILTER_ITEMS = [
  { id: 'f:active-deals',    label: 'Active deals',    icon: 'star',  section: 'Filters' },
  { id: 'f:overdue-replies', label: 'Overdue replies', icon: 'zap',   section: 'Filters' },
];

/**
 * Build the flat menu item list for setMenu.
 * @param {string} view  current view id (inbox/triage/all/drafts)
 * @param {number} unreadCount
 * @param {number} triageCount
 * @param {number} snoozedCount
 * @param {number} draftCount
 */
function buildMailMenu(view, unreadCount, triageCount, snoozedCount, draftCount) {
  const viewRows = VIEW_ITEMS.map((it) => {
    let badge;
    if (it.id === 'v:inbox' && unreadCount > 0) badge = unreadCount;
    if (it.id === 'v:triage' && triageCount > 0) badge = triageCount;
    if (it.id === 'v:drafts' && draftCount > 0) badge = draftCount;
    return {
      ...it,
      section: 'View',
      active: `v:${view}` === it.id,
      hot: it.id === 'v:inbox' && unreadCount > 0,
      badge,
    };
  });

  const threadRows = THREAD_ITEMS.map((it) => ({
    ...it,
    active: false,
    badge: it.id === 'n:snoozed' && snoozedCount > 0 ? snoozedCount : undefined,
  }));

  const filterRows = FILTER_ITEMS.map((it) => ({
    ...it,
    active: false,
    disabled: false,
  }));

  return [...viewRows, ...threadRows, ...filterRows];
}

// ─── Snooze helper ────────────────────────────────────────────────────────────

function snoozeUntil4h() {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

// ─── Tag chip helper ──────────────────────────────────────────────────────────

function tagClass(tag) {
  if (!tag) return 'tag';
  const t = String(tag).toLowerCase();
  if (t.includes('deal') || t.includes('business')) return 'tag tag-deal';
  if (t.includes('warn') || t.includes('overdue') || t.includes('paye') || t.includes('lirs')) return 'tag tag-warn';
  if (t.includes('system') || t.includes('auto') || t.includes('monitor')) return 'tag tag-system';
  if (t.includes('await') || t.includes('primary') || t.includes('action')) return 'tag tag-primary';
  return 'tag';
}

function triageCategoryTag(category) {
  if (!category) return null;
  const map = {
    business: 'tag tag-deal',
    overdue: 'tag tag-warn',
    automated: 'tag tag-system',
    awaiting: 'tag tag-primary',
  };
  return map[category.toLowerCase()] ?? 'tag';
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ─── Components ──────────────────────────────────────────────────────────────

/**
 * Feedback-state overlay (kit part 26).
 * state: 'loading' | 'empty' | 'error' | 'streaming'
 */
function FeedbackState({ state, message }) {
  const icons = {
    loading: 'loader',
    empty: 'inbox',
    error: 'alert-circle',
    streaming: 'refresh-cw',
  };
  const labels = {
    loading: message ?? 'Loading…',
    empty: message ?? 'No threads here.',
    error: message ?? 'Failed to load.',
    streaming: message ?? 'Chi is working…',
  };
  const role = state === 'error' ? 'alert' : 'status';
  const live = state === 'error' ? 'assertive' : 'polite';
  return html`
    <div
      class=${`atelier-state is-${state}`}
      role=${role}
      aria-live=${live}
    >
      <${Icon} name=${icons[state]} size=${20} className="atelier-state-icon" />
      <span>${labels[state]}</span>
    </div>
  `;
}

/**
 * A single mail list row.
 */
function MailRow({ thread, isSelected, onClick }) {
  const { id, subject, from_name, from_address, received_at, is_read, tags, preview, triage_category } = thread;
  const cls = cn('mail-row', {
    'is-unread': !is_read,
    'is-selected': isSelected,
  });

  // Build visible tags: from triage_category + tags array
  const visibleTags = [];
  if (triage_category) {
    visibleTags.push({ label: triage_category, cls: triageCategoryTag(triage_category) ?? 'tag' });
  }
  if (Array.isArray(tags)) {
    for (const t of tags) {
      visibleTags.push({ label: t, cls: tagClass(t) });
    }
  }

  return html`
    <div
      class=${cls}
      role="row"
      tabIndex="0"
      aria-selected=${isSelected}
      onClick=${() => onClick(id)}
      onKeyDown=${(e) => e.key === 'Enter' && onClick(id)}
    >
      <div class="mail-row-tick" aria-hidden="true"></div>
      <div class="mail-row-body">
        <div class="mail-row-meta">
          <span class="mail-row-from">${from_name || from_address}</span>
          <span class="mail-row-time">${relativeTime(received_at)}</span>
        </div>
        <div class="mail-row-subject">${subject || '(no subject)'}</div>
        <div class="mail-row-preview">${preview ?? ''}</div>
        ${visibleTags.length > 0 ? html`
          <div class="mail-row-tags">
            ${visibleTags.slice(0, 3).map(({ label, cls: tagCls }) =>
              html`<span class=${tagCls} key=${label}>${label}</span>`
            )}
          </div>
        ` : null}
      </div>
    </div>
  `;
}

/**
 * Reader toolbar with navigation actions.
 */
function ReaderToolbar({ onBack, onArchive, onSnooze, onTag, position }) {
  return html`
    <div class="reader-toolbar" role="toolbar" aria-label="Thread actions">
      <button class="btn btn-icon" onClick=${onBack} title="Back" aria-label="Back">
        <${Icon} name="arrow-left" size=${16} />
      </button>
      <span class="reader-toolbar-spacer"></span>
      <span class="reader-toolbar-meta">${position}</span>
      <span class="reader-toolbar-spacer"></span>
      <button class="btn btn-icon" onClick=${onArchive} title="Archive" aria-label="Archive">
        <${Icon} name="archive" size=${16} />
      </button>
      <button class="btn btn-icon" onClick=${onSnooze} title="Snooze 4h" aria-label="Snooze 4 hours">
        <${Icon} name="clock" size=${16} />
      </button>
      <button class="btn btn-icon" onClick=${onTag} title="Tag" aria-label="Tag thread">
        <${Icon} name="tag" size=${16} />
      </button>
      <button class="btn btn-icon" title="Delete" aria-label="Delete">
        <${Icon} name="trash" size=${16} />
      </button>
    </div>
  `;
}

/**
 * Reader pane — full thread view with quick-reply.
 */
function ReaderPane({ messageId, queryClient, onBack }) {
  const [replyText, setReplyText] = useState('');
  const [draftSent, setDraftSent] = useState(false);

  // Fetch thread detail
  const { data: message, isLoading: msgLoading, error: msgError } = useQuery({
    queryKey: ['mail', 'message', messageId],
    queryFn: () => fetchMessage(messageId),
    enabled: !!messageId,
  });

  // Fetch Chi-drafted reply
  const { data: chiReply } = useQuery({
    queryKey: ['mail', 'reply', messageId],
    queryFn: () => fetchReply(messageId),
    enabled: !!messageId,
  });

  // Pre-fill quick-reply if Chi has drafted one and not yet sent
  useEffect(() => {
    if (chiReply?.body && !draftSent) {
      setReplyText(chiReply.body);
    }
  }, [chiReply?.body]);

  // Mark as read on mount
  useEffect(() => {
    if (messageId && message && !message.is_read) {
      markRead(messageId).then(() => {
        queryClient.invalidateQueries({ queryKey: ['mail', 'threads'] });
        queryClient.invalidateQueries({ queryKey: ['mail', 'counts'] });
      }).catch(() => {});
    }
  }, [messageId, message?.is_read]);

  // Snooze mutation
  const snoozeMut = useMutation({
    mutationFn: () => snoozeThread(messageId, snoozeUntil4h()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail', 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['mail', 'counts'] });
    },
  });

  // Handle ⌘↵ quick send
  const handleReplyKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSendReply();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      e.preventDefault();
      handleRegenerateReply();
    }
  };

  const handleSendReply = () => {
    if (!replyText.trim()) return;
    // In production: route through outbound system. For now: simulate draft-reply result.
    setDraftSent(true);
    setReplyText('');
  };

  const handleRegenerateReply = () => {
    if (!messageId) return;
    hostSendToActiveSession(
      `Regenerate reply for email thread: "${message?.subject ?? messageId}". Tone: warm, professional.`,
      'com.ikenga.mail'
    ).catch(() => {});
  };

  if (!messageId) {
    return html`
      <div class="reader-pane">
        <${FeedbackState} state="empty" message="Select a thread to read" />
      </div>
    `;
  }

  if (msgLoading) {
    return html`
      <div class="reader-pane">
        <${FeedbackState} state="loading" />
      </div>
    `;
  }

  if (msgError) {
    return html`
      <div class="reader-pane">
        <${FeedbackState} state="error" message=${msgError.message} />
      </div>
    `;
  }

  if (!message) {
    return html`
      <div class="reader-pane">
        <${FeedbackState} state="empty" message="Thread not found." />
      </div>
    `;
  }

  return html`
    <div class="reader-pane">
      <${ReaderToolbar}
        onBack=${onBack}
        onArchive=${() => {}}
        onSnooze=${() => snoozeMut.mutate()}
        onTag=${() => {}}
        position=""
      />
      <div class="reader-body-wrap">
        <div class="reader-head">
          <div class="reader-from-row">
            <div class="avatar">${(message.from_name || message.from_address || '?')[0].toUpperCase()}</div>
            <div>
              <div class="reader-from-name">${message.from_name || message.from_address}</div>
              <div class="reader-from-addr">${message.from_address}${message.from_org ? html` · <span>${message.from_org}</span>` : null}</div>
            </div>
            <div class="reader-actions">
              <button class="btn btn-sm" onClick=${() => snoozeMut.mutate()} title="Snooze 4h">
                <${Icon} name="clock" size=${14} /> Snooze 4h
              </button>
              <button class="btn btn-sm" title="Archive">
                <${Icon} name="archive" size=${14} /> Archive
              </button>
              <button class="btn btn-sm btn-primary" title="Reply">
                <${Icon} name="corner-down-left" size=${14} /> Reply
              </button>
            </div>
          </div>
          <div class="reader-subject">${message.subject || '(no subject)'}</div>
          <div class="reader-meta">
            <span class="chip">${relativeTime(message.received_at)}</span>
            ${message.triage_category ? html`<span class=${triageCategoryTag(message.triage_category) ?? 'tag'}>${message.triage_category}</span>` : null}
          </div>
        </div>

        <div class="reader-body">
          ${message.body_text
            ? message.body_text.split('\n').filter((l) => l.trim()).map((line, i) =>
                html`<p key=${i}>${line}</p>`
              )
            : html`<p style=${{ color: 'var(--fg-muted)' }}>(No body text)</p>`
          }
        </div>

        ${chiReply || replyText ? html`
          <div class="reader-quick-reply">
            <div class="reader-quick-reply-head">
              <span class="reader-quick-reply-tag chip">Quick reply · drafted by your Chi · approve to send</span>
            </div>
            <textarea
              class="input"
              rows="4"
              placeholder="Chi's drafted reply will appear here…"
              value=${replyText}
              onInput=${(e) => setReplyText(e.target.value)}
              onKeyDown=${handleReplyKeyDown}
              aria-label="Quick reply"
            ></textarea>
            <div class="reader-quick-reply-foot">
              <span style=${{ color: 'var(--achievement, var(--live))' }}>
                Tone: warm · 3-line · matches your last 6 replies
              </span>
              <span style=${{ color: 'var(--fg-faint)' }}>⌘↵ send · ⌘R regenerate</span>
            </div>
          </div>
        ` : html`
          <div class="reader-quick-reply">
            <div class="reader-quick-reply-head">
              <span class="reader-quick-reply-tag chip">Quick reply</span>
            </div>
            <textarea
              class="input"
              rows="3"
              placeholder="Ask Chi to draft a reply, or type directly…"
              value=${replyText}
              onInput=${(e) => setReplyText(e.target.value)}
              onKeyDown=${handleReplyKeyDown}
              aria-label="Quick reply"
            ></textarea>
            <div class="reader-quick-reply-foot">
              <span style=${{ color: 'var(--fg-faint)' }}>⌘↵ send · ⌘R ask Chi to draft</span>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

// ─── Main MailView ────────────────────────────────────────────────────────────

const VIEW_STORAGE_KEY = 'ikenga-mail-view';

export function MailView({ activeFeature }) {
  const queryClient = useQueryClient();

  // Persist view selection
  const [view, setView] = useState(
    () => localStorage.getItem(VIEW_STORAGE_KEY) ?? 'inbox'
  );
  const [selectedId, setSelectedId] = useState(null);

  const handleViewChange = (newView) => {
    setView(newView);
    setSelectedId(null);
    localStorage.setItem(VIEW_STORAGE_KEY, newView);
  };

  // Sync active feature from shell side-menu
  useEffect(() => {
    if (!activeFeature) return;
    if (activeFeature.startsWith('v:')) {
      const v = activeFeature.slice(2);
      handleViewChange(v);
    }
  }, [activeFeature]);

  // Thread list query
  const {
    data: threads = [],
    isLoading: threadsLoading,
    error: threadsError,
  } = useQuery({
    queryKey: ['mail', 'threads', view],
    queryFn: () => fetchThreadList(view),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Badge counts
  const { data: counts = { unread: 0, triage: 0, snoozed: 0, drafts: 0 } } = useQuery({
    queryKey: ['mail', 'counts'],
    queryFn: async () => ({
      unread: await fetchUnreadCount(),
      triage: await fetchTriageCount(),
      snoozed: await fetchSnoozedCount(),
      drafts: await fetchDraftCount(),
    }),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  // Publish side-menu
  useEffect(() => {
    if (isStandalone()) return;
    setMenu(buildMailMenu(view, counts.unread, counts.triage, counts.snoozed, counts.drafts))
      .catch(() => {});
  }, [view, counts.unread, counts.triage, counts.snoozed, counts.drafts]);

  // Publish iyke state for external observers
  useEffect(() => {
    publishIykeState('mail.view', view);
    publishIykeState('mail.selectedId', selectedId);
  }, [view, selectedId]);

  // db-updated refresh
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['mail'] });
    };
    window.addEventListener('db-updated', handler);
    return () => window.removeEventListener('db-updated', handler);
  }, [queryClient]);

  const viewLabel = {
    inbox: 'Inbox',
    triage: 'Triage',
    all: 'All Mail',
    drafts: 'Drafts',
  }[view] ?? 'Mail';

  // Triage view uses .dense-row--outbox (kit part 20)
  const isTriageView = view === 'triage';

  return html`
    <div class="frame" data-workspace="mail">
      <div class="frame-head">
        <div class="frame-title-wrap">
          <span class="frame-title-mark" aria-hidden="true">
            <${Icon} name="mail" size=${16} />
          </span>
          <h1 class="frame-title">
            Mail${counts.unread > 0 ? html` · <span class="badge">${counts.unread} unread</span>` : null}
          </h1>
        </div>
        <div class="frame-head-actions">
          <button class="btn btn-sm" title="Compose" aria-label="Compose new message">
            <${Icon} name="edit-3" size=${14} /> Compose
          </button>
        </div>
      </div>
      <div class="frame-body-flush pane-split">
        <!-- Left: thread list column -->
        <div class="mail-list" role="grid" aria-label=${`${viewLabel} thread list`}>
          <div class="mail-list-head">
            <div class="mail-list-head-title">${viewLabel}</div>
            ${counts.unread > 0 && view === 'inbox' ? html`
              <div class="mail-list-head-meta">
                ${counts.unread} unread · ${counts.snoozed} snoozed
              </div>
            ` : null}
          </div>
          <div class="mail-list-search">
            <div class="mail-list-search-row">
              <${Icon} name="search" size=${14} />
              <input
                type="search"
                class="input"
                placeholder=${`from:valentim · catalog`}
                aria-label="Search threads"
              />
            </div>
          </div>

          ${threadsLoading ? html`<${FeedbackState} state="loading" />` : null}
          ${threadsError ? html`<${FeedbackState} state="error" message=${threadsError.message} />` : null}
          ${!threadsLoading && !threadsError && threads.length === 0
            ? html`<${FeedbackState} state="empty" message="No threads in ${viewLabel}." />`
            : null
          }

          ${!threadsLoading && !threadsError && isTriageView
            ? html`
              <div class="mail-list-section">Flagged by Chi</div>
              ${threads.map((thread) => html`
                <div
                  key=${thread.id}
                  class=${cn('dense-row dense-row--outbox', { 'is-on': selectedId === thread.id })}
                  role="row"
                  tabIndex="0"
                  onClick=${() => setSelectedId(thread.id)}
                  onKeyDown=${(e) => e.key === 'Enter' && setSelectedId(thread.id)}
                >
                  <div class="mail-row-tick" aria-hidden="true"></div>
                  <div style=${{ flex: 1, minWidth: 0 }}>
                    <div class="mail-row-meta">
                      <span class="mail-row-from">${thread.from_name || thread.from_address}</span>
                      <span class="mail-row-time">${relativeTime(thread.received_at)}</span>
                    </div>
                    <div class="mail-row-subject">${thread.subject || '(no subject)'}</div>
                    ${thread.triage_category ? html`
                      <span class=${triageCategoryTag(thread.triage_category) ?? 'tag'}>
                        ${thread.triage_category}
                      </span>
                    ` : null}
                  </div>
                </div>
              `)}
            `
            : null
          }

          ${!threadsLoading && !threadsError && !isTriageView && threads.length > 0
            ? html`
              <div class="mail-list-section">Today</div>
              ${threads.map((thread) => html`
                <${MailRow}
                  key=${thread.id}
                  thread=${thread}
                  isSelected=${selectedId === thread.id}
                  onClick=${(id) => setSelectedId(id)}
                />
              `)}
            `
            : null
          }
        </div>

        <!-- Right: reader pane -->
        <${ReaderPane}
          messageId=${selectedId}
          queryClient=${queryClient}
          onBack=${() => setSelectedId(null)}
        />
      </div>
    </div>
  `;
}
