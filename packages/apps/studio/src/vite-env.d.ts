/// <reference types="vite/client" />

// Vite's client types declare the ambient modules for CSS / asset imports
// (e.g. `import './studio/styles/index.css'`) and `import.meta.env`. Without
// this reference tsc can't resolve the side-effect CSS import in main.tsx.
