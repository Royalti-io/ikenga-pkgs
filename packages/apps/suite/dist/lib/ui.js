// React + htm via esm.sh — no JSX transpile needed. Forkers edit JS, reload.
//
// htm uses tagged template literals to render React elements. Same mental model
// as JSX (component tags, expressions in ${}), just without a build step.

import * as React from 'https://esm.sh/react@19.0.0';
import * as ReactDOMClient from 'https://esm.sh/react-dom@19.0.0/client';
import htm from 'https://esm.sh/htm@3.1.1';

export const { useState, useEffect, useMemo, useCallback, useRef, useReducer, Fragment } = React;
export const createRoot = ReactDOMClient.createRoot;
export const html = htm.bind(React.createElement);

// Tiny icon helper — lucide-static SVG paths inlined as needed to avoid an
// extra CDN hop. Add more glyphs as features need them.
const ICONS = {
  'list-checks': 'M3 6h2l1 2 2-4 2 6 2-4 1 2h2M3 12h2l1 2 2-4 2 6 2-4 1 2h2M3 18h2l1 2 2-4 2 6 2-4 1 2h2',
  'trending-up': 'M3 17l6-6 4 4 8-8M14 7h7v7',
  'send': 'M22 2 11 13M22 2 15 22l-4-9-9-4z',
  'mail': 'M4 4h16v16H4zM4 4l8 8 8-8',
  'settings': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4',
};

export function Icon({ name, size = 16 }) {
  const path = ICONS[name];
  if (!path) return null;
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d=${path} /></svg>`;
}
