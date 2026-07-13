// com.ikenga.studio · Launcher — "New project" archetype gallery
//
// Cards come from the REAL archetype.list() seam; presentationFor() only
// decorates them (icon/accent/beats/blurb). Phase badges are DERIVED from the
// presentation engine string (audit: launcher-p1-badge-contradicts-engine-
// phase) — HyperFrames → Available (create enabled), Remotion → P2 (disabled),
// AI → P3 (disabled) — so a not-yet-built archetype reads honestly.
//
// Grafts: the teaching subtitle + the dashed-outline "Custom" card (concept
// L-B). "Custom" has no one-click create seam in Wave 1 (there is no `custom`
// builtin archetype and archetype-builder needs an open project), so it
// degrades honestly to a teaching affordance rather than faking a create.

import { useState } from 'react';

import { presentationFor } from '../../__mocks__/launcher';
import type { AspectRatio, Archetype } from '../../mcp-types';
import { Icon } from './icons';
import { accentStyle, derivePhase } from './presentation';

const ASPECTS: { id: AspectRatio; res: string; note: string }[] = [
  { id: '16:9', res: '1920×1080', note: 'landscape' },
  { id: '9:16', res: '1080×1920', note: 'Reels / TikTok' },
  { id: '1:1', res: '1080×1080', note: 'square' },
];

function ArchetypeCard({
  archetype,
  selected,
  onPick,
  onDisabled,
}: {
  archetype: Archetype;
  selected: boolean;
  onPick: () => void;
  onDisabled: () => void;
}) {
  const pres = presentationFor(archetype.id);
  const phase = derivePhase(archetype.id);
  return (
    <button
      type="button"
      onClick={phase.available ? onPick : onDisabled}
      aria-disabled={!phase.available}
      aria-pressed={selected}
      aria-label={`${archetype.name} — ${pres.beats}`}
      className={
        'flex flex-col gap-2 rounded-lg border bg-surface p-3.5 text-left transition-transform ' +
        (phase.available ? 'hover:-translate-y-0.5 ' : 'cursor-not-allowed opacity-60 ') +
        (selected ? 'border-[var(--chip-carve)] ring-1 ring-inset ring-[var(--chip-carve)]' : 'border-soft')
      }
    >
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border" style={accentStyle(pres.accent)}>
          <Icon name={pres.icon} size={16} />
        </div>
        <span
          className="rounded-full border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.05em]"
          style={
            phase.available
              ? { color: 'var(--live)', background: 'var(--live-soft)', borderColor: 'color-mix(in srgb, var(--live) 34%, var(--border))' }
              : { color: 'var(--fg-muted)', background: 'var(--bg-raised)', borderColor: 'var(--chip-carve)' }
          }
        >
          {phase.label}
        </span>
      </div>
      <div className="text-[13.5px] font-semibold text-fg">{archetype.name}</div>
      <div className="font-mono text-[10.5px] leading-snug text-fg-faint">{pres.beats}</div>
      <div className="text-xs leading-snug text-fg-muted">{pres.blurb}</div>
      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-fg-faint">
        <span>{pres.engine}</span>
        <span>·</span>
        <span>{pres.duration}</span>
      </div>
    </button>
  );
}

function CustomCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Custom — compose your own chain"
      className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--chip-carve)] bg-transparent p-3.5 text-left transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-[var(--chip-carve)] text-fg-muted">
          <Icon name="plus" size={16} />
        </div>
      </div>
      <div className="text-[13.5px] font-semibold text-fg">Custom</div>
      <div className="font-mono text-[10.5px] leading-snug text-fg-faint">any chain of blocks</div>
      <div className="text-xs leading-snug text-fg-muted">
        Compose your own from the block library.
      </div>
    </button>
  );
}

