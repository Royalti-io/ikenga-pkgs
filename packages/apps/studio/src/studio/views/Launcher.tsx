// com.ikenga.studio · Launcher
//
// The pre-project shell (Screen S1 — launcher.md / G25). Not a sub-view — it
// pre-empts the whole Pattern-C pane layout when no project is open
// (project-store.ts `isOpen === false`) and unmounts entirely once a project
// opens. Visual bar: designs/launcher.html (archetype gallery + create panel
// + recent projects + open-folder trust gate).
//
// Flow: pick an archetype → create panel slides in (name + aspect enum) →
// "Create & open" calls `project.create` (mock) → project-store.openProject
// → App.tsx swaps to the pane layout. Recent-project rows and the trust-gate
// "Grant & open" both short-circuit straight to openProject with a synthetic
// summary — real folder access + SQLite-backed recents are shell-side work
// (WP-04 / launcher.md §"Gaps").

import { useEffect, useState } from 'react';

import { archetypeApi, projectApi, getMcpClient } from '../mcp-client';
import { openFolder } from '../bridge';
import { useProjectStore } from '../project-store';
import { presentationFor, RECENT, type RecentProject } from '../__mocks__/launcher';
import type { AspectRatio, Archetype } from '../mcp-types';

// ─── Inline icons (lucide subset — no icon dependency) ──────────────────

const ICON_PATHS: Record<string, string | string[]> = {
  sparkles: 'M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5 10.1 7.6ZM5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9ZM19 14l.6 1.5L21 16l-1.4.5L19 18l-.6-1.5L17 16l1.4-.5Z',
  film: 'M2 2h20v20H2zM2 7h20M2 17h20M7 2v20M17 2v20',
  package: 'M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Zm-9 5.5V12m0 0 8.7-5M12 12 3.3 7',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  plus: 'M12 5v14M5 12h14',
  folder: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
};

function Icon({ name, size = 14, className = '' }: { name: string; size?: number; className?: string }) {
  const d = ICON_PATHS[name] ?? ICON_PATHS.package;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
  );
}

const ASPECTS: { id: AspectRatio; res: string; note: string }[] = [
  { id: '16:9', res: '1920×1080', note: 'landscape' },
  { id: '9:16', res: '1080×1920', note: 'TikTok / Reels' },
  { id: '1:1',  res: '1080×1080', note: 'square' },
];

function accentStyle(accent: string): React.CSSProperties {
  // 'cyan' has no --beat-accent- token (contract §5 lists 6 canonical
  // accents) — fall back to --info, the closest cool role.
  const varName = accent === 'cyan' ? '--info' : `--beat-accent-${accent}`;
  return {
    color: `var(${varName})`,
    background: accent === 'cyan' ? 'color-mix(in srgb, var(--info) 14%, transparent)' : `var(${varName}-soft)`,
    borderColor: accent === 'cyan' ? 'color-mix(in srgb, var(--info) 34%, var(--border))' : `var(${varName}-border)`,
  };
}

// ─── Archetype card ─────────────────────────────────────────────────────

function ArchetypeCard({
  archetype,
  selected,
  onPick,
}: {
  archetype: Archetype;
  selected: boolean;
  onPick: () => void;
}) {
  // Every archetype gets a card — presentationFor() falls back to a generic
  // decoration for ids the map doesn't enumerate (real catalog ids), so a
  // real `ai_short` / `music_video` never silently drops out of the gallery.
  const pres = presentationFor(archetype.id);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`${archetype.name} — ${pres.beats}`}
      className={
        'flex flex-col gap-2 rounded-xl border bg-surface p-4 text-left transition-transform hover:-translate-y-0.5 '
        + (selected ? 'border-[var(--border-strong)] ring-1 ring-[var(--border-strong)]' : 'border-soft')
      }
    >
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border" style={accentStyle(pres.accent)}>
          <Icon name={pres.icon} size={15} />
        </div>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-inset"
          style={{ color: 'var(--beat-accent-emerald)', background: 'var(--beat-accent-emerald-soft)', borderColor: 'var(--beat-accent-emerald-border)' }}
        >
          P1
        </span>
      </div>
      <div className="text-sm font-semibold text-fg">{archetype.name}</div>
      <div className="font-mono text-[11px] leading-snug text-fg-faint">{pres.beats}</div>
      <div className="text-xs leading-snug text-fg-muted">{pres.blurb}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-fg-faint">
        <span className="rounded border px-1.5 py-0.5" style={accentStyle(pres.accent)}>{pres.engine}</span>
        <span className="rounded border border-soft px-1.5 py-0.5 text-fg-muted">{pres.duration}</span>
      </div>
    </button>
  );
}

