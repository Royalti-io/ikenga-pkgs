/**
 * A minimal DOM for unit-testing this pkg's vanilla-DOM views.
 *
 * ── Why not jsdom ───────────────────────────────────────────────────────────
 * `ui/` is a pnpm workspace member of the ikenga-pkgs monorepo, so adding a
 * devDependency rewrites the shared root `pnpm-lock.yaml` — a file other WPs
 * are editing concurrently, and one this WP has no business touching. This
 * file is ~100 lines of the DOM surface `views/commit` actually uses, with no
 * lockfile change and no new install step.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * It is not a browser and it does not pretend to be one: no layout, no CSS, no
 * event bubbling, no default actions, no focus model. It supports exactly the
 * operations `el()` / `button()` / `createCommitBox` perform, and
 * `fire(node, 'input')` calls the listeners registered on THAT node. That is
 * enough to prove the thing under test — that a keystroke updates the live
 * button's `disabled` — and honest about proving nothing else. Anything that
 * depends on real browser behaviour (focus retention, caret position, actual
 * clipboard permissions) is a live-mount check, not this.
 */

interface Listener {
  (event: FakeEvent): void;
}

export interface FakeEvent {
  type: string;
  key?: string;
  preventDefault(): void;
}

export class FakeNode {
  readonly tagName: string;
  className = '';
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  private text = '';
  private readonly listeners = new Map<string, Listener[]>();

  // Form-control surface. Present on every node for simplicity; only ever read
  // on the nodes that really are inputs/buttons.
  type = '';
  value = '';
  placeholder = '';
  disabled = false;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    if (this.childNodes.length === 0) return this.text;
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this.childNodes.length = 0;
    this.text = v;
  }

  /** Only ever assigned `''` by the views — a full clear. Anything else is a
   *  real HTML parse this shim deliberately refuses to fake. */
  set innerHTML(v: string) {
    if (v !== '') throw new Error(`FakeNode.innerHTML only supports '' (got ${JSON.stringify(v)})`);
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    this.text = '';
  }

  get innerHTML(): string {
    return '';
  }

  appendChild(child: FakeNode): FakeNode {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  select(): void {
    /* no selection model — see the header */
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  /** No bubbling: calls only the listeners on this node (see the header). */
  dispatch(event: FakeEvent): void {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
  }

  /** `isConnected` is what the views' `alive()` guard reads before touching
   *  the DOM after an await, so it has to be a real reachability check. */
  get isConnected(): boolean {
    let n: FakeNode | null = this;
    while (n) {
      if (n === documentBody) return true;
      n = n.parentNode;
    }
    return false;
  }

  /** Every descendant, depth-first — the shim's stand-in for querySelectorAll. */
  descendants(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode): void => {
      for (const c of n.childNodes) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

const documentBody = new FakeNode('body');

export const fakeDocument = {
  body: documentBody,
  createElement(tag: string): FakeNode {
    return new FakeNode(tag);
  },
};

/** Install the shim as the global `document`. Returns a restore function. */
export function installDom(): () => void {
  const g = globalThis as Record<string, unknown>;
  const prev = g.document;
  documentBody.innerHTML = '';
  g.document = fakeDocument;
  return () => {
    if (prev === undefined) delete g.document;
    else g.document = prev;
  };
}

/** Dispatch a plain event on one node. */
export function fire(node: FakeNode, type: string, extra: Partial<FakeEvent> = {}): void {
  node.dispatch({ type, preventDefault() {}, ...extra });
}

/** The first descendant (or self) whose textContent is exactly `label`. */
export function findByText(root: FakeNode, tag: string, label: string): FakeNode | undefined {
  return root
    .descendants()
    .find((n) => n.tagName === tag.toUpperCase() && n.textContent === label);
}

export function findByTag(root: FakeNode, tag: string): FakeNode | undefined {
  return root.descendants().find((n) => n.tagName === tag.toUpperCase());
}