function CreatePanel({
  archetype,
  creating,
  error,
  onClose,
  onCreate,
}: {
  archetype: Archetype;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string, aspect: AspectRatio) => void;
}) {
  const pres = presentationFor(archetype.id);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const placeholder = `my-${archetype.id.replace(/_/g, '-')}`;

  return (
    <div
      className="mt-3.5 rounded-lg border bg-surface p-4"
      style={{ borderColor: `color-mix(in srgb, ${accentStyle(pres.accent).color as string} 40%, var(--border))` }}
      role="group"
      aria-label={`Create a new ${archetype.name} project`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border" style={accentStyle(pres.accent)}>
            <Icon name={pres.icon} size={15} />
          </div>
          <div>
            <div className="text-sm font-semibold text-fg">New {archetype.name} project</div>
            <div className="font-mono text-[11px] text-fg-faint">seeds beats &amp; cells, then opens the desk</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close create panel"
          className="text-fg-faint hover:text-fg"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-muted">Project name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-label="Project name"
              className="mt-1 h-8 w-full rounded-md border border-soft bg-sunken px-2.5 font-mono text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:border-[color-mix(in_srgb,var(--primary)_60%,var(--border))]"
            />
          </label>
          <div>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-muted">Aspect ratio</span>
            <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Aspect ratio">
              {ASPECTS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={aspect === opt.id}
                  onClick={() => setAspect(opt.id)}
                  className={
                    'rounded-md border px-2 py-1.5 text-center ' +
                    (aspect === opt.id ? 'border-[color-mix(in_srgb,var(--primary)_60%,var(--border))] bg-raised' : 'border-soft hover:border-[var(--chip-carve)]')
                  }
                >
                  <div className="text-[13px] font-semibold text-fg">{opt.id}</div>
                  <div className="font-mono text-[10px] text-fg-faint">{opt.res}</div>
                  <div className="text-[10px] text-fg-faint">{opt.note}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            disabled={creating}
            aria-busy={creating}
            onClick={() => onCreate(name.trim() || placeholder, aspect)}
            className="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ background: 'var(--primary)', color: 'var(--primary-fg)', borderColor: 'transparent' }}
          >
            <Icon name={creating ? 'refresh' : 'arrow'} size={15} className={creating ? 'animate-pulse' : ''} />
            {creating ? 'Creating…' : 'Create & open'}
          </button>
          <p className="max-w-[22ch] text-right font-mono text-[10px] text-fg-faint sm:text-right">
            You can also just ask your Chi in chat.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
          style={{ borderColor: 'color-mix(in srgb, var(--danger) 44%, var(--border))', background: 'var(--danger-soft)' }}
        >
          <Icon name="alert" size={14} className="mt-0.5 flex-none" />
          <span className="min-w-0 text-fg-muted">
            <span className="font-semibold text-fg">Couldn&rsquo;t create the project.</span>{' '}
            <span className="font-mono text-fg-faint">{error}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export function Gallery({
  archetypes,
  loading,
  error,
  picked,
  creating,
  createError,
  onPick,
  onCloseCreate,
  onCreate,
  onDisabled,
  onCustom,
  onRetry,
}: {
  archetypes: Archetype[];
  loading: boolean;
  error: string | null;
  picked: Archetype | null;
  creating: boolean;
  createError: string | null;
  onPick: (a: Archetype) => void;
  onCloseCreate: () => void;
  onCreate: (name: string, aspect: AspectRatio) => void;
  onDisabled: (a: Archetype) => void;
  onCustom: () => void;
  onRetry: () => void;
}) {
  return (
    <div>
      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-soft bg-surface p-3.5">
              <div className="launcher-sk h-8 w-8 rounded-md" />
              <div className="launcher-sk mt-3 h-3.5 w-2/3" />
              <div className="launcher-sk mt-2 h-2.5 w-full" />
              <div className="launcher-sk mt-2 h-2.5 w-4/5" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border p-4"
          style={{ borderColor: 'color-mix(in srgb, var(--danger) 44%, var(--border))', background: 'var(--danger-soft)' }}
        >
          <Icon name="alert" size={16} className="mt-0.5 flex-none" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">No archetypes available</div>
            <p className="mt-0.5 text-xs text-fg-muted">
              The Studio catalog didn&rsquo;t load. <span className="font-mono text-fg-faint">{error}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="flex flex-none items-center gap-1.5 rounded-md border border-soft px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            <Icon name="refresh" size={13} /> Reload
          </button>
        </div>
      ) : archetypes.length === 0 ? (
        <div className="rounded-lg border border-soft bg-surface px-6 py-9 text-center">
          <h3 className="text-base font-semibold text-fg">No templates in the catalog</h3>
          <p className="mx-auto mt-1.5 max-w-[42ch] text-sm text-fg-muted">
            The archetype catalog came back empty — check the studio MCP server.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-soft px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            <Icon name="refresh" size={13} /> Reload
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" role="list">
            {archetypes.map((a) => (
              <ArchetypeCard
                key={a.id}
                archetype={a}
                selected={picked?.id === a.id}
                onPick={() => onPick(a)}
                onDisabled={() => onDisabled(a)}
              />
            ))}
            <CustomCard onClick={onCustom} />
          </div>
          {picked && (
            <CreatePanel
              archetype={picked}
              creating={creating}
              error={createError}
              onClose={onCloseCreate}
              onCreate={onCreate}
            />
          )}
        </>
      )}
    </div>
  );
}
