/**
 * Tool registry barrel for the studio MCP server.
 *
 * `buildTools()` returns the flat ToolDef[] in stable order; the MCP
 * adapter at ../index.ts maps it into `setRequestHandler(ListTools…)` and
 * `setRequestHandler(CallTool…)`.
 */

import type { SidecarClient } from '../sidecar-client.js';
import type { Catalog } from '../catalog.js';
import { projectTools } from './project.js';
import { storyboardTools } from './storyboard.js';
import { anchorTools } from './anchor.js';
import { assetTools } from './asset.js';
import { compositionTools, RenderShim } from './composition.js';
import { renderTools } from './render.js';
import { blockTools } from './block.js';
import { archetypeTools } from './archetype.js';
import type { OpenProjectRegistry, ToolDef } from './types.js';

export function buildTools(opts: {
  sidecar: SidecarClient;
  catalog: Catalog;
  registry: OpenProjectRegistry;
  shim: RenderShim;
}): ToolDef[] {
  const { sidecar, catalog, registry, shim } = opts;
  return [
    ...projectTools(sidecar, registry),
    ...storyboardTools(),
    ...anchorTools(),
    ...assetTools(),
    ...compositionTools(sidecar, registry, shim),
    ...renderTools(shim),
    ...blockTools(catalog, registry),
    ...archetypeTools(catalog, registry),
  ];
}

export { RenderShim };
export type { ToolDef, OpenProjectRegistry } from './types.js';
