// com.ikenga.git · Branches view (WP-09)
//
// list/create/switch. `branch.list` is read-only and cheap to re-run after
// any mutation (G-03: re-read status rather than patch a cache). The two
// mutating calls this view makes — `branch.create` (optionally + checkout)
// and `branch.checkout` — both carry the G-12 confirm tier for a dirty tree:
// the sidecar (mock or real) returns `{ok:false, reason:'confirm-required'}`
// FIRST, before touching the working tree, and this view must show that as a
// named prompt and wait for an explicit second call with `confirm:true` —
// never auto-retry, never silently force it (01-plan.md §Destructive
// operation tiers, rpc.ts `BranchCheckoutArgs`/`BranchCreateArgs`).
//
// This module owns its own render loop into whatever `container` it is given
// (repaint-in-place), independent of App.ts's state machine — App.ts fully
// rebuilds its subtree on every `setState` (see App.ts `render()`), so a
// stateful form (open/closed, a pending confirm, an in-flight submit) has to
// live here rather than there. `onChanged` is the one hook back out: it's
// called after a successful mutation so the host can re-scan the project
// (dirty counts, header, other views) — this view has no way to push its
// fresh `snapshot` into App's rollup by itself.

import type { BranchInfo, RpcClient } from '../../app/rpc';
import { VOCAB } from '../../vocabulary';

export interface BranchesViewDeps {
  repo: string;
  rpc: RpcClient;
  onChanged?: () => void;
}

interface PendingConfirm {
  kind: 'create' | 'checkout';
  label: string;
  run: () => Promise<void>;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Mounts (and fully owns) the Branches view into `container`. Safe to call
 * again on a fresh container for a repo/view switch. There is no explicit
 * teardown handle: App.ts discards the whole subtree (and this container
 * with it) on its next render, so every async continuation here guards with
 * `alive()` — a check of `container.isConnected` — before touching the DOM,
 * rather than tracking a cancellation token.
 */
export function mountBranchesView(container: HTMLElement, deps: BranchesViewDeps): void {
  const { repo, rpc } = deps;

  let branches: BranchInfo[] = [];
  let loading = true;
  let loadError: string | null = null;
  let formOpen = false;
  let submitting = false;
  let pending: PendingConfirm | null = null;

  function alive(): boolean {
    return container.isConnected;
  }

  function repaint(): void {
    if (!alive()) return;
    container.innerHTML = '';
    container.appendChild(build());
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = null;
    repaint();
    try {
      const res = await rpc('branch.list', { repo, includeRemote: false });
      if (!alive()) return;
      loading = false;
      if (res.ok) {
        branches = res.branches;
      } else {
        loadError = res.message;
      }
    } catch (err) {
      if (!alive()) return;
      loading = false;
      loadError = err instanceof Error ? err.message : String(err);
    }
    repaint();
  }

  async function checkout(name: string, confirm: boolean): Promise<void> {
    submitting = true;
    loadError = null;
    repaint();
    try {
      const res = await rpc('branch.checkout', { repo, name, confirm });
      if (!alive()) return;
      submitting = false;
      if (res.ok) {
        pending = null;
        await load();
        deps.onChanged?.();
        return;
      }
      if (res.reason === 'confirm-required') {
        pending = { kind: 'checkout', label: name, run: () => checkout(name, true) };
        repaint();
        return;
      }
      loadError = res.message;
      repaint();
    } catch (err) {
      if (!alive()) return;
      submitting = false;
      loadError = err instanceof Error ? err.message : String(err);
      repaint();
    }
  }

  async function create(
    name: string,
    startPoint: string,
    andCheckout: boolean,
    confirm: boolean
  ): Promise<void> {
    submitting = true;
    loadError = null;
    repaint();
    try {
      const res = await rpc('branch.create', {
        repo,
        name,
        startPoint: startPoint || undefined,
        checkout: andCheckout,
        confirm: andCheckout ? confirm : undefined,
      });
      if (!alive()) return;
      submitting = false;
      if (res.ok) {
        pending = null;
        formOpen = false;
        await load();
        deps.onChanged?.();
        return;
      }
      if (res.reason === 'confirm-required') {
        pending = { kind: 'create', label: name, run: () => create(name, startPoint, andCheckout, true) };
        repaint();
        return;
      }
      loadError = res.message;
      repaint();
    } catch (err) {
      if (!alive()) return;
      submitting = false;
      loadError = err instanceof Error ? err.message : String(err);
      repaint();
    }
  }

  function buildRow(b: BranchInfo): HTMLElement {
    const li = el('li', `git-branch-row${b.isHead ? ' git-branch-row--current' : ''}`);
    li.appendChild(el('span', 'git-branch-row__name', b.name));
    if (b.isHead) li.appendChild(el('span', 'git-branch-row__tag', VOCAB.branches.current));

    if (b.upstream) {
      const ab = el('span', 'git-branch-row__ab');
      if (b.ahead) ab.appendChild(el('span', 'git-branch-row__ahead', `+${b.ahead}`));
      if (b.behind) ab.appendChild(el('span', 'git-branch-row__behind', `-${b.behind}`));
      if (!b.ahead && !b.behind) ab.textContent = '·';
      li.appendChild(ab);
    } else {
      li.appendChild(el('span', 'git-branch-row__no-upstream', VOCAB.branches.noUpstream));
    }

    if (b.worktreePath && !b.isHead) {
      const tag = el('span', 'git-branch-row__tag', VOCAB.branches.inWorktree);
      tag.title = VOCAB.branches.inWorktreeHint;
      li.appendChild(tag);
    }

    if (!b.isHead) {
      // A branch checked out in a LINKED worktree cannot be checked out here
      // too — git would refuse. Disabling rather than letting the call fail
      // avoids a round trip to discover what the `worktreePath` field already
      // told us (rpc.ts `BranchInfoSchema.worktreePath`).
      const disabled = submitting || !!b.worktreePath;
      const btn = button(VOCAB.branches.checkout, 'git-btn git-btn--ghost', () => void checkout(b.name, false), disabled);
      if (b.worktreePath) btn.title = VOCAB.branches.inWorktreeHint;
      li.appendChild(btn);
    }

    return li;
  }

  function buildForm(): HTMLElement {
    const card = el('div', 'git-card');
    card.appendChild(el('div', 'git-card__title', VOCAB.branches.create));

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'git-branches-view__input';
    nameInput.placeholder = VOCAB.branches.namePlaceholder;
    nameInput.setAttribute('aria-label', VOCAB.branches.name);

    const startInput = document.createElement('input');
    startInput.type = 'text';
    startInput.className = 'git-branches-view__input';
    startInput.placeholder = VOCAB.branches.startPoint;
    startInput.setAttribute('aria-label', VOCAB.branches.startPoint);

    const checkoutLabel = document.createElement('label');
    checkoutLabel.className = 'git-branches-view__checkbox-label';
    const checkoutInput = document.createElement('input');
    checkoutInput.type = 'checkbox';
    checkoutInput.checked = true;
    checkoutLabel.appendChild(checkoutInput);
    checkoutLabel.appendChild(document.createTextNode(VOCAB.branches.switchAfterCreate));

    const actions = el('div', 'git-branches-view__form-actions');
    const submitBtn = button(
      VOCAB.branches.create,
      'git-btn',
      () => {
        const name = nameInput.value.trim();
        if (!name) return;
        void create(name, startInput.value.trim(), checkoutInput.checked, false);
      },
      submitting
    );
    const cancelBtn = button(VOCAB.common.cancel, 'git-btn git-btn--ghost', () => {
      formOpen = false;
      repaint();
    });
    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);

    card.appendChild(nameInput);
    card.appendChild(startInput);
    card.appendChild(checkoutLabel);
    card.appendChild(actions);
    return card;
  }

