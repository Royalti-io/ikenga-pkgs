// com.ikenga.studio · project-open state
//
// Separate from shared-state.ts (the 4-value cross-pane store, published to
// iyke) and layout-store.ts (pane/view chrome) on purpose: whether a project
// is open at all is what gates the Launcher pre-empt in App.tsx (10-wp07-
// iframe.md commit 11 / launcher.md — Screen S1, G25). Defaults to
// `isOpen: false` so a fresh mount shows the archetype-gallery launcher
// first, matching the DoD: "Opening with no project → archetype-gallery
// launcher."

import { create } from 'zustand';

import type { AspectRatio } from './mcp-types';

export interface OpenProjectSummary {
  project_id: string;
  name: string;
  archetype_id: string;
  aspect_ratio: AspectRatio;
}

export interface ProjectStoreState {
  isOpen: boolean;
  project: OpenProjectSummary | null;
}

export interface ProjectStoreActions {
  openProject: (project: OpenProjectSummary) => void;
  /** Returns to the launcher (e.g. a future "close project" menu action). */
  closeProject: () => void;
}

export type ProjectStore = ProjectStoreState & ProjectStoreActions;

export const useProjectStore = create<ProjectStore>((set) => ({
  isOpen: false,
  project: null,
  openProject: (project) => set({ isOpen: true, project }),
  closeProject: () => set({ isOpen: false, project: null }),
}));

export const selectIsProjectOpen = (s: ProjectStoreState) => s.isOpen;
export const selectOpenProject  = (s: ProjectStoreState) => s.project;
