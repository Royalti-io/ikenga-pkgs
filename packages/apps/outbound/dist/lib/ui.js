// React + htm via esm.sh — no JSX transpile needed.
// Mirrors tasks/dist/lib/ui.js and mail/dist/lib/ui.js — same React 19 + TanStack Query 5 + htm.

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

export {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
};

// Inline lucide SVG paths — extended with outbound-specific icons.
const ICONS = {
  // Channels
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  'book-open': 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  'git-branch': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  share2: 'M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98M21 5a3 3 0 1 0-6 0 3 3 0 0 0 6 0zM9 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0zM21 19a3 3 0 1 0-6 0 3 3 0 0 0 6 0z',
  // Navigation / UI
  inbox: 'M22 12h-6l-2 3H10l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  calendar: 'M3 4h18v18H3V4zM16 2v4M8 2v4M3 10h18',
  check: 'M20 6L9 17l-5-5',
  'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  'x': 'M18 6L6 18M6 6l12 12',
  'x-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM15 9l-6 6M9 9l6 6',
  'alert-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
  'alert-triangle': 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  loader: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
  'refresh-cw': 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'more-horizontal': 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM21 21l-4.35-4.35',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'bar-chart-2': 'M18 20V10M12 20V4M6 20v-6',
  'file-text': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  'skip-forward': 'M5 4l10 8-10 8V4zM19 5v14',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  linkedin: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  twitter: 'M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z',
  'trending-up': 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
};

// Class-name joiner — replaces clsx.
export function cn(...inputs) {
  const out = [];
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

export function Icon({ name, size = 16, className, strokeWidth = 2 }) {
  const path = ICONS[name];
  if (!path) return null;
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
