# Studio smoke fixture (`sample`)

A runnable, schema-valid `com.ikenga.studio` project that exercises the whole
pipeline end-to-end: a HyperFrames (hi-fi) cell and an Excalidraw (lo-fi) cell,
both render-verifiable to MP4. Built for **WP-11 — Smoke fixture**.

> Path note (orchestrator override): the WP-11 plan said
> `pkgs/test-studio/sample/`, but that's the pre-ADR-009 local-only `pkgs/`
> tree. This fixture lives **inside the studio pkg** at
> `packages/apps/studio/fixtures/sample/` so it is tracked and travels with
> the package.

## Contents

```
fixtures/sample/
├─ storyboard.json                       # schema-valid Project (archetype_id: "explainer", 16:9)
├─ cells/
│  ├─ hifi/hello-hifi/
│  │  ├─ index.html                      # HyperFrames composition (3s, GSAP timeline)
│  │  └─ gsap.min.js                      # GSAP vendored locally → renders network-free
│  └─ lofi/hello-lofi/
│     └─ content.excalidraw              # Excalidraw scene: 2 shapes + 1 text element
├─ .gitignore                            # keeps generated renders/ + exports/ out of git
└─ README.md
```

The two cells share one beat (`beat-hello`):

| Cell uid     | Rung      | Renderer      | Content                              |
|--------------|-----------|---------------|--------------------------------------|
| `hello-hifi` | `2_hifi`  | `hyperframes` | `cells/hifi/hello-hifi/index.html`   |
| `hello-lofi` | `1_lofi`  | `excalidraw`  | `cells/lofi/hello-lofi/content.excalidraw` |

`renders/` and `exports/` are **generated** by the render queue / exporter and
are gitignored — the committed fixture is source only.

## Copy it to a new project

```bash
cp -R packages/apps/studio/fixtures/sample /path/to/my-project
```

The fixture is a complete project directory: `storyboard.json` at the root,
cell sources under `cells/<rungDir>/<uid>/`. Opening it creates the
`renders/`/`exports/` dirs as needed.

## Open it

**Via the studio iframe launcher** — point the studio UI's "open project" at
the copied directory.

**Via `ikenga dev` + the MCP** — run the studio pkg under the shell, then call
the project MCP tool `project.open` with the absolute path to the directory.
Then `storyboard.list_cells` to see the two cells, and `composition.render`
(MCP) / `render.enqueue` (sidecar RPC) on each cell uid.

## Prove it renders (no shell required)

Drive the built sidecar over JSON-RPC on stdio with the trust stub on:

```bash
# from packages/apps/studio  (cwd matters: the sidecar resolves
# better-sqlite3 / puppeteer / esbuild from studio/node_modules)
STUDIO_TRUST_STUB=1 node sidecars/project/dist/sidecar.js
```

then write line-delimited JSON-RPC 2.0 frames on stdin:

```jsonc
{"jsonrpc":"2.0","id":1,"method":"project.open","params":{"path":"/abs/path/to/sample"}}
{"jsonrpc":"2.0","id":2,"method":"storyboard.list_cells","params":{"projectId":"<id-from-open>"}}
{"jsonrpc":"2.0","id":3,"method":"render.enqueue","params":{"projectId":"<id>","cellId":"hello-hifi"}}
{"jsonrpc":"2.0","id":4,"method":"render.status","params":{"recordId":"<id-from-enqueue>"}}
{"jsonrpc":"2.0","id":5,"method":"render.enqueue","params":{"projectId":"<id>","cellId":"hello-lofi"}}
```

Poll `render.status` until `record.status === "done"`; `record.output_path`
points at the MP4:

- HF → `renders/hyperframes/hifi/hello-hifi.mp4`  (h264, 1920×1080, 3.0s)
- Excalidraw → `renders/excalidraw/lofi/hello-lofi.mp4`  (h264, 1920×1080, 3.0s)

Both renders need the Puppeteer-pinned Chrome installed
(`npx puppeteer browsers install chrome`); HF additionally shells `npx
hyperframes`, and the Excalidraw adapter needs the platform-matching esbuild
binary present under `node_modules/@esbuild/<platform>`.

## Authoring notes

- **HF composition contract (hyperframes 0.6.36).** The root needs
  `data-composition-id`, `data-width`, `data-height`, and `data-duration` **in
  seconds**; timed children carry `class="clip"` + `data-start`/`data-duration`;
  a paused GSAP timeline is registered synchronously on
  `window.__timelines["main"]`. The HF adapter points the CLI at the cell's own
  directory and requires an `index.html` entry (G-39), which this cell is.
- **Excalidraw cell (G-30).** A static `.excalidraw` scene (no
  `metadata.animation`), so the adapter exports a still and loops it for
  `cell.duration_ms`. The render is verified, not just static.
