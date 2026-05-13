// Public surface of @ikenga/registry-client.
//
// Two layers:
//   - `fetch`   — fetchIndex (signature-verified), fetchPkgDetail.
//   - `resolve` — resolveInstallPlan, compareInstalled, semverCompare.
//   - `minisign` — exported for callers who already have raw bytes + need
//                  to verify without round-tripping through `fetchIndex`.
//
// Re-exports the registry types from @ikenga/contract so consumers can
// import everything from one place.

export {
  fetchIndex,
  fetchPkgDetail,
  type FetchIndexOptions,
  type FetchedIndex,
  type FetchPkgDetailOptions,
} from './fetch.js';

export {
  resolveInstallPlan,
  compareInstalled,
  semverCompare,
  type InstallStep,
  type ResolveOptions,
} from './resolve.js';

export {
  verify as verifyMinisign,
  decodePublicKey as decodeMinisignPublicKey,
  decodeSignature as decodeMinisignSignature,
  type MinisignPublicKey,
  type MinisignSignature,
} from './minisign.js';

export type {
  RegistryIndex,
  RegistryEntry,
  PkgDetail,
  PkgVersion,
  PkgDep,
} from '@ikenga/contract/registry';
