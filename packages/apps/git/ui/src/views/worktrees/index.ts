import type { RpcClient, WorktreeInfo } from '../../app/rpc';
import { VOCAB } from '../../vocabulary';
import './worktrees.css';

export interface WorktreesViewDeps {
  repo: string;
  rpc: RpcClient;
  onChanged?: () => void;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: (e: MouseEvent) => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

export function mountWorktreesView(container: HTMLElement, deps: WorktreesViewDeps): void {
  const { repo, rpc } = deps;

  let worktrees: WorktreeInfo[] = [];
  let loading = false;
  let error: string | null = null;
  let actionInProgress = false;

  let showModal = false;
  let modalPath = '';
  let modalBranch = '';
  let modalSubmitting = false;

  function alive(): boolean {
    return container.isConnected;
  }

  let repaintPending = false;
  function repaint(): void {
    if (!alive()) return;
    if (repaintPending) return;
    repaintPending = true;
    requestAnimationFrame(() => {
      repaintPending = false;
      if (!alive()) return;
      container.innerHTML = '';
      container.appendChild(build());
    });
  }

  async function loadWorktrees(): Promise<void> {
    loading = true;
    error = null;
    repaint();
    try {
      const res = await rpc('worktree.list', { repo });
      if (!alive()) return;
      loading = false;
      if (res.ok) {
        worktrees = res.worktrees;
      } else {
        error = res.message;
      }
      repaint();
    } catch (err) {
      if (!alive()) return;
      loading = false;
      error = String(err);
      repaint();
    }
  }

  async function handleAddWorktree(): Promise<void> {
    if (!modalPath.trim()) return;
    modalSubmitting = true;
    repaint();
    try {
      const res = await rpc('worktree.add', {
        repo,
        path: modalPath.trim(),
        branch: modalBranch.trim() || undefined,
      });
      modalSubmitting = false;
      if (res.ok) {
        showModal = false;
        modalPath = '';
        modalBranch = '';
        deps.onChanged?.();
        void loadWorktrees();
      } else {
        repaint();
      }
    } catch {
      modalSubmitting = false;
      repaint();
    }
  }

  async function handleRemoveWorktree(wt: WorktreeInfo): Promise<void> {
    if (wt.isMain) return;
    if (!confirm(`Are you sure you want to remove worktree at ${wt.path}?`)) return;
    actionInProgress = true;
    repaint();
    try {
      const res = await rpc('worktree.remove', { repo, path: wt.path });
      actionInProgress = false;
      if (res.ok) {
        deps.onChanged?.();
        void loadWorktrees();
      } else {
        repaint();
      }
    } catch {
      actionInProgress = false;
      repaint();
    }
  }

  function build(): HTMLElement {
    const root = el('div', 'git-worktrees');

    // Header Toolbar
    const toolbar = el('div', 'git-worktrees__toolbar');
    const left = el('div', 'git-worktrees__toolbar-left');
    left.appendChild(el('span', 'git-file-group__title-text', VOCAB.nav.worktrees));
    toolbar.appendChild(left);

    const right = el('div', 'git-worktrees__toolbar-right');
    const refreshBtn = button('Refresh', 'git-btn git-btn--ghost git-btn--sm', () => void loadWorktrees(), loading);
    right.appendChild(refreshBtn);

    const addBtn = button('+ New Worktree', 'git-btn git-btn--primary git-btn--sm', () => {
      showModal = true;
      repaint();
    });
    right.appendChild(addBtn);
    toolbar.appendChild(right);
    root.appendChild(toolbar);

    // Content
    const content = el('div', 'git-worktrees__content');
    const listPane = el('div', 'git-worktrees__list-pane');

    if (loading && worktrees.length === 0) {
      listPane.appendChild(el('div', 'git-empty-inline', VOCAB.common.loading));
    } else if (error) {
      listPane.appendChild(el('div', 'git-empty-inline', `Error loading worktrees: ${error}`));
    } else if (worktrees.length === 0) {
      listPane.appendChild(el('div', 'git-empty-inline', 'No linked worktrees found.'));
    } else {
      for (const wt of worktrees) {
        const card = el('div', 'git-worktree-card');

        const head = el('div', 'git-worktree-card__head');
        const pathSpan = el('span', 'git-worktree-card__path', wt.path);
        head.appendChild(pathSpan);

        if (wt.isMain) {
          head.appendChild(el('span', 'git-worktree-badge git-worktree-badge--main', 'Main Tree'));
        } else if (wt.locked) {
          head.appendChild(el('span', 'git-worktree-badge git-worktree-badge--locked', 'Locked'));
        }
        card.appendChild(head);

        const meta = el('div', 'git-worktree-card__meta');
        if (wt.branch) {
          meta.appendChild(el('span', 'git-pr-card__branch', `Branch: ${wt.branch}`));
        } else if (wt.head) {
          meta.appendChild(el('span', 'git-pr-card__branch', `HEAD: ${wt.head.slice(0, 7)}`));
        }

        if (wt.ownerTerminalId) {
          meta.appendChild(el('span', 'git-worktree-badge git-worktree-badge--terminal', `Terminal: ${wt.ownerTerminalId}`));
        }
        card.appendChild(meta);

        if (!wt.isMain) {
          const actionsRow = el('div', 'git-worktree-card__actions');
          const removeBtn = button(
            'Remove Worktree',
            'git-btn git-btn--ghost git-btn--sm',
            () => void handleRemoveWorktree(wt),
            actionInProgress
          );
          actionsRow.appendChild(removeBtn);
          card.appendChild(actionsRow);
        }

        listPane.appendChild(card);
      }
    }

    content.appendChild(listPane);
    root.appendChild(content);

    // Modal
    if (showModal) {
      const overlay = el('div', 'git-pr-modal-overlay');
      const modal = el('div', 'git-pr-modal');

      modal.appendChild(el('div', 'git-pr-modal__title', 'New Worktree'));

      const pathGroup = el('div', 'git-pr-modal__field');
      pathGroup.appendChild(el('label', 'git-pr-modal__label', 'Worktree Path'));
      const pathInput = el('input', 'git-pr-modal__input') as HTMLInputElement;
      pathInput.value = modalPath;
      pathInput.placeholder = '../worktree-name';
      pathInput.addEventListener('input', (e) => {
        modalPath = (e.target as HTMLInputElement).value;
      });
      pathGroup.appendChild(pathInput);
      modal.appendChild(pathGroup);

      const branchGroup = el('div', 'git-pr-modal__field');
      branchGroup.appendChild(el('label', 'git-pr-modal__label', 'Branch Name (optional)'));
      const branchInput = el('input', 'git-pr-modal__input') as HTMLInputElement;
      branchInput.value = modalBranch;
      branchInput.placeholder = 'feat/agent-worktree';
      branchInput.addEventListener('input', (e) => {
        modalBranch = (e.target as HTMLInputElement).value;
      });
      branchGroup.appendChild(branchInput);
      modal.appendChild(branchGroup);

      const footer = el('div', 'git-pr-modal__footer');
      const cancelBtn = button('Cancel', 'git-btn git-btn--ghost', () => {
        showModal = false;
        repaint();
      });
      const submitBtn = button(
        'Create Worktree',
        'git-btn git-btn--primary',
        () => void handleAddWorktree(),
        modalSubmitting || !modalPath.trim()
      );

      footer.appendChild(cancelBtn);
      footer.appendChild(submitBtn);
      modal.appendChild(footer);

      overlay.appendChild(modal);
      root.appendChild(overlay);
    }

    return root;
  }

  void loadWorktrees();
}
