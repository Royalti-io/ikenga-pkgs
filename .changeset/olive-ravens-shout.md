---
'@ikenga/skill-groundwork': patch
'@ikenga/storyboard-workflow': patch
'@ikenga/studio-beat-detect': patch
'@ikenga/studio-doctor': patch
'@ikenga/video-script-structure': patch
---

Republish to get these five into the registry catalog.

All five are on npm but absent from `index.json`, so `ikenga add` cannot see
them. Registry membership is driven entirely by "appeared in a changesets
publish AND has a manifest.json", and there is no backfill path other than
publishing again — the index updater only ever acts on `publishedPackages`.

Groundwork additionally could not have been catalogued even if it had been in
a batch: it had no `manifest.json` at all, and its `files` list omitted the
manifest so the tarball would not have carried one either. Both are fixed here;
the manifest matches the shape its seven sibling skill pkgs use and validates
against the contract's `ManifestSchema`.

No functional change to any of the five — this is a version bump to give the
release workflow something to publish.