// ─── Create panel ───────────────────────────────────────────────────────

function CreatePanel({
  archetype,
  onClose,
  onCreate,
}: {
  archetype: Archetype;
  onClose: () => void;
  onCreate: (name: string, aspect: AspectRatio) => void;
}) {
  const pres = presentationFor(archetype.id);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const placeholder = archetype.id.includes('music') ? 'label-anthem' : archetype.id === 'product' ? 'q2-launch' : `my-${archetype.id.replace(/_/g, '-')}`;

  return (
    <div className="sticky top-4 flex flex-col gap-4 rounded-xl border border-soft bg-surface p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border" style={accentStyle(pres?.accent ?? 'sky')}>
            <Icon name={pres?.icon ?? 'package'} size={15} />
          </div>
          <div>
            <div className="text-sm font-semibold text-fg">New {archetype.name} project</div>
            <div className="font-mono text-[11px] text-fg-faint">archetype.instantiate_into_project</div>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close create panel" className="text-fg-faint hover:text-fg">
          <Icon name="x" size={16} />
        </button>
      </div>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-fg-faint">Project name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          className="input mt-1 w-full font-mono"
          aria-label="Project name"
        />
      </label>

      <div>
        <span className="text-[11px] uppercase tracking-wide text-fg-faint">Aspect ratio</span>
        <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Aspect ratio">
          {ASPECTS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={aspect === opt.id}
              onClick={() => setAspect(opt.id)}
              className={
                'rounded-lg border px-2 py-2 text-center '
                + (aspect === opt.id ? 'border-[var(--border-strong)] bg-raised' : 'border-soft hover:border-[var(--border-strong)]')
              }
            >
              <div className="text-sm font-semibold text-fg">{opt.id}</div>
              <div className="font-mono text-[10px] text-fg-faint">{opt.res}</div>
              <div className="text-[10px] text-fg-faint">{opt.note}</div>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-fg-faint">9:16 renders a TikTok safe-zone overlay on the canvas (G1).</p>
      </div>

      <button
        type="button"
        onClick={() => onCreate(name || placeholder, aspect)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--fg)] py-2.5 text-sm font-semibold text-[var(--bg-base)] hover:opacity-90"
      >
        <Icon name="arrow" size={15} /> Create &amp; open
      </button>
      <p className="text-[10px] leading-relaxed text-fg-faint">
        Materializes the block chain into beats + cells, then opens the in-project layout. You can
        also just ask the agent in chat — the launcher only removes the blank-canvas start.
      </p>
    </div>
  );
}

// ─── View ───────────────────────────────────────────────────────────────

