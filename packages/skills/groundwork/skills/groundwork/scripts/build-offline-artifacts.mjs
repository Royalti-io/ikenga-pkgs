#!/usr/bin/env node
/**
 * build-offline-artifacts.mjs — turn the readable JSX `*.src.html` artifact
 * templates into fully self-contained, network-free `index.html` files.
 *
 *   1. Transpiles the single `<script type="text/babel">` block with Babel's
 *      `react` preset ONLY (JSX → React.createElement; modern JS like async /
 *      spread / optional-chaining is left native, so there's no regenerator
 *      runtime to ship). The artifacts run in modern Chromium/WebKitGTK.
 *   2. Inlines the 4 runtime libs (react, react-dom, marked, dompurify) and
 *      DELETES the 2.8 MB @babel/standalone CDN script.
 *
 * Result: every generated explorer / plans-index runs with NO network for JS — works
 * air-gapped / Claude Desktop / anywhere. (The only external ref is the Google Fonts
 * <link>, which degrades to the system-font fallback stack offline.) Babel is BUILD-time only.
 *
 * Run from anywhere:  node scripts/build-offline-artifacts.mjs
 * Re-run after editing any `*.src.html`. Pinned lib versions live in LIBS below;
 * they are fetched once and cached under the OS temp dir.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..');

// Pinned, must match what the *.src.html templates reference.
const LIBS = {
  react:     'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  reactDom:  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  marked:    'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  dompurify: 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
};
const BABEL = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.25.6/babel.min.js';

const cacheDir = join(tmpdir(), 'gw-offline-vendor');
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

async function fetchCached(url) {
  const file = join(cacheDir, url.replace(/[^a-z0-9.]/gi, '_'));
  if (existsSync(file)) return readFileSync(file, 'utf8');
  process.stdout.write(`  ↓ ${url.split('/npm/')[1]}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const txt = await res.text();
  writeFileSync(file, txt);
  return txt;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildOne(srcRel, Babel, libSources) {
  const srcPath = join(SKILL, srcRel);
  const outPath = srcPath.replace(/\.src\.html$/, '.html');
  let html = readFileSync(srcPath, 'utf8');

  // 1. inline the runtime libs (preserve original tag order = load order)
  for (const [name, url] of Object.entries(LIBS)) {
    const re = new RegExp(`[ \\t]*<script\\b[^>]*\\bsrc="${escapeRe(url)}"[^>]*></script>`, 'g');
    html = html.replace(re, () => `<script>/* vendored ${name} · ${url.split('/npm/')[1]} */\n${libSources[name]}\n</script>`);
  }
  // 2. delete the build-only Babel CDN script
  html = html.replace(new RegExp(`[ \\t]*<script\\b[^>]*\\bsrc="${escapeRe(BABEL)}"[^>]*></script>\\n?`, 'g'), '');
  // 3. transpile the JSX block (react preset only → no regenerator)
  let transpiled = false;
  html = html.replace(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/, (m, code) => {
    transpiled = true;
    const out = Babel.transform(code, { presets: ['react'], compact: false, comments: false }).code;
    return `<script>/* transpiled from JSX at build time (no Babel runtime) */\n${out}\n</script>`;
  });
  if (!transpiled) throw new Error(`no <script type="text/babel"> block in ${srcRel}`);

  // sanity: no external script srcs should remain
  const leftover = html.match(/<script\b[^>]*\bsrc="https?:[^"]*"/g);
  if (leftover) throw new Error(`${srcRel}: external script(s) survived: ${leftover.join(', ')}`);

  writeFileSync(outPath, html);
  return { outPath, bytes: html.length };
}

// Regenerate the two explorer profile overlays from the built (offline) base.
function buildOverlays() {
  const base = readFileSync(join(SKILL, 'profiles/_shared/explorer/index.html'), 'utf8');
  const marker = '  <script type="application/json" id="explorer-overlay">\n  {}\n  </script>';
  if (!base.includes(marker)) throw new Error('overlay marker not found in built base explorer');
  const mk = (profile, cfg, note) => base.replace(marker,
    `  <!-- PROFILE OVERLAY · ${profile} · derived from profiles/_shared/explorer/index.html.\n` +
    `       Regenerate from the base when the base changes; only this\n` +
    `       #explorer-overlay config block differs. ${note} -->\n` +
    `  <script type="application/json" id="explorer-overlay">\n  ${cfg}\n  </script>`);
  writeFileSync(join(SKILL, 'profiles/design-system/explorer/index.html'),
    mk('design-system', '{ "defaultMode": "gallery", "railOpen": true }', 'Gallery-first: opens on the designs grid; design lock/maturity badges to the fore.'));
  writeFileSync(join(SKILL, 'profiles/content/explorer/index.html'),
    mk('content', '{ "defaultMode": "media", "highlightPublish": true, "railOpen": true }', 'Media-first: opens on the key-art / slide grid; PUBLISH-NOW.md flagged as actionable.'));
}

const SOURCES = ['profiles/_shared/explorer/index.src.html', 'profiles/_shared/plans-index/index.src.html'];

(async () => {
  console.log('Fetching pinned libs (cached under ' + cacheDir + ')…');
  const libSources = {};
  for (const [name, url] of Object.entries(LIBS)) libSources[name] = await fetchCached(url);
  const Babel = require(join(cacheDir, await fetchCached(BABEL).then(() => BABEL.replace(/[^a-z0-9.]/gi, '_'))));

  console.log('Building offline artifacts:');
  for (const src of SOURCES) {
    const { outPath, bytes } = buildOne(src, Babel, libSources);
    console.log(`  ✓ ${outPath.replace(SKILL + '/', '')}  (${(bytes / 1024).toFixed(0)} KB)`);
  }
  buildOverlays();
  console.log('  ✓ regenerated design-system + content explorer overlays from built base');
  console.log('Done — generated index.html files are fully self-contained (no network).');
})();