  function buildConfirm(p: PendingConfirm): HTMLElement {
    const card = el('div', 'git-card git-card--warn');
    card.appendChild(el('div', 'git-card__title', VOCAB.states.confirmRequired));
    const hint =
      p.kind === 'checkout'
        ? VOCAB.branches.confirmSwitchHint(p.label)
        : VOCAB.branches.confirmCreateHint(p.label);
    card.appendChild(el('div', 'git-card__hint', hint));

    const actions = el('div', 'git-branches-view__form-actions');
    actions.appendChild(button(VOCAB.common.confirm, 'git-btn', () => void p.run(), submitting));
    actions.appendChild(
      button(VOCAB.common.cancel, 'git-btn git-btn--ghost', () => {
        pending = null;
        repaint();
      })
    );
    card.appendChild(actions);
    return card;
  }

  function buildError(message: string): HTMLElement {
    const card = el('div', 'git-card git-card--warn');
    card.appendChild(el('div', 'git-card__hint', message));
    return card;
  }

  function build(): HTMLElement {
    const root = el('div', 'git-branches-view');

    const toolbar = el('div', 'git-branches-view__toolbar');
    toolbar.appendChild(
      button(
        formOpen ? VOCAB.common.cancel : VOCAB.branches.create,
        'git-btn',
        () => {
          formOpen = !formOpen;
          repaint();
        },
        submitting
      )
    );
    root.appendChild(toolbar);

    if (formOpen && !pending) root.appendChild(buildForm());
    if (pending) root.appendChild(buildConfirm(pending));
    if (loadError) root.appendChild(buildError(loadError));

    if (loading && branches.length === 0) {
      root.appendChild(el('div', 'git-empty-inline', VOCAB.common.loading));
      return root;
    }

    if (branches.length === 0) {
      root.appendChild(el('div', 'git-empty-inline', VOCAB.branches.empty));
      return root;
    }

    const list = document.createElement('ul');
    list.className = 'git-branch-list';
    for (const b of branches) list.appendChild(buildRow(b));
    root.appendChild(list);
    return root;
  }

  void load();
}
