// com.ikenga.studio · launcher presentation mock
//
// Presentation-only decoration for the archetype gallery (icon/accent/beats-
// string/engine/duration/blurb) — same rule as every other __mocks__ file:
// the MCP `archetype.list()` response (__mocks__/mcp.ts MOCK_ARCHETYPES) only
// carries { id, name, description, chain, builtin? }; everything below is
// what the Launcher decorates it with, keyed by the same `id`.
//
// NOTE (Wave 1 launcher rebuild): the old `RECENT` static fixture was DELETED.
// Recent projects now come from the real `project.list()` seam (a
// SQLite-backed most-recent-first list — `ProjectSummary` rows carrying
// project_id / name / path / last_opened). This file keeps ONLY the
// presentation decoration (`presentationFor`) the gallery keys off archetype
// id — the "honesty rule": render only data that has a real seam.

import type { BeatAccent } from './archetype-builder';

export interface ArchetypePresentation {
  icon: string; // key into the Launcher's inline ICONS map
  accent: BeatAccent | 'cyan';
  beats: string;
  engine: string;
  duration: string;
  blurb: string;
}

export const ARCHETYPE_PRESENTATION: Record<string, ArchetypePresentation> = {
  explainer: {
    icon: 'film', accent: 'amber',
    beats: 'hook · problem · agitate · solution · proof · cta',
    engine: 'HF', duration: '30–90s',
    blurb: 'AV-script + narration. Fireship-style fast cuts.',
  },
  product: {
    icon: 'package', accent: 'sky',
    beats: 'feature · benefit · demo · proof · cta',
    engine: 'HF', duration: '45–120s',
    blurb: 'Bring-your-own UI capture; benefit-led.',
  },
  'ai-short': {
    icon: 'sparkles', accent: 'violet',
    beats: '1–3 beats, anchor-driven',
    engine: 'HF · AI (P3)', duration: '8–15s',
    blurb: 'Anchor-locked identity/style. AI adapters in P3.',
  },
  narrative: {
    icon: 'mic', accent: 'rose',
    beats: 'Fountain INT./EXT. → scene',
    engine: 'HF · Remotion (P2)', duration: 'arbitrary',
    blurb: 'Reads .fountain natively; beat = scene.',
  },
  montage: {
    icon: 'scissors', accent: 'emerald',
    beats: 'EDL-style cuts over source clips',
    engine: 'HF · Remotion (P2)', duration: 'arbitrary',
    blurb: 'Cells reference source clips w/ in/out timecodes.',
  },
  tutorial: {
    icon: 'list', accent: 'cyan',
    beats: 'numbered steps + UI capture',
    engine: 'HF', duration: '1–10m',
    blurb: 'Screen-capture-driven; voiceover per step.',
  },
  musicvideo: {
    icon: 'music', accent: 'fuchsia',
    beats: 'audio-waveform beats',
    engine: 'HF · Remotion (P2)', duration: 'song length',
    blurb: 'Beats from BPM/onset analysis (studio-beat-detect).',
  },
};

// Generic decoration for any archetype id the map above doesn't cover — the
// real catalog (@ikenga/studio-archetypes) can ship ids the presentation map
// doesn't enumerate, and the launcher must render a card for every one rather
// than dropping it. Never returns undefined → ArchetypeCard never null-renders.
const GENERIC_PRESENTATION: ArchetypePresentation = {
  icon: 'film',
  accent: 'sky',
  beats: 'beat sheet → lofi → hifi',
  engine: 'HF',
  duration: '—',
  blurb: 'Storyboard archetype — beats materialize into cells.',
};

/** Presentation for an archetype id, tolerant of id-form drift between the
 *  real catalog and this map. Real archetype ids use snake_case
 *  (`ai_short`, `music_video`) while the presentation keys predate that and
 *  use `ai-short` / `musicvideo`; normalize underscores↔hyphens before
 *  falling back to the generic card. */
export function presentationFor(id: string): ArchetypePresentation {
  const candidates = [
    id,
    id.replace(/_/g, '-'),   // ai_short → ai-short
    id.replace(/[-_]/g, ''), // music_video → musicvideo, ai-short → aishort
  ];
  for (const c of candidates) {
    const hit = ARCHETYPE_PRESENTATION[c];
    if (hit) return hit;
  }
  return GENERIC_PRESENTATION;
}
