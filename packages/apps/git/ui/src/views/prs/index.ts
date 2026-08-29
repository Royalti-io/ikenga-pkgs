import type { GhProbe, PrSummary, RpcClient } from '../../app/rpc';
import { createResizer } from '../../components/resizer.js';
import { VOCAB } from '../../vocabulary';
import './prs.css';

export interface PrsViewDeps {
  repo: string;
  rpc: RpcClient;
  onChanged?: () => void;
}

export function openExternalOrWebview(url: string): void {
  if (!url) return;
  try {
    const parentWindow = window.parent ?? window;
    if ((parentWindow as any).__IKENGA_HOST__?.openUrl) {
      (parentWindow as any).__IKENGA_HOST__.openUrl(url);
      return;
    }
  } catch {
    // Fall through to window.open
  }
  window.open(url, '_blank', 'noopener,noreferrer');
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

export function mountPrsView(container: HTMLElement, deps: PrsViewDeps): void {
  const { repo, rpc } = deps;

  let probe: GhProbe | null = null;
  let probeLoading = true;
  let probeError: string | null = null;

  let prs: PrSummary[] = [];
  let prsLoading = false;
  let prsError: string | null = null;

  let filterState: 'open' | 'closed' | 'merged' | 'all' = 'open';
  let selectedPr: PrSummary | null = null;

  let showModal = false;
  let modalTitle = '';
  let modalBody = '';
  let modalBase = 'main';
  let modalDraft = false;
  let modalSubmitting = false;

  let actionInProgress = false;

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

  async function loadProbe(): Promise<void> {
    probeLoading = true;
    probeError = null;
    repaint();
    try {
      const res = await rpc('system.probe', {});
      if (!alive()) return;
      probeLoading = false;
      if (res.ok) {
        probe = res.gh;
        if (probe.present && probe.authenticated) {
          void loadPrs();
          return;
        }
      } else {
        probeError = res.message;
      }
      repaint();
    } catch (err) {
      if (!alive()) return;
      probeLoading = false;
      probeError = String(err);
      repaint();
    }
  }

  async function loadPrs(): Promise<void> {
    if (prs.length === 0) {
      prsLoading = true;
      prsError = null;
      repaint();
    }
    try {
      const res = await rpc('pr.list', { repo, state: filterState });
      if (!alive()) return;
      prsLoading = false;
      if (res.ok) {
        prs = res.prs;
        if (selectedPr) {
          const match = prs.find((p) => p.number === selectedPr!.number);
          selectedPr = match ?? prs[0] ?? null;
        } else if (prs.length > 0) {
          selectedPr = prs[0]!;
        }
      } else {
        prsError = res.message;
      }
      repaint();
    } catch (err) {
      if (!alive()) return;
      prsLoading = false;
      prsError = String(err);
      repaint();
    }
  }

  async function handleCheckout(pr: PrSummary): Promise<void> {
    actionInProgress = true;
    repaint();
    try {
      const res = await rpc('pr.checkout', { repo, number: pr.number });
      actionInProgress = false;
      if (res.ok) {
        deps.onChanged?.();
      }
      repaint();
    } catch {
      actionInProgress = false;
      repaint();
    }
  }

  async function handleCreatePr(): Promise<void> {
    if (!modalTitle.trim()) return;
    modalSubmitting = true;
    repaint();
    try {
      const res = await rpc('pr.create', {
        repo,
        title: modalTitle,
        body: modalBody,
        base: modalBase,
        draft: modalDraft,
      });
      modalSubmitting = false;
      if (res.ok) {
        showModal = false;
        modalTitle = '';
        modalBody = '';
        void loadPrs();
      } else {
        repaint();
      }
    } catch {
      modalSubmitting = false;
      repaint();
    }
  }

  function build(): HTMLElement {
    const root = el('div', 'git-prs');

    if (probeLoading) {
      root.appendChild(el('div', 'git-empty-inline', VOCAB.common.loading));
      return root;
    }

    if (probeError) {
      root.appendChild(el('div', 'git-empty-inline', `Error checking gh: ${probeError}`));
      return root;
    }

    if (!probe || !probe.present) {
      const banner = el('div', 'git-prs-stub');
      banner.appendChild(el('div', 'git-empty-inline', VOCAB.prs.ghMissing));
      const code = el('pre', 'git-prs-install-cmd', 'sudo apt install gh   # or: brew install gh');
      code.style.marginTop = 'var(--space-2)';
      code.style.fontFamily = 'var(--font-mono)';
      code.style.color = 'var(--fg-muted)';
      banner.appendChild(code);
      root.appendChild(banner);
      return root;
    }

    if (!probe.authenticated) {
      const banner = el('div', 'git-prs-stub');
      banner.appendChild(el('div', 'git-empty-inline', VOCAB.prs.ghUnauthenticated));
      const code = el('pre', 'git-prs-install-cmd', 'gh auth login');
      code.style.marginTop = 'var(--space-2)';
      code.style.fontFamily = 'var(--font-mono)';
      code.style.color = 'var(--fg-muted)';
      banner.appendChild(code);
      root.appendChild(banner);
      return root;
    }

    // Header Toolbar
    const toolbar = el('div', 'git-prs__toolbar');

    const left = el('div', 'git-prs__toolbar-left');
    left.appendChild(el('span', 'git-file-group__title-text', 'Pull Requests'));

    const filterBox = el('div', 'git-prs__filters');
    filterBox.style.display = 'flex';
    filterBox.style.gap = '4px';

    const states: Array<'open' | 'closed' | 'merged' | 'all'> = ['open', 'closed', 'merged', 'all'];
    for (const st of states) {
      const btn = button(
        st.toUpperCase(),
        `git-prs__filter-btn${filterState === st ? ' git-prs__filter-btn--active' : ' git-btn--ghost'}`,
        () => {
          if (filterState !== st) {
            filterState = st;
            void loadPrs();
          }
        }
      );
      filterBox.appendChild(btn);
    }
    left.appendChild(filterBox);
    toolbar.appendChild(left);

    const right = el('div', 'git-prs__toolbar-right');
    const refreshBtn = button('Refresh', 'git-btn git-btn--ghost git-btn--sm', () => void loadPrs(), prsLoading);
    right.appendChild(refreshBtn);

    const newBtn = button('+ New PR', 'git-btn git-btn--primary git-btn--sm', () => {
      showModal = true;
      repaint();
    });
    right.appendChild(newBtn);
    toolbar.appendChild(right);
    root.appendChild(toolbar);

    // Main Body
    const content = el('div', 'git-prs__content');

    const listPane = el('div', 'git-prs__list-pane');

    if (prsLoading && prs.length === 0) {
      listPane.appendChild(el('div', 'git-empty-inline', VOCAB.common.loading));
    } else if (prsError) {
      const errEl = el('div', 'git-empty-inline git-prs__error');
      const lower = prsError.toLowerCase();
      if (lower.includes('401') || lower.includes('bad credentials') || lower.includes('auth login') || lower.includes('graphql') || prsError.trim() === 'gh pr list failed:') {
        errEl.innerHTML = `<strong>GitHub authentication required or expired.</strong><br><span style="font-size:0.85em;opacity:0.8;margin-top:6px;display:block;">Run <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;">gh auth login</code> in your terminal to re-authenticate.</span>`;
      } else {
        errEl.textContent = prsError.startsWith('gh pr list failed:') ? prsError : `Error listing PRs: ${prsError}`;
      }
      listPane.appendChild(errEl);
    } else if (prs.length === 0) {
      listPane.appendChild(el('div', 'git-empty-inline', 'No pull requests found.'));
    } else {
      for (const pr of prs) {
        const isSel = selectedPr?.number === pr.number;
        const card = el('div', `git-pr-card${isSel ? ' git-pr-card--active' : ''}`);

        const head = el('div', 'git-pr-card__head');
        const titleSpan = el('span', 'git-pr-card__title', pr.title);
        const numSpan = el('span', 'git-pr-card__number', `#${String(pr.number)}`);
        head.appendChild(titleSpan);
        head.appendChild(numSpan);
        card.appendChild(head);

        const meta = el('div', 'git-pr-card__meta');
        meta.appendChild(document.createTextNode(`by @${pr.author.login}`));

        const branchTag = el('span', 'git-pr-card__branch', `${pr.headRefName} → ${pr.baseRefName}`);
        meta.appendChild(branchTag);

        if (pr.isDraft) {
          meta.appendChild(el('span', 'git-pr-badge git-pr-badge--draft', 'Draft'));
        }

        if (pr.reviewDecision === 'APPROVED') {
          meta.appendChild(el('span', 'git-pr-badge git-pr-badge--approved', 'Approved'));
        } else if (pr.reviewDecision === 'CHANGES_REQUESTED') {
          meta.appendChild(el('span', 'git-pr-badge git-pr-badge--changes', 'Changes Requested'));
        }

        card.appendChild(meta);

        card.addEventListener('click', () => {
          selectedPr = pr;
          repaint();
        });

        listPane.appendChild(card);
      }
    }

    const detailPane = el('div', 'git-prs__detail-pane');

    if (selectedPr) {
      const pr = selectedPr;
      const header = el('div', 'git-pr-detail__header');

      const titleEl = el('h2', 'git-pr-detail__title', `#${String(pr.number)} ${pr.title}`);
      header.appendChild(titleEl);

      const metaLine = el('div', 'git-pr-card__meta');
      metaLine.appendChild(document.createTextNode(`Author: @${pr.author.login} · Branch: `));
      metaLine.appendChild(el('span', 'git-pr-card__branch', `${pr.headRefName} → ${pr.baseRefName}`));

      if (pr.additions !== undefined || pr.deletions !== undefined) {
        const stats = el('span', 'git-pr-detail__stats');
        stats.appendChild(el('span', 'git-pr-detail__additions', `+${String(pr.additions ?? 0)}`));
        stats.appendChild(document.createTextNode(' '));
        stats.appendChild(el('span', 'git-pr-detail__deletions', `-${String(pr.deletions ?? 0)}`));
        if (pr.changedFiles) {
          stats.appendChild(document.createTextNode(` in ${String(pr.changedFiles)} file${pr.changedFiles === 1 ? '' : 's'}`));
        }
        metaLine.appendChild(document.createTextNode(' · '));
        metaLine.appendChild(stats);
      }

      header.appendChild(metaLine);

      if (pr.labels && pr.labels.length > 0) {
        const labelsRow = el('div', 'git-pr-detail__labels');
        for (const l of pr.labels) {
          const lbl = el('span', 'git-pr-label', l.name);
          if (l.color) {
            lbl.style.borderLeft = `3px solid #${l.color}`;
          }
          labelsRow.appendChild(lbl);
        }
        header.appendChild(labelsRow);
      }

      const actions = el('div', 'git-pr-detail__actions');

      const checkoutBtn = button(
        'Checkout PR',
        'git-btn git-btn--primary',
        () => void handleCheckout(pr),
        actionInProgress
      );
      actions.appendChild(checkoutBtn);

      const openLink = el('a', 'git-btn git-btn--ghost', 'Open on GitHub') as HTMLAnchorElement;
      openLink.href = pr.url;
      openLink.target = '_blank';
      openLink.rel = 'noreferrer';
      openLink.addEventListener('click', (e) => {
        e.preventDefault();
        openExternalOrWebview(pr.url);
      });
      actions.appendChild(openLink);

      header.appendChild(actions);
      detailPane.appendChild(header);

      // Description Section
      const descSection = el('div', 'git-pr-detail__section');
      descSection.appendChild(el('h3', 'git-pr-detail__section-title', 'Description'));

      const bodyContent = el('div', 'git-pr-detail__body');
      if (pr.body && pr.body.trim()) {
        bodyContent.textContent = pr.body;
      } else {
        const emptyDesc = el('p', 'git-pr-detail__empty-desc', 'No description provided.');
        bodyContent.appendChild(emptyDesc);
      }
      descSection.appendChild(bodyContent);
      detailPane.appendChild(descSection);

      // Comments Section
      const comments = pr.comments ?? [];
      const commentsSection = el('div', 'git-pr-detail__section');
      commentsSection.appendChild(el('h3', 'git-pr-detail__section-title', `Comments (${String(comments.length)})`));

      if (comments.length === 0) {
        commentsSection.appendChild(el('p', 'git-pr-detail__empty-desc', 'No comments on this pull request yet.'));
      } else {
        const list = el('div', 'git-pr-comments-list');
        for (const c of comments) {
          const card = el('div', 'git-pr-comment');
          const commHeader = el('div', 'git-pr-comment__header');
          commHeader.appendChild(el('span', 'git-pr-comment__author', `@${c.author.login}`));
          commHeader.appendChild(el('span', 'git-pr-comment__date', new Date(c.createdAt).toLocaleDateString()));
          card.appendChild(commHeader);
          const commBody = el('div', 'git-pr-comment__body', c.body);
          card.appendChild(commBody);
          list.appendChild(card);
        }
        commentsSection.appendChild(list);
      }
      detailPane.appendChild(commentsSection);
    } else {
      detailPane.appendChild(el('div', 'git-empty-inline', 'Select a pull request to view details.'));
    }

    const resizer = createResizer(listPane, 'prs', { minWidth: 240, maxWidth: 600, defaultWidth: 320 });

    content.appendChild(listPane);
    content.appendChild(resizer);
    content.appendChild(detailPane);

    root.appendChild(content);

    // Modal
    if (showModal) {
      const overlay = el('div', 'git-pr-modal-overlay');
      const modal = el('div', 'git-pr-modal');

      modal.appendChild(el('div', 'git-pr-modal__title', 'New Pull Request'));

      // Title
      const titleGroup = el('div', 'git-pr-modal__field');
      titleGroup.appendChild(el('label', 'git-pr-modal__label', 'Title'));
      const titleInput = el('input', 'git-pr-modal__input') as HTMLInputElement;
      titleInput.value = modalTitle;
      titleInput.placeholder = 'PR Title...';
      titleInput.addEventListener('input', (e) => {
        modalTitle = (e.target as HTMLInputElement).value;
      });
      titleGroup.appendChild(titleInput);
      modal.appendChild(titleGroup);

      // Body
      const bodyGroup = el('div', 'git-pr-modal__field');
      bodyGroup.appendChild(el('label', 'git-pr-modal__label', 'Description'));
      const bodyTextarea = el('textarea', 'git-pr-modal__textarea') as HTMLTextAreaElement;
      bodyTextarea.value = modalBody;
      bodyTextarea.placeholder = 'Describe your changes...';
      bodyTextarea.addEventListener('input', (e) => {
        modalBody = (e.target as HTMLTextAreaElement).value;
      });
      bodyGroup.appendChild(bodyTextarea);
      modal.appendChild(bodyGroup);

      // Base Branch
      const baseGroup = el('div', 'git-pr-modal__field');
      baseGroup.appendChild(el('label', 'git-pr-modal__label', 'Base Branch'));
      const baseInput = el('input', 'git-pr-modal__input') as HTMLInputElement;
      baseInput.value = modalBase;
      baseInput.addEventListener('input', (e) => {
        modalBase = (e.target as HTMLInputElement).value;
      });
      baseGroup.appendChild(baseInput);
      modal.appendChild(baseGroup);

      // Draft
      const draftGroup = el('div', 'git-pr-modal__field');
      draftGroup.style.flexDirection = 'row';
      draftGroup.style.alignItems = 'center';
      const draftCheckbox = el('input') as HTMLInputElement;
      draftCheckbox.type = 'checkbox';
      draftCheckbox.checked = modalDraft;
      draftCheckbox.addEventListener('change', (e) => {
        modalDraft = (e.target as HTMLInputElement).checked;
      });
      draftGroup.appendChild(draftCheckbox);
      draftGroup.appendChild(el('label', 'git-pr-modal__label', 'Create as draft PR'));
      modal.appendChild(draftGroup);

      // Footer
      const footer = el('div', 'git-pr-modal__footer');
      const cancelBtn = button('Cancel', 'git-btn git-btn--ghost', () => {
        showModal = false;
        repaint();
      });
      const submitBtn = button(
        'Submit PR',
        'git-btn git-btn--primary',
        () => void handleCreatePr(),
        modalSubmitting || !modalTitle.trim()
      );

      footer.appendChild(cancelBtn);
      footer.appendChild(submitBtn);
      modal.appendChild(footer);

      overlay.appendChild(modal);
      root.appendChild(overlay);
    }

    return root;
  }

  void loadProbe();
}
