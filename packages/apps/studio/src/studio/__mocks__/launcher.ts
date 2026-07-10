// com.ikenga.studio · launcher presentation mock
//
// Presentation-only decoration for the archetype gallery (icon/accent/beats-
// string/engine/duration/blurb) — same rule as every other __mocks__ file:
// the MCP `archetype.list()` response (__mocks__/mcp.ts MOCK_ARCHETYPES) only
// carries { id, name, description, chain, builtin? }; everything below is
// what the Launcher decorates it with, keyed by the same `id`. Mirrors
// designs/launcher.html's ARCHETYPES + RECENT fixtures.
//
// `RECENT` is a Launcher-local static fixture — there's no MCP tool for
// "recent projects" yet (project.list() returns just the one mock project);
// recents come from local SQLite in the real shell (launcher.md §"Gaps").

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

export interface RecentProject {
  slug: string;
  archetype_id: string;
  ago: string;
  cells: number;
  aspect: '16:9' | '9:16' | '1:1';
}

export const RECENT: RecentProject[] = [
  { slug: 'retention-explainer', archetype_id: 'explainer',  ago: '2d ago', cells: 6,  aspect: '16:9' },
  { slug: 'q2-product-launch',   archetype_id: 'product',    ago: '5d ago', cells: 9,  aspect: '9:16' },
  { slug: 'label-anthem-mv',     archetype_id: 'musicvideo', ago: '1w ago', cells: 12, aspect: '9:16' },
];