export function LauncherView() {
  const openProject = useProjectStore((s) => s.openProject);

  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [picked, setPicked] = useState<Archetype | null>(null);
  const [trustOpen, setTrustOpen] = useState(false);
  const [toast, setToast] = useState<{ name: string; archetype_id: string; aspect: AspectRatio } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const client = await getMcpClient();
      const { archetypes: list } = await archetypeApi.list(client);
      if (!cancelled) setArchetypes(list);
    })();
    return () => { cancelled = true; };
  }, []);

  async function createAndOpen(archetype: Archetype, name: string, aspect: AspectRatio) {
    const client = await getMcpClient();
    const { project_id } = await projectApi.create(client, {
      archetype_id: archetype.id,
      name,
      path: `~/Projects/${name}`,
      aspect_ratio: aspect,
    });
    setToast({ name, archetype_id: archetype.id, aspect });
    setPicked(null);
    openProject({ project_id, name, archetype_id: archetype.id, aspect_ratio: aspect });
  }

  async function openRecent(recent: RecentProject) {
    const client = await getMcpClient();
    const { project_id } = await projectApi.open(client, `~/Projects/${recent.slug}`);
    openProject({ project_id, name: recent.slug, archetype_id: recent.archetype_id, aspect_ratio: recent.aspect });
  }

  async function grantAndOpen() {
    setTrustOpen(false);
    await openFolder();
    // Mirrors designs/launcher.html's trust-gate demo target — a real grant
    // resolves to whatever folder the OS picker returned (shell-side, WP-04).
    openProject({
      project_id: 'mock-granted',
      name: 'label-anthem-mv',
      archetype_id: 'musicvideo',
      aspect_ratio: '9:16',
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-base text-fg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-soft bg-sunken/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--beat-accent-violet)', background: 'var(--beat-accent-violet-soft)' }}
          >
            <Icon name="sparkles" size={15} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-fg">Studio</div>
            <div className="font-mono text-[10px] leading-tight text-fg-faint">no project open</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTrustOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-soft px-3 py-1.5 text-xs text-fg-muted hover:border-[var(--border-strong)] hover:text-fg"
        >
          <Icon name="folder" size={14} /> Open folder…
        </button>
      </header>

      <main className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-6 px-6 py-8">
        <section className={picked ? 'col-span-12 lg:col-span-8' : 'col-span-12'}>
          <div className="mb-1 flex items-baseline justify-between">
            <h1 className="text-lg font-semibold text-fg">Start a project</h1>
          </div>
          <p className="mb-5 max-w-2xl text-sm text-fg-muted">
            Pick a template to seed beats + cells, open an existing project folder, or just ask the
            agent in chat — Claude drives the same <span className="font-mono text-fg">project.create</span> flow.
          </p>
          <div className={`grid gap-3 ${picked ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`} role="list">
            {archetypes.map((a) => (
              <ArchetypeCard
                key={a.id}
                archetype={a}
                selected={picked?.id === a.id}
                onPick={() => setPicked(a)}
              />
            ))}
          </div>

          <div className="mt-8">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-fg-faint">
              <Icon name="clock" size={13} /> Recent projects
            </div>
            <div className="divide-y divide-[var(--border-soft)] overflow-hidden rounded-xl border border-soft">
              {RECENT.map((r) => {
                const pres = presentationFor(r.archetype_id);
                return (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => openRecent(r)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-raised/60"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg border" style={accentStyle(pres?.accent ?? 'sky')}>
                      <Icon name={pres?.icon ?? 'package'} size={13} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-sm text-fg">{r.slug}</div>
                      <div className="text-[11px] text-fg-faint">
                        {r.archetype_id} · {r.cells} cells · {r.aspect}
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-[11px] text-fg-faint">{r.ago}</span>
                    <Icon name="arrow" size={14} className="text-fg-faint" />
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-6 flex items-center gap-1.5 text-[11px] text-fg-faint">
            <Icon name="message" size={13} /> Chat / MCP stays the primary authoring loop — the launcher is the
            no-project entry point, not a required step.
          </p>
        </section>

        {picked && (
          <aside className="col-span-12 lg:col-span-4">
            <CreatePanel
              archetype={picked}
              onClose={() => setPicked(null)}
              onCreate={(name, aspect) => createAndOpen(picked, name, aspect)}
            />
          </aside>
        )}
      </main>

      {trustOpen && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setTrustOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="trust-gate-title"
            className="w-full max-w-sm rounded-xl border border-soft bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg border"
                style={{ color: 'var(--beat-accent-amber)', background: 'var(--beat-accent-amber-soft)', borderColor: 'var(--beat-accent-amber-border)' }}
              >
                <Icon name="shield" size={16} />
              </div>
              <div id="trust-gate-title" className="text-sm font-semibold text-fg">Grant access to this folder?</div>
            </div>
            <p className="mb-1 font-mono text-xs text-fg-muted">~/Movies/label-anthem-mv</p>
            <p className="mb-4 text-xs leading-relaxed text-fg-faint">
              Studio reads + writes project files here. Granted once per folder, like VS Code
              workspace trust — subsequent opens won't reprompt.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTrustOpen(false)}
                className="rounded-lg border border-soft px-3 py-1.5 text-xs text-fg-muted hover:border-[var(--border-strong)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={grantAndOpen}
                className="rounded-lg bg-[var(--fg)] px-3 py-1.5 text-xs font-semibold text-[var(--bg-base)] hover:opacity-90"
              >
                Grant &amp; open
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-20 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl"
          style={{ borderColor: 'var(--beat-accent-emerald-border)', background: 'var(--bg-raised)' }}
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg border"
            style={{ color: 'var(--beat-accent-emerald)', background: 'var(--beat-accent-emerald-soft)', borderColor: 'var(--beat-accent-emerald-border)' }}
          >
            <Icon name="check" size={15} />
          </div>
          <div className="text-xs leading-snug">
            <div className="text-fg">
              Created <span className="font-mono text-[var(--beat-accent-emerald)]">{toast.name}</span>{' '}
              ({toast.archetype_id} · {toast.aspect})
            </div>
            <div className="font-mono text-fg-faint">project.create → opening layout…</div>
          </div>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-fg-faint hover:text-fg">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
