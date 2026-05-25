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

// TanStack Query — caching layer carried over from the source app (triage
// counts query + list/detail caches). Pinned to the source's installed major
// (@tanstack/react-query ^5.100.6 → 5). `?deps=react@19` keeps a single React.
export {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
};

// Tiny icon helper — lucide-static SVG paths inlined as needed to avoid an
// extra CDN hop (the source app used lucide-react; we mirror suite's inline
// pattern instead). Add more glyphs as features need them.
const ICONS = {
  // Source app glyphs (lucide path data):
  'check-square': 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  'calendar-days':
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',
  stethoscope:
    'M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1M8 15a6 6 0 0 0 12 0v-3M20 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM21 21l-4.35-4.35',
  plus: 'M5 12h14M12 5v14',
  'chevron-down': 'M6 9l6 6 6-6',
  'alert-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
  loader: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
  check: 'M20 6L9 17l-5-5',
  'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  'git-branch': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
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

// Button — ported from src/components/Button.tsx. Tailwind utility classes
// became .tk-btn / sz-* / v-* rules in tasks.css.
export function Button({ variant = 'default', size = 'md', class: cls = '', children, ...props }) {
  const className = ['tk-btn', `sz-${size}`, `v-${variant}`, cls]
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
