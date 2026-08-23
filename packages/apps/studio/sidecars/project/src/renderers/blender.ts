/**
 * Blender headless 3D renderer adapter (WP-21, Plan 24).
 *
 * Local deterministic 3D rendering engine for com.ikenga.studio. Spawns
 * Blender in background mode (`blender -b -P script.py`) against on-disk
 * Python/blend compositions, streams frame progress as `render.progress`,
 * and outputs deterministic MP4 / PNG renders.
 *
 * ─── Binary Resolution (G-51) ─────────────────────────────────────────────
 * Cross-platform path resolver checking explicit settings, environment vars,
 * system standard directories, and PATH lookup. Emits `BLENDER_NOT_FOUND`
 * diagnostic if unresolvable.
 *
 * ─── Output Path (G14) ────────────────────────────────────────────────────
 * Lands at `<rendersDir>/blender/<rungDir(cell.rung)>/<uid>.mp4`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

import {
  rungDir,
  type AspectRatio,
  type Cell,
  type RenderRecord,
} from '@ikenga/studio-schema';

import type {
  Diagnostic,
  PreviewURL,
  RenderContext,
  RenderOptions,
  RendererAdapter,
} from './types.js';

let cachedBlenderPath: string | null = null;
let cachedBlenderVersion: string | undefined;

/**
 * Resolve local Blender executable across Windows, macOS, and Linux.
 */
export async function resolveBlenderPath(
  vault?: { get(key: string): Promise<string | undefined> },
): Promise<string | null> {
  if (cachedBlenderPath && existsSync(cachedBlenderPath)) {
    return cachedBlenderPath;
  }

  // 1. Vault or explicit setting
  if (vault) {
    const fromVault = await vault.get('blender_executable_path');
    if (fromVault && existsSync(fromVault)) {
      cachedBlenderPath = fromVault;
      return fromVault;
    }
  }

  // 2. Environment variable
  if (process.env.BLENDER_PATH && existsSync(process.env.BLENDER_PATH)) {
    cachedBlenderPath = process.env.BLENDER_PATH;
    return process.env.BLENDER_PATH;
  }

  // 3. Platform-specific common paths
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    candidates.push(
      join(programFiles, 'Blender Foundation', 'Blender 4.3', 'blender.exe'),
      join(programFiles, 'Blender Foundation', 'Blender 4.2', 'blender.exe'),
      join(programFiles, 'Blender Foundation', 'Blender 4.1', 'blender.exe'),
      join(programFiles, 'Blender Foundation', 'Blender 4.0', 'blender.exe'),
      join(programFiles, 'Blender Foundation', 'Blender', 'blender.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Blender.app/Contents/MacOS/Blender',
      '/Applications/Blender 4.3.app/Contents/MacOS/Blender',
      '/Applications/Blender 4.2.app/Contents/MacOS/Blender',
    );
  } else {
    candidates.push(
      '/usr/bin/blender',
      '/usr/local/bin/blender',
      '/var/lib/flatpak/exports/bin/org.blender.Blender',
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedBlenderPath = candidate;
      return candidate;
    }
  }

  // 4. PATH lookup
  try {
    const lookupCmd = platform === 'win32' ? 'where.exe blender' : 'which blender';
    const found = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split(/\r?\n/)[0];
    if (found && existsSync(found)) {
      cachedBlenderPath = found;
      return found;
    }
  } catch {
    // PATH lookup failed
  }

  return null;
}

