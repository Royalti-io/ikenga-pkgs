// com.ikenga.studio · sidebar menu publication + click routing
//
// The shell's pkg sidebar shows "Waiting for pkg menu…" until the pkg calls
// host.pkg.setMenu — bridge.ts shipped the helper in commit 2 but nothing
// invoked it (the live WP-13 pass surfaced the stuck sidebar). This module
// owns that seam: publish on boot, republish when the project opens/closes,
// and map menu clicks (which arrive as hostContext.royaltiSuite.activeFeature
// on the next onhostcontextchanged) onto the focused pane's view.

import { getHostContext, isStandalone, onHostContextChange, setMenu } from './bridge';
import { useLayoutStore } from './layout-store';
import { useProjectStore } from './project-store';
import { VIEW_ORDER, VIEWS, type ViewId } from './routes';

const VIEW_ID_SET: ReadonlySet<string> = new Set(VIEW_ORDER);

function publish(isOpen: boolean): void {
  const items = isOpen
    ? VIEW_ORDER.map((id) => ({ id, label: VIEWS[id].label, icon: VIEWS[id].icon }))
    : [{ id: 'launcher', label: 'Launcher', icon: 'sparkles' }];
  void setMenu(items).catch((err) => {
    console.warn('[studio] host.pkg.setMenu failed', err);
  });
}

/** Publish the sidebar menu and wire click routing. Call once after the
 *  bridge is connected (App mount). Returns a cleanup fn. */
export function initStudioMenu(): () => void {
  if (isStandalone()) return () => {};

  publish(useProjectStore.getState().isOpen);

  const unsubProject = useProjectStore.subscribe((state, prev) => {
    if (state.isOpen !== prev.isOpen) publish(state.isOpen);
  });

  // Seed from the connect-time context so the first change event only acts on
  // a real click — a re-emit of a stale activeFeature must lose (same gotcha
  // as the sub-route deep-link work).
  let lastFeature = getHostContext()?.royaltiSuite?.activeFeature;

  const unsubCtx = onHostContextChange((ctx) => {
    const feature = ctx.royaltiSuite?.activeFeature;
    if (feature === lastFeature) return;
    lastFeature = feature;
    if (feature && VIEW_ID_SET.has(feature)) {
      const { focusedPane, setPaneView } = useLayoutStore.getState();
      setPaneView(focusedPane, feature as ViewId);
    }
  });

  return () => {
    unsubProject();
    unsubCtx();
  };
}
