// com.ikenga.studio · Fountain parser (re-export shim)
//
// The parser itself moved to `shared/fountain.ts` and ships as
// `@ikenga/studio-schema/fountain` so the project sidecar (`breakdown.run`) and
// this iframe UI segment a script identically — plans/studio/19 D-6, "one
// parser, no drift". This file exists only so the pane-side import paths
// (`../lib/fountain`) keep working. Add nothing here; edit the shared module.

export {
  parseFountain,
  writeShotTags,
  type FountainBlock,
  type FountainBlockKind,
  type FountainDoc,
  type FountainScene,
} from '@ikenga/studio-schema/fountain';