export async function getBlenderVersion(blenderBin: string): Promise<string | undefined> {
  if (cachedBlenderVersion) return cachedBlenderVersion;
  try {
    const out = execSync(`"${blenderBin}" --version`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = out.match(/Blender\s+([\d.]+)/i);
    if (match?.[1]) {
      cachedBlenderVersion = match[1];
      return cachedBlenderVersion;
    }
  } catch {
    // Ignore version parse error
  }
  return undefined;
}

export const blenderAdapter: RendererAdapter = {
  id: 'blender',

  capabilities: {
    still: true,
    video: true,
    interactive: false,
    range: true,
    combine: false,
    aspect_ratios: ['16:9', '9:16', '1:1'],
    max_duration_ms: null, // local rendering is unbounded
    supported_codecs: ['h264', 'hevc', 'png', 'exr'],
    requires_network: false, // local execution
  },

  async validate(cell: Cell, ctx: RenderContext): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const blenderBin = await resolveBlenderPath(ctx.vault);

    if (!blenderBin) {
      diagnostics.push({
        severity: 'error',
        code: 'BLENDER_NOT_FOUND',
        message:
          'Blender executable not found on host. Install Blender or configure `blender_executable_path` in settings.',
        path: 'renderer',
      });
    }

    if (cell.content_path) {
      const fullPath = resolve(ctx.projectRoot, cell.content_path);
      if (!existsSync(fullPath)) {
        diagnostics.push({
          severity: 'error',
          code: 'CONTENT_MISSING',
          message: `Blender source file missing at ${cell.content_path}`,
          path: 'content_path',
        });
      }
    }

    return diagnostics;
  },

  async preview(cell: Cell, ctx: RenderContext): Promise<PreviewURL> {
    const outDir = join(ctx.rendersDir, 'blender', rungDir(cell.rung));
    mkdirSync(outDir, { recursive: true });
    const previewPng = join(outDir, `${cell.uid}_preview.png`);

    if (existsSync(previewPng)) {
      return `file://${previewPng}`;
    }

    const blenderBin = await resolveBlenderPath(ctx.vault);
    if (!blenderBin) {
      throw new Error('[blender] Executable not found. Cannot render preview.');
    }

    const contentPath = cell.content_path ? resolve(ctx.projectRoot, cell.content_path) : '';
    if (!contentPath || !existsSync(contentPath)) {
      throw new Error(`[blender] Content file missing at ${cell.content_path}`);
    }

    // Render single frame 1 as preview PNG
    await new Promise<void>((res, rej) => {
      const args: string[] = ['--background'];
      if (contentPath.endsWith('.blend')) {
        args.push(contentPath, '-f', '1');
      } else if (contentPath.endsWith('.py')) {
        args.push('--python', contentPath, '--', '--render-frame', '1');
      }
      args.push('-o', previewPng.replace(/\.png$/, ''));

      const child = spawn(blenderBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('error', rej);
      child.on('close', (code) => {
        if (code === 0) res();
        else rej(new Error(`[blender] Preview render exited with code ${code}`));
      });
    });

    return `file://${previewPng}`;
  },

  async render(cell: Cell, opts: RenderOptions, ctx: RenderContext): Promise<RenderRecord> {
    const blenderBin = await resolveBlenderPath(ctx.vault);
    if (!blenderBin) {
      throw new Error('[blender] Executable not found on host (G-51).');
    }

    const version = await getBlenderVersion(blenderBin);
    const aspect = opts.aspect_ratio ?? ctx.aspectRatio;
    const res = opts.resolution ?? ctx.resolution;

    const outDir = join(ctx.rendersDir, 'blender', rungDir(cell.rung));
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${cell.uid}.mp4`);

    const contentPath = cell.content_path ? resolve(ctx.projectRoot, cell.content_path) : '';
    if (!contentPath || !existsSync(contentPath)) {
      throw new Error(`[blender] Content path missing or unreadable: ${cell.content_path}`);
    }

    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();

    ctx.emit({
      type: 'render.progress',
      payload: { cellId: cell.uid, pct: 0, phase: 'launching_blender' },
    });

    await new Promise<void>((resResolve, rej) => {
      const args: string[] = ['--background'];

      if (contentPath.endsWith('.blend')) {
        args.push(contentPath);
      }
      if (contentPath.endsWith('.py')) {
        args.push('--python', contentPath);
      }

      // Output render settings
      args.push(
        '-o',
        outPath.replace(/\.mp4$/, '_####'),
        '-F',
        'FFMPEG',
        '-x',
        '1',
        '-a', // animation render
      );

      const child = spawn(blenderBin, args, {
        cwd: ctx.projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const onAbort = () => {
        child.kill('SIGTERM');
        rej(new Error('[blender] Render cancelled by abort signal'));
      };
      ctx.signal.addEventListener('abort', onAbort);

      let totalFrames = Math.max(1, Math.round(((cell.duration_ms || 3000) / 1000) * 24));

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        // Parse "Fra:12" or "Rendering 12 / 120 frames"
        const frameMatch = text.match(/Fra:(\d+)/i) || text.match(/Rendering\s+(\d+)\s*\/\s*(\d+)/i);
        if (frameMatch) {
          const currentFrame = parseInt(frameMatch[1], 10);
          if (frameMatch[2]) {
            totalFrames = parseInt(frameMatch[2], 10);
          }
          const pct = Math.min(100, Math.round((currentFrame / totalFrames) * 100));
          ctx.emit({
            type: 'render.progress',
            payload: { cellId: cell.uid, pct, frame: currentFrame, totalFrames, phase: 'rendering' },
          });
        }
      });

      child.on('error', (err) => {
        ctx.signal.removeEventListener('abort', onAbort);
        rej(err);
      });

      child.on('close', (code) => {
        ctx.signal.removeEventListener('abort', onAbort);
        if (code === 0) {
          resResolve();
        } else {
          rej(new Error(`[blender] Process exited with code ${code}`));
        }
      });
    });

    const finishedAt = new Date().toISOString();
    const finishedAtMs = Date.now();

    const record: RenderRecord = {
      id: randomUUID(),
      cell_uid: cell.uid,
      rung: cell.rung,
      engine: 'blender',
      model_id: 'blender-bpy',
      engine_version: version,
      variant: opts.variant ?? 'default',
      status: 'done',
      output: { uri: outPath, mime: 'video/mp4' },
      cost_estimate: 0,
      cost_actual: 0,
      started_at: startedAt,
      finished_at: finishedAt,
      metadata: {
        aspect_ratio: aspect,
        resolution: res,
        duration_ms: cell.duration_ms,
        elapsed_ms: finishedAtMs - startedAtMs,
      },
    };

    return record;
  },
};

/**
 * Standalone 3D anchor plate generator (WP-25).
 * Renders multi-angle reference stills of a 3D asset (.glb/.obj) under 3-point lighting.
 */
export async function generateAnchorPlate(
  opts: {
    meshPath: string;
    angle: 'front' | 'three_quarter_left' | 'three_quarter_right' | 'profile';
    aspect?: AspectRatio;
    keyGetter?: () => Promise<string | undefined>;
  },
  outPath: string,
): Promise<{ uri: string; model_id: string; cost: number }> {
  const blenderBin = await resolveBlenderPath(opts.keyGetter ? { get: opts.keyGetter } : undefined);
  if (!blenderBin) {
    throw new Error('[blender] Executable not found on host.');
  }

  // Headless script setting up 3-point lighting & camera angle for asset import
  const pythonScript = `
import bpy, sys, math

# Clear default scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import mesh
mesh_path = sys.argv[sys.argv.index('--mesh') + 1]
if mesh_path.endswith('.glb') or mesh_path.endswith('.gltf'):
    bpy.ops.import_scene.gltf(filepath=mesh_path)
elif mesh_path.endswith('.obj'):
    bpy.ops.wm.obj_import(filepath=mesh_path)

# Camera Setup
cam_data = bpy.data.cameras.new("Camera")
cam_obj = bpy.data.objects.new("Camera", cam_data)
bpy.context.scene.collection.objects.link(cam_obj)
bpy.context.scene.camera = cam_obj

angle = sys.argv[sys.argv.index('--angle') + 1]
cam_dist = 4.0
if angle == 'front':
    cam_obj.location = (0, -cam_dist, 1.0)
    cam_obj.rotation_euler = (math.radians(80), 0, 0)
elif angle == 'three_quarter_left':
    cam_obj.location = (-cam_dist * 0.7, -cam_dist * 0.7, 1.0)
    cam_obj.rotation_euler = (math.radians(80), 0, math.radians(-45))
elif angle == 'three_quarter_right':
    cam_obj.location = (cam_dist * 0.7, -cam_dist * 0.7, 1.0)
    cam_obj.rotation_euler = (math.radians(80), 0, math.radians(45))
elif angle == 'profile':
    cam_obj.location = (cam_dist, 0, 1.0)
    cam_obj.rotation_euler = (math.radians(80), 0, math.radians(90))

# 3-Point Lighting
key_light = bpy.data.lights.new("KeyLight", type='AREA')
key_light.energy = 500
key_obj = bpy.data.objects.new("KeyLight", key_light)
key_obj.location = (-2, -3, 3)
bpy.context.scene.collection.objects.link(key_obj)

fill_light = bpy.data.lights.new("FillLight", type='AREA')
fill_light.energy = 250
fill_obj = bpy.data.objects.new("FillLight", fill_light)
fill_obj.location = (3, -2, 2)
bpy.context.scene.collection.objects.link(fill_obj)

rim_light = bpy.data.lights.new("RimLight", type='SPOT')
rim_light.energy = 400
rim_obj = bpy.data.objects.new("RimLight", rim_light)
rim_obj.location = (0, 3, 3)
bpy.context.scene.collection.objects.link(rim_obj)

# Render settings
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.filepath = sys.argv[sys.argv.index('--out') + 1]
bpy.ops.render.render(write_still=True)
`;

  mkdirSync(dirname(outPath), { recursive: true });

  await new Promise<void>((res, rej) => {
    const args = [
      '--background',
      '--python-expr',
      pythonScript,
      '--',
      '--mesh',
      opts.meshPath,
      '--angle',
      opts.angle,
      '--out',
      outPath,
    ];
    const child = spawn(blenderBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', rej);
    child.on('close', (code) => {
      if (code === 0 && existsSync(outPath)) res();
      else rej(new Error(`[blender] Anchor plate generation exited with code ${code}`));
    });
  });

  return { uri: outPath, model_id: 'blender-3point', cost: 0 };
}

export default blenderAdapter;
