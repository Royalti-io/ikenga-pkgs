// com.ikenga.studio · Launcher (Wave 1 rebuild — concept L-A "production desk")
//
// The pre-project shell (Screen S1). Pre-empts the Pattern-C pane layout when
// no project is open (project-store isOpen === false) and unmounts once a
// project opens. Visual + behavioral spec: plans/studio/designs/redesign/
// launcher-a-production-desk.html, with grafts from L-B (teaching footer +
// dashed Custom card) and L-C (⌘K command palette).
//
// THE HONESTY RULE (this rebuild's core): render ONLY data that has a real
// seam. Recents come from the real project.list() (a ProjectSummary that
// carries name / path / last-opened but NO archetype / aspect / cell-count /
// render-coverage / exported-status for an un-opened project), so those
// decorations are dropped rather than faked. Widgets whose data isn't reachable
// in Wave 1 are OMITTED (see the report's deferral list): poster thumbnails,
// "Latest export" card, render-engine stat facts, a user-name greeting.
//
// Every create/open/list call is wrapped in try/catch with a visible surface
// (toast + inline error). Open-folder consumes the shell's real picker/grant
// result honestly — cancel does nothing, denial shows "access denied", success
// opens the actually-picked path. No pkg-side trust pre-modal (the shell's
// native picker + grant dialog is the single consent surface).

import { useCallback, useEffect, useRef, useState } from 'react';

import { archetypeApi, projectApi, renderApi, getMcpClient, type McpClient } from '../mcp-client';
import { openFolder } from '../bridge';
import { useProjectStore } from '../project-store';
import type { AspectRatio, Archetype, EngineCapability } from '../mcp-types';
import { Icon } from './launcher/icons';
import { Gallery } from './launcher/Gallery';
import { Recents } from './launcher/Recents';
import { CommandPalette, type PaletteAction } from './launcher/CommandPalette';
import { derivePhase, normalizeRecent, type RecentRow } from './launcher/presentation';

// ─── toasts ──────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // Strip the internal '[studio] <tool> failed:' prefix from user-facing copy.
  return m.replace(/^\[studio\]\s*/, '').slice(0, 200);
}

// ─── view ──────────────────────────────────────────────────────────────────

