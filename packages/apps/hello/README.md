# `@ikenga/pkg-hello`

The smallest valid Ikenga pkg — a manifest, no code.

Its job is to prove the registry install pipeline end-to-end without
dragging in a UI surface, sidecar, or MCP server. Installing it from the
shell or the CLI exercises:

1. Index fetch + minisign verify
2. Per-pkg detail fetch
3. Tarball download + SHA-512 integrity verify
4. Untar into the kernel's pkgs dir
5. Manifest registration with every kernel registry (all of which no-op
   on this pkg because it declares nothing)

Once you've installed it, you should see `Hello` listed in the shell's
**Packages** activity-bar entry with `source: registry`. Uninstalling
removes the install dir.

If you're looking for an example of how to build a real pkg with UI,
sidecars, MCP, or scheduled work, see the other packages in this monorepo
or the public [Ikenga shell repo](https://github.com/ikenga-hq/ikenga).
