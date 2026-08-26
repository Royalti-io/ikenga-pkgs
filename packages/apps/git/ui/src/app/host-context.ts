// com.ikenga.git · hostContext shapes read off the AppBridge handshake.
//
// Mirrors shell/src/lib/pkg/host-context.ts (`HostActiveProject`,
// `RoyaltiSuiteContext`) 1:1, per D5 ("consume as-is in P1" — 01-plan.md
// §Decisions). NOT promoted into @ikenga/contract; kept here in lockstep with
// the shell contract until ikenga#126 lands.

import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';

/** The shell's active project. `root: null` is the seed Default project or a
 *  skill-only project — one of the four G-05 no-root states, not an error. */
export interface HostActiveProject {
  id: string;
  name: string;
  root: string | null;
}

export interface RoyaltiSuiteContext {
  /** Last shell-sidebar selection. We route our own view off this rather than
   *  internal click state (matches studio's convention). */
  activeFeature?: string;
  activeProject?: HostActiveProject | null;
}

export type GitHostContext = McpUiHostContext & {
  royaltiSuite?: RoyaltiSuiteContext;
};
