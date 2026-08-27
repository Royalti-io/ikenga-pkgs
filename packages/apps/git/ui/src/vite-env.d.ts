/// <reference types="vite/client" />
//
// `import.meta.env.DEV` is what gates the dev-only live-fixture path in
// `mock/mock-sidecar.ts`. Vite replaces it with a literal at build time, which
// is what makes that branch (fetch included) disappear from the production
// bundle instead of merely never running.