export function LauncherView() {
  const openProject = useProjectStore((s) => s.openProject);

  const clientRef = useRef<McpClient | null>(null);
  const [mode, setMode] = useState<'real' | 'mock' | null>(null);

  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [archLoading, setArchLoading] = useState(true);
  const [archError, setArchError] = useState<string | null>(null);

  const [recents, setRecents] = useState<RecentRow[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(true);
  const [recentsError, setRecentsError] = useState<string | null>(null);

  const [engines, setEngines] = useState<EngineCapability[]>([]);

  const [picked, setPicked] = useState<Archetype | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const galleryRef = useRef<HTMLDivElement>(null);

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId.current;
    setToasts((cur) => [...cur, { ...t, id }]);
    window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 6500);
    return id;
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  // ─── loaders ────────────────────────────────────────────────────────────

  const loadArchetypes = useCallback(async () => {
    setArchLoading(true);
    setArchError(null);
    try {
      const client = clientRef.current ?? (clientRef.current = await getMcpClient());
      setMode(client.mode);
      const { archetypes: list } = await archetypeApi.list(client);
      setArchetypes(list);
    } catch (e) {
      setArchError(errText(e));
      setArchetypes([]);
    } finally {
      setArchLoading(false);
    }
  }, []);

  const loadRecents = useCallback(async () => {
    setRecentsLoading(true);
    setRecentsError(null);
    try {
      const client = clientRef.current ?? (clientRef.current = await getMcpClient());
      setMode(client.mode);
      const { projects } = await projectApi.list(client);
      const rows = (projects ?? [])
        .map(normalizeRecent)
        .filter((r): r is RecentRow => r !== null);
      setRecents(rows);
    } catch (e) {
      setRecentsError(errText(e));
      setRecents([]);
    } finally {
      setRecentsLoading(false);
    }
  }, []);

  const loadEngines = useCallback(async () => {
    try {
      const client = clientRef.current ?? (clientRef.current = await getMcpClient());
      const { engines: list } = await renderApi.list_engines(client);
      setEngines(list ?? []);
    } catch {
      // Honest degrade: no engine seam → omit the rail card entirely.
      setEngines([]);
    }
  }, []);

  useEffect(() => {
    void loadArchetypes();
    void loadRecents();
    void loadEngines();
  }, [loadArchetypes, loadRecents, loadEngines]);

  // ─── actions ────────────────────────────────────────────────────────────

  const createAndOpen = useCallback(
    async (archetype: Archetype, name: string, aspect: AspectRatio) => {
      setCreating(true);
      setCreateError(null);
      try {
        const client = clientRef.current ?? (clientRef.current = await getMcpClient());
        const { project_id } = await projectApi.create(client, {
          archetype_id: archetype.id,
          name,
          path: `~/Projects/${name}`,
          aspect_ratio: aspect,
        });
        setPicked(null);
        openProject({ project_id, name, archetype_id: archetype.id, aspect_ratio: aspect });
      } catch (e) {
        const msg = errText(e);
        setCreateError(msg); // keep the panel + its input; surface inline
        pushToast({ kind: 'error', title: `Couldn’t create “${name}”`, detail: msg });
      } finally {
        setCreating(false);
      }
    },
    [openProject, pushToast],
  );

  // Open a project by path, then fetch its real archetype/aspect (project.info)
  // so the in-project header shows the truth rather than a guess.
  const openByPath = useCallback(
    async (path: string, fallbackName: string) => {
      const client = clientRef.current ?? (clientRef.current = await getMcpClient());
      const { project_id } = await projectApi.open(client, path);
      let archetype_id = '';
      let aspect_ratio: AspectRatio = '16:9';
      let name = fallbackName;
      try {
        const info = await projectApi.info(client, project_id);
        if (info?.archetype_id) archetype_id = info.archetype_id;
        if (info?.aspect_ratio) aspect_ratio = info.aspect_ratio;
        if (info?.title) name = info.title;
      } catch {
        // info is best-effort enrichment; opening still succeeds without it.
      }
      openProject({ project_id, name, archetype_id, aspect_ratio });
    },
    [openProject],
  );

  const openRecentRow = useCallback(
    async (row: RecentRow) => {
      if (opening) return;
      setOpening(true);
      try {
        await openByPath(row.path || `~/Projects/${row.name}`, row.name);
      } catch (e) {
        pushToast({
          kind: 'error',
          title: `Couldn’t open “${row.name}”`,
          detail: errText(e),
          action: { label: 'Retry', run: () => void openRecentRow(row) },
        });
      } finally {
        setOpening(false);
      }
    },
    [opening, openByPath, pushToast],
  );

  const resumeLast = useCallback(() => {
    if (recents.length > 0) void openRecentRow(recents[0]);
  }, [recents, openRecentRow]);

  // Open-folder: the shell pops its OWN native picker + grant dialog. We consume
  // the real result honestly — no pkg-side pre-modal, no hardcoded mock project.
  const openFolderFlow = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await openFolder();
      const sc = (res.structuredContent ?? {}) as {
        ok?: boolean;
        cancelled?: boolean;
        granted?: boolean;
        path?: string;
      };
      if (sc.cancelled) return; // user cancelled the OS picker — do nothing
      if (sc.ok === false || sc.granted === false || !sc.path) {
        pushToast({ kind: 'info', title: 'Access denied — nothing opened' });
        return;
      }
      await openByPath(sc.path, sc.path.split('/').filter(Boolean).pop() ?? 'project');
      void loadRecents(); // the just-opened project now belongs in recents
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Couldn’t open that folder',
        detail: errText(e),
        action: { label: 'Try again', run: () => void openFolderFlow() },
      });
    } finally {
      setOpening(false);
    }
  }, [opening, openByPath, pushToast, loadRecents]);

  const toggleGallery = useCallback(() => {
    setGalleryOpen((v) => {
      const next = !v;
      if (next) {
        window.setTimeout(
          () => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
          0,
        );
      }
      return next;
    });
  }, []);

  const pickArchetype = useCallback((a: Archetype) => {
    setPicked(a);
    setCreateError(null);
    setGalleryOpen(true);
  }, []);

  const onDisabledArchetype = useCallback(
    (a: Archetype) => {
      pushToast({
        kind: 'info',
        title: `${a.name} isn’t available yet`,
        detail: 'Explainer, Product & Tutorial are live now — the rest ship in a later phase.',
      });
    },
    [pushToast],
  );

  const onCustom = useCallback(() => {
    pushToast({
      kind: 'info',
      title: 'Custom chains are composed with your Chi',
      detail: 'Ask in chat to start one — the desk seeds one-click templates only.',
    });
  }, [pushToast]);

  // ─── keyboard: R / O / N + ⌘K ─────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (paletteOpen || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'r' && recents.length > 0) {
        e.preventDefault();
        resumeLast();
      } else if (k === 'o') {
        e.preventDefault();
        void openFolderFlow();
      } else if (k === 'n') {
        e.preventDefault();
        toggleGallery();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, recents.length, resumeLast, openFolderFlow, toggleGallery]);

  // ─── command-palette actions ──────────────────────────────────────────────

  const paletteActions: PaletteAction[] = [];
  if (recents.length > 0) {
    paletteActions.push({
      id: 'resume',
      label: 'Resume last project',
      hint: recents[0].name,
      icon: 'play',
      keywords: 'recent open continue',
      run: resumeLast,
    });
  }
  paletteActions.push(
    { id: 'open', label: 'Open folder…', hint: 'pick a project folder on disk', icon: 'folder', keywords: 'existing disk import', run: () => void openFolderFlow() },
    { id: 'new', label: 'New project', hint: 'seed beats & cells from a template', icon: 'plus', keywords: 'create template archetype', run: toggleGallery },
  );
  for (const a of archetypes) {
    // Same phase guard as the gallery: unavailable (P2/P3) archetypes don't
    // get a create shortcut — the palette must not bypass the disabled card.
    if (!derivePhase(a.id).available) continue;
    paletteActions.push({
      id: `new-${a.id}`,
      label: `New ${a.name} project`,
      hint: 'template',
      icon: 'plus',
      keywords: `create ${a.id}`,
      run: () => pickArchetype(a),
    });
  }

  const engineReady = mode === 'real';

  return (
    <div className="launcher-desk flex h-full min-h-0 flex-col overflow-auto bg-base text-fg">
      {/* App header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-soft bg-sunken/90 px-5 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-md border"
            style={{ color: 'var(--tint-studio-fg)', background: 'var(--tint-studio-bg)', borderColor: 'color-mix(in srgb, var(--ember) 34%, var(--border))' }}
          >
            <Icon name="film" size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-fg">Studio</div>
            <div className="font-mono text-[10px] leading-tight text-fg-faint">no project open</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="hidden items-center gap-2 rounded-full border border-soft px-2.5 py-1 font-mono text-[11px] text-fg-muted sm:inline-flex"
            style={{ background: 'var(--bg-surface)' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: engineReady ? 'var(--live)' : 'var(--fg-faint)',
                boxShadow: engineReady ? '0 0 0 3px var(--live-soft)' : 'none',
              }}
            />
            {engineReady ? 'Studio engine · ready' : 'Demo data'}
          </span>
          <button
            type="button"
            onClick={() => void openFolderFlow()}
            disabled={opening}
            className="flex items-center gap-2 rounded-md border border-soft px-3 py-1.5 text-xs text-fg-muted hover:border-[var(--chip-carve)] hover:text-fg disabled:opacity-60"
          >
            <Icon name="folder" size={14} /> Open folder…
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-7">
        {/* Command band */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1
              className="text-[28px] font-medium leading-tight tracking-[-0.01em]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Back at the{' '}
              <em className="not-italic" style={{ fontStyle: 'italic', color: 'var(--kola-amber)' }}>
                desk
              </em>
              .
            </h1>
            <p className="mt-1.5 max-w-[46ch] text-sm text-fg-muted">
              Pick up a project where you left it, open a folder from disk, or start a new one from a
              template. Chat with your Chi still drives the same production loop — the desk just skips
              the blank start.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              {recents.length > 0 && (
                <button
                  type="button"
                  onClick={resumeLast}
                  disabled={opening}
                  className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                  style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
                >
                  <Icon name="play" size={15} filled /> Resume last project
                </button>
              )}
              <button
                type="button"
                onClick={() => void openFolderFlow()}
                disabled={opening}
                className="flex items-center gap-2 rounded-lg border border-soft bg-raised px-4 py-2.5 text-sm font-semibold text-fg hover:border-[var(--chip-carve)] disabled:opacity-60"
              >
                <Icon name="folder" size={15} /> Open folder…
              </button>
              <button
                type="button"
                onClick={toggleGallery}
                aria-expanded={galleryOpen}
                aria-controls="new-project-gallery"
                className="flex items-center gap-2 rounded-lg border border-soft bg-raised px-4 py-2.5 text-sm font-semibold text-fg hover:border-[var(--chip-carve)]"
              >
                <Icon name="plus" size={15} /> New project
                <Icon
                  name="chevron"
                  size={14}
                  className={'transition-transform ' + (galleryOpen ? 'rotate-180' : '')}
                />
              </button>
            </div>
            <div className="flex gap-3.5 font-mono text-[11px] text-fg-faint" aria-hidden="true">
              <span>
                <kbd className="mr-1 rounded border border-soft px-1.5 py-px">R</kbd>resume
              </span>
              <span>
                <kbd className="mr-1 rounded border border-soft px-1.5 py-px">O</kbd>open
              </span>
              <span>
                <kbd className="mr-1 rounded border border-soft px-1.5 py-px">N</kbd>new
              </span>
              <span>
                <kbd className="mr-1 rounded border border-soft px-1.5 py-px">⌘K</kbd>all
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Left column */}
          <div className="flex flex-col gap-5">
            <Recents
              loading={recentsLoading}
              error={recentsError}
              rows={recents}
              onOpen={openRecentRow}
              onOpenFolder={() => void openFolderFlow()}
              onNew={toggleGallery}
              onRetry={() => void loadRecents()}
            />

            {/* Teaching footer (graft from L-B) */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-soft bg-surface px-4 py-3 font-mono text-[11px] text-fg-muted">
              <span className="uppercase tracking-[0.06em] text-fg-faint">the loop</span>
              <span className="flex items-center gap-1.5">
                <Icon name="list" size={12} /> Beats &amp; cells
              </span>
              <Icon name="arrow" size={12} className="text-fg-faint" />
              <span className="flex items-center gap-1.5">
                <Icon name="film" size={12} /> Compose
              </span>
              <Icon name="arrow" size={12} className="text-fg-faint" />
              <span className="flex items-center gap-1.5">
                <Icon name="check" size={12} /> Render &amp; export
              </span>
            </div>

            {galleryOpen && (
              <div ref={galleryRef} id="new-project-gallery">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="font-mono text-[12px] uppercase tracking-[0.05em] text-fg-muted">
                    Start something new
                  </h2>
                  <span className="font-mono text-[11px] text-fg-faint">
                    templates seed beats &amp; cells — edit everything after
                  </span>
                </div>
                <Gallery
                  archetypes={archetypes}
                  loading={archLoading}
                  error={archError}
                  picked={picked}
                  creating={creating}
                  createError={createError}
                  onPick={pickArchetype}
                  onCloseCreate={() => setPicked(null)}
                  onCreate={(name, aspect) => picked && void createAndOpen(picked, name, aspect)}
                  onDisabled={onDisabledArchetype}
                  onCustom={onCustom}
                  onRetry={() => void loadArchetypes()}
                />
              </div>
            )}
          </div>

          {/* Rail */}
          <aside className="flex flex-col gap-4" aria-label="Desk sidebar">
            <div className="rounded-lg border border-soft bg-surface p-4">
              <h3 className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.07em] text-fg-muted">
                <Icon name="command" size={13} /> Jump back in
              </h3>
              <div className="flex flex-col gap-2 text-[12.5px] text-fg-muted">
                <div className="flex items-center justify-between gap-2">
                  <span>Resume last project</span>
                  <kbd className="rounded border border-soft px-1.5 py-px font-mono text-[11px]">R</kbd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Open a folder from disk</span>
                  <kbd className="rounded border border-soft px-1.5 py-px font-mono text-[11px]">O</kbd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>New from a template</span>
                  <kbd className="rounded border border-soft px-1.5 py-px font-mono text-[11px]">N</kbd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>All commands</span>
                  <kbd className="rounded border border-soft px-1.5 py-px font-mono text-[11px]">⌘K</kbd>
                </div>
              </div>
            </div>

            {engines.length > 0 && (
              <div className="rounded-lg border border-soft bg-surface p-4">
                <h3 className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.07em] text-fg-muted">
                  <Icon name="film" size={13} /> Render engines
                </h3>
                <div className="flex flex-col gap-2 text-[12.5px] text-fg-muted">
                  {engines.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2">
                      <span className="text-fg">{e.id}</span>
                      <span className="font-mono text-[10.5px] text-fg-faint">
                        {e.aspect_ratios?.join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              className="rounded-lg border p-4"
              style={{
                borderColor: 'color-mix(in srgb, var(--agent) 30%, var(--border))',
                background: 'color-mix(in srgb, var(--agent-soft) 55%, var(--bg-surface))',
              }}
            >
              <h3
                className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.07em]"
                style={{ color: 'color-mix(in srgb, var(--agent) 75%, var(--fg))' }}
              >
                <Icon name="message" size={13} /> Or ask your Chi
              </h3>
              <p className="text-[12.5px] leading-relaxed text-fg-muted">
                Rather describe the video than click? Tell it to{' '}
                <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'color-mix(in srgb, var(--agent) 80%, var(--fg))' }}>
                  your Chi
                </span>{' '}
                in chat — it runs the same create, storyboard, and render steps the desk does, and the
                result lands right here in Recent projects.
              </p>
            </div>
          </aside>
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />

      {/* Toasts */}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-6 left-1/2 z-50 flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 flex-col items-center gap-2"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className="flex w-full items-start gap-3 rounded-lg border bg-raised px-3 py-3 shadow-2xl"
              style={{
                borderColor:
                  t.kind === 'success'
                    ? 'color-mix(in srgb, var(--live) 40%, var(--border))'
                    : t.kind === 'error'
                    ? 'color-mix(in srgb, var(--danger) 46%, var(--border))'
                    : 'var(--border)',
              }}
            >
              <span
                className="mt-0.5 flex-none"
                style={{
                  color:
                    t.kind === 'success'
                      ? 'var(--live)'
                      : t.kind === 'error'
                      ? 'var(--danger)'
                      : 'var(--info)',
                }}
              >
                <Icon name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'arrow'} size={16} />
              </span>
              <div className="min-w-0 flex-1 text-xs leading-snug">
                <div className="font-semibold text-fg">{t.title}</div>
                {t.detail && <div className="mt-0.5 break-words font-mono text-fg-faint">{t.detail}</div>}
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.run();
                      dismissToast(t.id);
                    }}
                    className="mt-1 font-mono text-[11.5px]"
                    style={{ color: 'var(--info)' }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss"
                className="flex-none text-fg-faint hover:text-fg"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
