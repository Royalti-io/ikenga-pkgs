# @ikenga/pkg-wikipedia

Wikipedia in a native Ikenga child webview.

## Why this package exists

It is the **native-path proof for Phase 1**. The other three proof-of-concept packages
(Spotify for Artists, Sentry, Notion) all run in Managed Chrome (`engines: ["chrome"]`)
because Google blocks OAuth from embedded browser user agents, so none of them can
complete login inside a WebKit surface — see the plan's `02-research-external.md`
§"Embedded OAuth SSO Limits & ToS Restrictions".

That research is correct, but it left Phase 1 unable to prove itself: a Managed-Chrome
package opens its own OS window, so it exercises no in-shell pane, gives the pane-chrome
session control nothing to attach to, and creates no `webjars/<pkg>/<partition>/` jar to
wipe.

Wikipedia needs no login at all and permits embedding, so it exercises the whole native
path end to end:

- `ui.routes[].kind: "webview"` + `capabilities.webview.child_webviews` → mounts as an
  in-shell child webview on the default `webkit` engine
- a route-level `partition` → a real jar at `webjars/wikipedia/persist:wikipedia/`
- `ui.session.persistence: "clear-on-exit"` → exercises the wipe path, which the three
  `keep` packages never would
- `allowed_origins` with both an apex and a subdomain glob → exercises both matcher shapes

## Verify

```bash
ikenga dev ikenga-pkgs/packages/apps/wikipedia
```

Expected: the page renders in a pane (not a separate OS window), the pane chrome shows a
session indicator reading "clear on exit", and `webjars/wikipedia/persist:wikipedia/`
exists on disk after first load and is gone after the app quits.
