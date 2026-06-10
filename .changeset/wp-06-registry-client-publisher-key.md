---
"@ikenga/registry-client": minor
---

WP-06 (ADR-017 trusted-pkg signing): `InstallStep` now carries an optional
`publisherKey` threaded from the signed registry's per-version detail. The
installer passes it into `InstallSource::Registry.publisher_key`, where the
shell minisign-verifies the manifest's `signature` against it — the gate for
trusted-for-elevated capabilities (host.fetch / named secrets / scoped invoke).
Additive + read defensively (`undefined` for unsigned/community pkgs), so no
call-site change is required and the field activates once `@ikenga/contract`'s
registry schema admits `publisherKey` on `RegistryEntry`/`PkgVersion`.
