---
"@ikenga/pkg-agent-ops": patch
---

Remove the stray `private: true` that contradicted the package's own
publishConfig.access:public and kept changesets from ever publishing it —
the pkg is now on npm like its 8 domain siblings.
