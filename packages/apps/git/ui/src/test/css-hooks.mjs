// Node module hooks that turn `import './x.css'` into an empty module.
//
// The UI's view modules import their own stylesheet — that is how vite emits
// the single inlined chunk a pkg iframe needs (memory
// `reference_vite_pkg_iframe_delivery`). Under `node --test --import=tsx`
// there is no bundler, so a `.css` specifier is an unknown extension and the
// import throws before a single assertion runs. These hooks make the CSS a
// no-op module so a view can be unit-tested without changing how it ships.
//
// Registered AFTER tsx (see register.mjs), which puts them FIRST in the hook
// chain — Node calls the most recently registered hook first — so `.css` is
// short-circuited here and everything else is delegated straight on to tsx.

const CSS = /\.css(\?.*)?$/;

export async function resolve(specifier, context, nextResolve) {
  if (CSS.test(specifier)) {
    const url = context.parentURL
      ? new URL(specifier, context.parentURL).href
      : specifier;
    return { url, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (CSS.test(url)) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
