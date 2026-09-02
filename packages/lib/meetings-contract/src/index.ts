export * from './schema.js';
export * from './ipc.js';
export * from './retention.js';
export * from './db/client.js';

// NOTE: `./storage/media-fs.js` is deliberately NOT re-exported here.
//
// It imports `node:fs`/`node:path`/`node:os`, and this barrel is consumed by
// the `com.ikenga.meetings` iframe app, which bundles for the browser. Pulling
// it in makes the whole package unbundleable (rollup: "node:path is not
// exported"). Node-side consumers import it explicitly:
//
//   import { getMeetingMediaFilePaths } from '@ikenga/meetings-contract/storage';
//
// The `./storage` subpath export in package.json exists for exactly this.
