// com.ikenga.studio · Launcher — inline icon set
//
// A tiny lucide subset rendered inline (no icon dependency, single-chunk
// friendly). Multi-stroke glyphs are expressed as an array of `d` paths.
// `filled` flips to fill:currentColor / stroke:none for solid glyphs (play).

const ICON_PATHS: Record<string, string | string[]> = {
  sparkles:
    'M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5 10.1 7.6ZM5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9ZM19 14l.6 1.5L21 16l-1.4.5L19 18l-.6-1.5L17 16l1.4-.5Z',
  film: 'M2 2h20v20H2zM2 7h20M2 17h20M7 2v20M17 2v20',
  package:
    'M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Zm-9 5.5V12m0 0 8.7-5M12 12 3.3 7',
  scissors:
    'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  plus: 'M12 5v14M5 12h14',
  folder:
    'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  play: 'M7 4v16l13-8z',
  refresh: [
    'M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-2.64L3 16',
    'M3 21v-5h5',
  ],
  alert: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4M12 17h.01'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  chevron: 'M6 9l6 6 6-6',
  command: 'M15 6a3 3 0 1 0 3 3H6a3 3 0 1 0 3-3v12a3 3 0 1 0-3-3h12a3 3 0 1 0-3 3Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
};

export function Icon({
  name,
  size = 14,
  className = '',
  filled = false,
}: {
  name: string;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  const d = ICON_PATHS[name] ?? ICON_PATHS.package;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
  );
}
