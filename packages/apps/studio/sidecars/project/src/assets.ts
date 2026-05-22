/**
 * asset.* RPC implementations (WP-03b).
 *
 * Assets are plain files under `<projectRoot>/assets/<kind-subdir>/`. There
 * is no separate asset registry table — the filesystem IS the registry, in
 * keeping with the "filesystem is the source of truth" principle (01-plan
 * §"Filesystem"). Asset ids are project-relative paths under `assets/`
 * (e.g. `images/logo.png`), which is also how an AssetRef.uri resolves.
 *
 *   • list(kind?)        — walk assets/ (optionally a single kind subdir),
 *                          return relative path + size + mime guess.
 *   • import(source, kind?) — copy a local file (or download an http(s) URL)
 *                          into assets/<kind-subdir>/, return the new
 *                          relative id + abs path.
 *   • resolve(assetId)   — map a relative asset id to an abs path + metadata.
 *
 * Imports write to a `.tmp` sibling then rename so a watcher (if assets/ were
 * watched — it is not in P1) never sees a partial copy; it is also just good
 * hygiene for large media files.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const KIND_SUBDIR: Record<string, string> = {
  image: 'images',
  images: 'images',
  video: 'video',
  audio: 'audio',
  font: 'fonts',
  fonts: 'fonts',
};

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function guessMime(p: string): string | undefined {
  return MIME_BY_EXT[extname(p).toLowerCase()];
}

function assetsRoot(projectRoot: string): string {
  return join(projectRoot, 'assets');
}

function kindToSubdir(kind: string | undefined): string {
  if (!kind) return '';
  return KIND_SUBDIR[kind.toLowerCase()] ?? kind;
}

function walkFiles(dir: string, baseForRel: string, out: Array<{ id: string; abs: string }>): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(abs, baseForRel, out);
    } else if (st.isFile()) {
      out.push({ id: relative(baseForRel, abs), abs });
    }
  }
}

export interface AssetResult {
  result: Record<string, unknown>;
}

export function list(projectRoot: string, kind?: string): AssetResult {
  const root = assetsRoot(projectRoot);
  const sub = kindToSubdir(kind);
  const scanRoot = sub ? join(root, sub) : root;
  if (!existsSync(scanRoot)) {
    return { result: { ok: true, assets: [] } };
  }
  const found: Array<{ id: string; abs: string }> = [];
  walkFiles(scanRoot, root, found);
  const assets = found.map((f) => {
    let size = 0;
    try {
      size = statSync(f.abs).size;
    } catch {
      // ignore
    }
    return {
      id: f.id,
      uri: f.id, // project-relative AssetRef.uri
      abs_path: f.abs,
      mime: guessMime(f.abs),
      size,
    };
  });
  return { result: { ok: true, assets } };
}

export async function importAsset(
  projectRoot: string,
  source: string,
  kind?: string,
): Promise<AssetResult> {
  const sub = kindToSubdir(kind);
  const destDir = sub ? join(assetsRoot(projectRoot), sub) : assetsRoot(projectRoot);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  const isUrl = /^https?:\/\//i.test(source);
  let baseName: string;
  if (isUrl) {
    try {
      baseName = basename(new URL(source).pathname) || `asset-${randomUUID().slice(0, 8)}`;
    } catch {
      return { result: { ok: false, error: 'invalid-args', message: `invalid source URL: ${source}` } };
    }
  } else {
    const absSrc = isAbsolute(source) ? source : resolve(projectRoot, source);
    if (!existsSync(absSrc)) {
      return { result: { ok: false, error: 'source-not-found', message: absSrc } };
    }
    baseName = basename(absSrc);
  }

  const dest = join(destDir, baseName);
  const tmp = join(destDir, `.${baseName}.${randomUUID().slice(0, 8)}.tmp`);

  try {
    if (isUrl) {
      const resp = await fetch(source);
      if (!resp.ok) {
        return { result: { ok: false, error: 'fetch-failed', message: `HTTP ${resp.status} for ${source}` } };
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      writeFileSync(tmp, buf);
    } else {
      const absSrc = isAbsolute(source) ? source : resolve(projectRoot, source);
      copyFileSync(absSrc, tmp);
    }
    renameSync(tmp, dest);
  } catch (e) {
    return { result: { ok: false, error: 'internal-error', message: (e as Error).message } };
  }

  const id = relative(assetsRoot(projectRoot), dest);
  let size = 0;
  try {
    size = statSync(dest).size;
  } catch {
    // ignore
  }
  return {
    result: {
      ok: true,
      asset: { id, uri: id, abs_path: dest, mime: guessMime(dest), size },
    },
  };
}

export function resolveAsset(projectRoot: string, assetId: string): AssetResult {
  // assetId is a project-relative path under assets/ (or, defensively, a
  // bare path we resolve against the project root).
  const underAssets = join(assetsRoot(projectRoot), assetId);
  const candidates = [underAssets, isAbsolute(assetId) ? assetId : resolve(projectRoot, assetId)];
  for (const abs of candidates) {
    if (existsSync(abs)) {
      let size = 0;
      try {
        size = statSync(abs).size;
      } catch {
        // ignore
      }
      return {
        result: {
          ok: true,
          asset: { id: assetId, abs_path: abs, uri: `file://${abs}`, exists: true, mime: guessMime(abs), size },
        },
      };
    }
  }
  return {
    result: {
      ok: true,
      asset: { id: assetId, abs_path: underAssets, uri: `file://${underAssets}`, exists: false },
    },
  };
}
