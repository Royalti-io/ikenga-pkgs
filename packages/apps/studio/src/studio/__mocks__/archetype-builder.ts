// com.ikenga.studio · archetype-builder mock
//
// Presentation-only fixture for the block-chain editor — same rule as every
// other __mocks__ file: schema-shaped fields the real `block.list` /
// `archetype.list` MCP calls will return live in mcp-types.ts / the frozen
// schema; kind/name/params/duration_ms here are the fixture data those calls
// would resolve to.
//
// Block.kind — the FROZEN schema (shared/schema.ts BlockSchema, not the
// stale mcp-types.ts draft) is the 9-kind enum: 'hook' | 'beat' | 'transition'
// | 'narration_pattern' | 'anchor_pack' | 'sfx' | 'music_preset' | 'cta' |
// 'sketch'. mcp-types.ts's Block.kind ('beat'|'transition'|'sketch') is the
// stale WP-02-era draft this file deliberately does not import — the commit-
// 16 schema swap reconciles it. BlockKind below is the real enum.
//
// Kind → beat-accent mapping (contract §5 — only the 6 canonical
// --beat-accent-* tokens, no raw hex, no invented tokens): lifted from
// designs/archetype-builder.html's PALETTE_BY_KIND (music_preset reuses sky,
// cta reuses emerald — same as the mockup).

export type BlockKind =
  | 'hook' | 'beat' | 'transition' | 'narration_pattern'
  | 'anchor_pack' | 'sfx' | 'music_preset' | 'cta' | 'sketch';

export type BeatAccent = 'amber' | 'rose' | 'emerald' | 'sky' | 'violet' | 'fuchsia';

export const KIND_ACCENT: Record<BlockKind, BeatAccent> = {
  hook:              'amber',
  beat:              'sky',
  transition:        'violet',
  narration_pattern: 'emerald',
  anchor_pack:       'rose',
  sfx:               'fuchsia',
  music_preset:      'sky',
  cta:               'emerald',
  sketch:            'violet',
};

export const KIND_LABEL: Record<BlockKind, string> = {
  hook: 'hook', beat: 'beat', transition: 'transition',
  narration_pattern: 'narration', anchor_pack: 'anchor pack',
  sfx: 'sfx', music_preset: 'music preset', cta: 'cta', sketch: 'sketch',
};

/** A block instantiated into a chain — `chainId` is unique per slot (the
 *  same `block_id` can appear more than once in a chain), which is what the
 *  sortable list keys off. */
export interface ChainBlock {
  chainId: string;
  block_id: string;
  kind: BlockKind;
  name: string;
  duration_ms: number;
  /** Read-only bindings display (P1 — full binding edit is P2, per
   *  archetype-builder.md §"Gaps"). */
  bindingsLabel?: string;
}

/** A block available in the library sidebar (not yet placed in a chain). */
export interface LibraryBlock {
  block_id: string;
  kind: BlockKind;
  name: string;
  duration_ms: number;
}

let _chainSeq = 0;
/** Mint a fresh chainId so the same block_id can be inserted more than once
 *  without key collisions in the sortable list. */
export function nextChainId(): string {
  return `slot-${++_chainSeq}-${Date.now().toString(36)}`;
}

export function instantiateChainBlock(lib: LibraryBlock, bindingsLabel?: string): ChainBlock {
  return { chainId: nextChainId(), ...lib, bindingsLabel };
}

/** Flat lookup across every kind's library array — used to resolve a
 *  dragged/picked `block_id` back to its fixture (duration, kind, name). */
export function findLibraryBlock(blockId: string): LibraryBlock | null {
  for (const kind of LIBRARY_KIND_ORDER) {
    const hit = LIBRARY[kind].find((b) => b.block_id === blockId);
    if (hit) return hit;
  }
  return null;
}

// ─── Library — grouped by kind, examples per archetype-builder.html's BLOCKS ─

