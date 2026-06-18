---
'@ikenga/pkg-mail': patch
---

Fix the mail list not scrolling. `.mail-list` is a grid item in `.pane-split` (a `display:grid; height:100%` container); grid items default to `min-height:auto`, so `.mail-list` couldn't shrink below its content and the inner `.mail-list-scroll` (`flex:1; overflow-y:auto; min-height:0`) never received a bounded height. Adds `min-height:0` to `.mail-list` and regenerates the injected `dist/lib/mail-css.js` string.
