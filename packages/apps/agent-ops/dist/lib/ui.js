// React + htm via esm.sh — no JSX transpile needed. Forkers edit JS, reload.
//
// htm uses tagged template literals to render React elements. Same mental model
// as JSX (component tags, expressions in ${}), just without a build step.

import * as React from 'https://esm.sh/react@19.0.0';
import * as ReactDOMClient from 'https://esm.sh/react-dom@19.0.0/client';
import htm from 'https://esm.sh/htm@3.1.1';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from 'https://esm.sh/@tanstack/react-query@5?deps=react@19.0.0';

export const {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useReducer,
  Fragment,
} = React;
export const createRoot = ReactDOMClient.createRoot;
export const html = htm.bind(React.createElement);

// TanStack Query — caching layer. Pinned to the source's installed major
// (@tanstack/react-query ^5). `?deps=react@19` keeps a single React.
export {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
};

// Tiny icon helper — lucide-static SVG paths inlined as needed to avoid an
// extra CDN hop. Add more glyphs as features need them.
const ICONS = {
  // Tasks pkg glyphs (reused):
  'check-square': 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  'calendar-days':
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM21 21l-4.35-4.35',
  plus: 'M5 12h14M12 5v14',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'alert-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
  'alert-triangle': 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  loader: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
  check: 'M20 6L9 17l-5-5',
  'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  'git-branch': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  // Agent ops specific glyphs:
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  'play-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM10 8l6 4-6 4V8z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  timer: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6M16.24 16.24l-4.24-4.24M4.93 4.93l14.14 14.14',
  'bar-chart-2': 'M18 20V10M12 20V4M6 20v-6',
  'x-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM15 9l-6 6M9 9l6 6',
  'radio': 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4.93 4.93a10 10 0 0 0 0 14.14M19.07 4.93a10 10 0 0 1 0 14.14M7.76 7.76a6 6 0 0 0 0 8.49M16.24 7.76a6 6 0 0 1 0 8.49',
  'zap': 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
};

// Class-name joiner — replaces clsx + tailwind-merge. With Tailwind gone there
// are no utility conflicts to dedupe, so a truthy-join is sufficient.
export function cn(...inputs) {
  /** @type {string[]} */ const out = [];
  for (const i of inputs) {
    if (!i) continue;
    if (typeof i === 'string') out.push(i);
    else if (Array.isArray(i)) out.push(cn(...i));
    else if (typeof i === 'object') {
      for (const k of Object.keys(i)) if (i[k]) out.push(k);
    }
  }
  return out.join(' ');
}

// Button — ported from src/components/Button.tsx. Utility classes become
// .ao-btn / sz-* / v-* rules in agent-ops-css.js.
export function Button({ variant = 'default', size = 'md', class: cls = '', children, ...props }) {
  const className = ['ao-btn', `sz-${size}`, `v-${variant}`, cls]
    .filter(Boolean)
    .join(' ');
  return html`<button class=${className} ...${props}>${children}</button>`;
}

export function Icon({ name, size = 16, className, strokeWidth = 2 }) {
  const path = ICONS[name];
  if (!path) return null;
  // Multi-subpath glyphs are encoded as a single `d` string with multiple M
  // segments — render as one <path>; works for every glyph above.
  return html`<svg
    class=${className}
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width=${strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
  ><path d=${path} /></svg>`;
}
