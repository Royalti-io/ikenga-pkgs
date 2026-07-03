// facet-filter — recipe-shared shape (facet-wire recipe), lift-ready for a
// future @ikenga/pkg-runtime extraction. DO NOT add domain columns here; this
// stays domain-agnostic.
//
// Wire it fits: the shell relays a sidebar filter-facet click as
// `royaltiSuite.activeFeature = <the clicked PkgMenuItem id>` (e.g. 'f:mine')
// via the host-context re-emit — NEVER a pkg-menu-click message. The pkg keeps
// the last-applied facet id in state and calls `applyFacet` to derive the
// visible slice of its list. Pair this generic applier with a *domain* predicate
// map (facetId → (item) => boolean) declared in the view, where the domain
// columns live. Canonical consumer to mirror: tasks-view.js (FILTER_ITEMS + the
// activeFeature effect that narrows the list).

/** Reset/clear facet id — the "show everything" affordance. Tasks uses 'f:all'. */
export const RESET_FACET = 'f:all';

/**
 * Return the slice of `items` that matches `facetId`.
 *
 * Inertness contract (matches tasks' behavior): a null/empty facet, the reset
 * id, or an id with no predicate all return every item — an *unknown* facet is
 * inert, never empty. So a stray dispatch can't blank the list.
 *
 * @template T
 * @param {T[]} items                                       full list
 * @param {string | null | undefined} facetId               last-applied facet id
 * @param {Record<string, (item: T) => boolean>} predicates domain predicate map
 * @param {string} [resetId]                                clear id (default 'f:all')
 * @returns {T[]}
 */
export function applyFacet(items, facetId, predicates, resetId = RESET_FACET) {
  if (!Array.isArray(items)) return [];
  if (!facetId || facetId === resetId) return items;
  const pred = predicates?.[facetId];
  return typeof pred === 'function' ? items.filter(pred) : items;
}

/** True for sidebar filter-facet ids (the 'f:' namespace, incl. 'f:t:*'). */
export function isFacetId(id) {
  return typeof id === 'string' && id.startsWith('f:');
}
