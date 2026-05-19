import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

import { createPreset } from './preset.js';
import type { CodeEditorHandle, CodeEditorProps } from './types.js';

const InternalUpdate = Annotation.define<true>();

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(props, ref) {
    const {
      value,
      onChange,
      language,
      readOnly = false,
      theme,
      extensions,
      keymapExtensions,
      lspClient,
      documentUri,
      onBlur,
      className,
      ariaLabel,
    } = props;

    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onBlurRef = useRef(onBlur);
    const lspExtensionRef = useRef<Extension | null>(null);

    const compartments = useRef({
      language: new Compartment(),
      theme: new Compartment(),
      readOnly: new Compartment(),
      keymap: new Compartment(),
      lsp: new Compartment(),
      extra: new Compartment(),
    });

    const [ready, setReady] = useState(false);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);
    useEffect(() => {
      onBlurRef.current = onBlur;
    }, [onBlur]);

    // Mount the editor once per host element. Re-runs on language change because
    // the preset is async; we tear down + remount in that narrow case to keep
    // the bootstrap path simple. All other prop changes flow through compartments.
    useLayoutEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      let cancelled = false;
      let view: EditorView | null = null;

      (async () => {
        const presetExts = await createPreset({ language, lint: lspClient != null });
        if (cancelled || !hostRef.current) return;

        const c = compartments.current;
        const docChangeListener = EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          for (const tr of update.transactions) {
            if (tr.annotation(InternalUpdate)) return;
          }
          onChangeRef.current(update.state.doc.toString());
        });
        const blurListener = EditorView.domEventHandlers({
          blur(_event, v) {
            onBlurRef.current?.(v.state.doc.toString());
            return false;
          },
        });

        const state = EditorState.create({
          doc: value,
          extensions: [
            c.language.of(presetExts),
            c.theme.of(theme ?? []),
            c.readOnly.of([
              EditorState.readOnly.of(readOnly),
              EditorView.editable.of(!readOnly),
            ]),
            c.keymap.of(keymapExtensions ? keymap.of([]) : []),
            c.lsp.of([]),
            c.extra.of(extensions ?? []),
            docChangeListener,
            blurListener,
          ],
        });

        view = new EditorView({
          state,
          parent: hostRef.current,
        });
        viewRef.current = view;
        if (ariaLabel) view.contentDOM.setAttribute('aria-label', ariaLabel);
        setReady(true);
      })();

      return () => {
        cancelled = true;
        view?.destroy();
        viewRef.current = null;
        setReady(false);
      };
      // Re-create the view only when `language` changes (rare). All other prop
      // changes are handled by the effects below via compartment reconfigure.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language]);

    // value sync (external → editor) without re-firing onChange.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: InternalUpdate.of(true),
      });
    }, [value, ready]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: compartments.current.theme.reconfigure(theme ?? []) });
    }, [theme, ready]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: compartments.current.readOnly.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
      });
    }, [readOnly, ready]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: compartments.current.keymap.reconfigure(
          keymapExtensions && keymapExtensions.length > 0 ? keymapExtensions : [],
        ),
      });
    }, [keymapExtensions, ready]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: compartments.current.extra.reconfigure(extensions ?? []),
      });
    }, [extensions, ready]);

    // LSP wiring — dynamic-imported so non-LSP consumers don't bundle it.
    useEffect(() => {
      const view = viewRef.current;
      if (!view || !ready) return;
      if (!lspClient) {
        view.dispatch({ effects: compartments.current.lsp.reconfigure([]) });
        lspExtensionRef.current = null;
        return;
      }
      let cancelled = false;
      (async () => {
        const { createCodeMirrorLspExtension } = await import(
          './lsp/codemirror-adapter.js'
        );
        if (cancelled) return;
        const ext = createCodeMirrorLspExtension({
          client: lspClient,
          documentUri:
            documentUri ?? `inmemory://${language}/${cryptoRandomId()}.tsx`,
          languageId: language === 'tsx' ? 'typescriptreact' : language,
        });
        lspExtensionRef.current = ext;
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({ effects: compartments.current.lsp.reconfigure(ext) });
      })();
      return () => {
        cancelled = true;
      };
    }, [lspClient, documentUri, ready, language]);

    useImperativeHandle(
      ref,
      (): CodeEditorHandle => ({
        focus() {
          viewRef.current?.focus();
        },
        insertAtCursor(text: string) {
          const v = viewRef.current;
          if (!v) return;
          const sel = v.state.selection.main;
          v.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
          });
        },
        getSelection() {
          const v = viewRef.current;
          if (!v) return { from: 0, to: 0, text: '' };
          const sel = v.state.selection.main;
          return {
            from: sel.from,
            to: sel.to,
            text: v.state.doc.sliceString(sel.from, sel.to),
          };
        },
        view() {
          return viewRef.current;
        },
      }),
      [],
    );

    return (
      <div
        ref={hostRef}
        className={className}
        style={{ height: '100%', width: '100%' }}
        aria-busy={!ready}
      />
    );
  },
);

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}
