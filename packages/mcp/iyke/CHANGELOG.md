# @ikenga/mcp-iyke

## 0.1.3

### Patch Changes

- [`de8a6e1`](https://github.com/Royalti-io/ikenga-pkgs/commit/de8a6e170fb2b380a34343697d2724da572bdc06) Thanks [@nedjamez](https://github.com/nedjamez)! - Republish to land in the signed registry index. The 0.1.2 release predates
  the post-publish `update-registry-index.mjs` step; this republish picks up
  the registry hook so `mcp-iyke` becomes installable from the shell's
  Packages Browse view and from `ikenga add @ikenga/mcp-iyke`.

  Sets up Phase G's "drop the 97 MB compiled iyke-mcp builtin → spawn `bun
run src/index.ts` from the registry-installed source instead" path.