export const LIBRARY: Record<BlockKind, LibraryBlock[]> = {
  hook: [
    { block_id: 'hook.stat',          kind: 'hook', name: 'Stat hook',        duration_ms: 4_000 },
    { block_id: 'hook.question',      kind: 'hook', name: 'Question hook',    duration_ms: 4_000 },
    { block_id: 'hook.pattern-break', kind: 'hook', name: 'Pattern break',    duration_ms: 3_000 },
    { block_id: 'hook.cold-open',     kind: 'hook', name: 'Cold open',        duration_ms: 5_000 },
    { block_id: 'hook.cliffhanger',   kind: 'hook', name: 'Cliffhanger',      duration_ms: 4_000 },
  ],
  beat: [
    { block_id: 'beat.problem',      kind: 'beat', name: 'Problem',       duration_ms: 8_000 },
    { block_id: 'beat.agitate',      kind: 'beat', name: 'Agitate',       duration_ms: 8_000 },
    { block_id: 'beat.solution',     kind: 'beat', name: 'Solution',      duration_ms: 15_000 },
    { block_id: 'beat.demo',         kind: 'beat', name: 'Demo',          duration_ms: 12_000 },
    { block_id: 'beat.feature-list', kind: 'beat', name: 'Feature list',  duration_ms: 10_000 },
    { block_id: 'beat.proof',        kind: 'beat', name: 'Proof',         duration_ms: 12_000 },
    { block_id: 'beat.counter',      kind: 'beat', name: 'Counter-point', duration_ms: 6_000 },
    { block_id: 'beat.clarify',      kind: 'beat', name: 'Clarify',       duration_ms: 6_000 },
  ],
  transition: [
    { block_id: 'transition.cut',        kind: 'transition', name: 'Cut',         duration_ms: 0 },
    { block_id: 'transition.fade',        kind: 'transition', name: 'Fade',        duration_ms: 0 },
    { block_id: 'transition.smash-cut',   kind: 'transition', name: 'Smash cut',   duration_ms: 0 },
    { block_id: 'transition.j-cut',       kind: 'transition', name: 'J-cut',       duration_ms: 0 },
    { block_id: 'transition.l-cut',       kind: 'transition', name: 'L-cut',       duration_ms: 0 },
  ],
  narration_pattern: [
    { block_id: 'narration_pattern.aida',           kind: 'narration_pattern', name: 'AIDA',              duration_ms: 0 },
    { block_id: 'narration_pattern.pas',            kind: 'narration_pattern', name: 'PAS',               duration_ms: 0 },
    { block_id: 'narration_pattern.fab',            kind: 'narration_pattern', name: 'FAB',               duration_ms: 0 },
    { block_id: 'narration_pattern.save-the-cat-15', kind: 'narration_pattern', name: 'Save the cat · 15', duration_ms: 0 },
  ],
  anchor_pack: [
    { block_id: 'anchor_pack.brand-pack',    kind: 'anchor_pack', name: 'Brand pack',    duration_ms: 0 },
    { block_id: 'anchor_pack.host-pack',     kind: 'anchor_pack', name: 'Host pack',     duration_ms: 0 },
    { block_id: 'anchor_pack.location-pack', kind: 'anchor_pack', name: 'Location pack', duration_ms: 0 },
  ],
  sfx: [
    { block_id: 'sfx.icon-pop',      kind: 'sfx', name: 'Icon pop',      duration_ms: 0 },
    { block_id: 'sfx.data-reveal',   kind: 'sfx', name: 'Data reveal',   duration_ms: 0 },
    { block_id: 'sfx.outro-resolve', kind: 'sfx', name: 'Outro resolve', duration_ms: 0 },
  ],
  music_preset: [
    { block_id: 'music_preset.upbeat-tech',   kind: 'music_preset', name: 'Upbeat tech',   duration_ms: 0 },
    { block_id: 'music_preset.calm-narrative', kind: 'music_preset', name: 'Calm narrative', duration_ms: 0 },
  ],
  cta: [
    { block_id: 'cta.link',        kind: 'cta', name: 'Link',        duration_ms: 5_000 },
    { block_id: 'cta.subscribe',   kind: 'cta', name: 'Subscribe',   duration_ms: 4_000 },
    { block_id: 'cta.talk-to-us', kind: 'cta', name: 'Talk to us',  duration_ms: 4_000 },
  ],
  sketch: [
    { block_id: 'sketch.flowchart', kind: 'sketch', name: 'Flowchart', duration_ms: 0 },
    { block_id: 'sketch.timeline',  kind: 'sketch', name: 'Timeline',  duration_ms: 0 },
  ],
};

export const LIBRARY_KIND_ORDER: BlockKind[] = [
  'hook', 'beat', 'transition', 'narration_pattern', 'anchor_pack', 'sfx', 'music_preset', 'cta',
];

// ─── Base archetype presets ────────────────────────────────────────────────

export const BASE_ARCHETYPES = ['explainer', 'product', 'narrative', 'blank'] as const;
export type BaseArchetypeId = (typeof BASE_ARCHETYPES)[number];

export const BASE_ARCHETYPE_LABEL: Record<BaseArchetypeId, string> = {
  explainer: 'explainer (builtin)',
  product:   'product (builtin)',
  narrative: 'narrative (builtin)',
  blank:     'start blank',
};

/** Builds a fresh chain (fresh chainIds) for a base archetype — matches
 *  designs/archetype-builder.html's PRESET_CHAIN for `explainer`. `product`
 *  and `narrative` are reasonable P1 stand-ins pending real archetype-skill
 *  authoring (block.list is mock everywhere in P1). */
export function presetChain(base: BaseArchetypeId): ChainBlock[] {
  switch (base) {
    case 'explainer':
      return [
        instantiateChainBlock(LIBRARY.hook[0], 'duration_ms: 4000'),
        instantiateChainBlock(LIBRARY.beat[0], 'duration_ms: 8000'),
        instantiateChainBlock(LIBRARY.beat[1]),
        instantiateChainBlock(LIBRARY.beat[2]),
        instantiateChainBlock(LIBRARY.transition[2]),
        instantiateChainBlock(LIBRARY.beat[5]),
        instantiateChainBlock(LIBRARY.cta[0], 'href: …'),
      ];
    case 'product':
      return [
        instantiateChainBlock(LIBRARY.hook[1]),
        instantiateChainBlock(LIBRARY.beat[3]),
        instantiateChainBlock(LIBRARY.beat[4]),
        instantiateChainBlock(LIBRARY.transition[0]),
        instantiateChainBlock(LIBRARY.beat[5]),
        instantiateChainBlock(LIBRARY.cta[1]),
      ];
    case 'narrative':
      return [
        instantiateChainBlock(LIBRARY.hook[3]),
        instantiateChainBlock(LIBRARY.narration_pattern[0]),
        instantiateChainBlock(LIBRARY.cta[2]),
      ];
    case 'blank':
    default:
      return [];
  }
}

/** Rule (archetype-builder.md §3): a transition may not lead the chain, and
 *  two transitions may not be adjacent. Validates a *candidate* full chain
 *  (post-insert or post-reorder) rather than an index delta — simpler and
 *  correct regardless of which mutation produced the candidate. Returns a
 *  human-readable reason on violation, `null` when the chain is valid. */
export function chainViolatesRule(chain: ChainBlock[]): string | null {
  if (chain[0]?.kind === 'transition') return 'A transition can\'t lead the chain';
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].kind === 'transition' && chain[i - 1].kind === 'transition') {
      return 'Two transitions can\'t be adjacent';
    }
  }
  return null;
}
