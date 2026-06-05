---
'@ikenga/pkg-tasks': patch
---

Publish the mounted view + open-task selection to the shell's iyke iframe-state registry (`{__iyke, kind:'state'}` postMessage), so `iyke state` / `iyke iframe-state` report what's open in the pane without DB spelunking. New `publishIykeState(key, value)` helper in lib/bridge.js.
