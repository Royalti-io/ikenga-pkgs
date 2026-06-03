---
"@ikenga/pkg-tasks": patch
---

P3 increment 2: automate the token vendoring (kill the drift inc-1 only moved).

`dist/lib/tokens-css.js` and `dist/lib/tasks-css.js` are no longer hand-maintained.
A new `scripts/build.mjs` (wired as the pkg `build`) **copies** `tokens-css.js` from the
installed `@ikenga/tokens` — now a real `^0.3.0` devDependency, so it can never drift from
the published tokens — and **codegens** `tasks-css.js` from `dist/tasks.css` via one
`JSON.stringify` escape (replacing the hand-escaped mirror). A CI `git diff --exit-code`
drift-guard (after `pnpm -r build`) fails any pkg whose committed `dist/` diverges from a
fresh build. No visual change: the generated `tokens-css.js` is byte-identical to the
published `@ikenga/tokens@0.3.0`, and the regenerated `tasks-css.js` decodes to the same CSS.
