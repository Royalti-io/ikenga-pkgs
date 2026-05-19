import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * CodeMirror 6 theme bridged to @ikenga/tokens.
 *
 * All colors reference CSS custom properties so the editor restyles itself
 * automatically when the host toggles `data-mode` on `<html>` — no JS
 * re-dispatch, no remount.
 *
 * Fallbacks (the second arg to `var()`) keep the editor looking sane when a
 * consumer hasn't upgraded to a tokens version that ships the syntax palette.
 */

const chrome = EditorView.theme(
  {
    '&': {
      color: 'var(--fg)',
      backgroundColor: 'var(--bg-surface)',
      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
      fontSize: '12px',
      height: '100%',
    },
    '.cm-content': {
      caretColor: 'var(--primary, hsl(220, 90%, 60%))',
      padding: '8px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--primary, hsl(220, 90%, 60%))',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'var(--primary-soft, hsla(220, 90%, 60%, 0.25))',
      },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-sunken, var(--bg-base))',
      color: 'var(--fg-muted)',
      borderRight: '1px solid var(--border-soft)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--bg-raised)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bg-raised)',
      color: 'var(--fg)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 6px 0 8px',
      minWidth: '20px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--fg-subtle, var(--fg-muted))',
    },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'var(--primary-soft, hsla(220, 90%, 60%, 0.2))',
      outline: 'none',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-raised)',
      color: 'var(--fg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm, 4px)',
      boxShadow: 'var(--shadow-2)',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--primary-soft, var(--bg-surface))',
      color: 'var(--fg)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--bg-raised)',
      color: 'var(--fg)',
      borderTop: '1px solid var(--border-soft)',
      borderBottom: '1px solid var(--border-soft)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--warning, hsla(38, 92%, 60%, 0.4))',
      color: 'inherit',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--primary, hsl(220, 90%, 60%))',
      color: 'var(--primary-fg, white)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    },
  },
  // dark by default; the actual chroma comes from CSS variables that flip on
  // `[data-mode='light']` so light surfaces inherit the lighter palette.
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syntax-keyword, hsl(280, 70%, 70%))' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: 'var(--syntax-atom, hsl(28, 70%, 60%))' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syntax-string, hsl(160, 60%, 60%))' },
  { tag: t.regexp, color: 'var(--syntax-regexp, hsl(330, 60%, 64%))' },
  { tag: [t.number, t.special(t.number)], color: 'var(--syntax-number, hsl(28, 70%, 60%))' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syntax-comment, var(--fg-muted))', fontStyle: 'italic' },
  { tag: [t.operator, t.derefOperator], color: 'var(--syntax-operator, var(--fg))' },
  { tag: [t.punctuation, t.bracket], color: 'var(--syntax-punctuation, var(--fg-muted))' },
  { tag: [t.variableName, t.propertyName], color: 'var(--syntax-variable, var(--fg))' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syntax-function, hsl(200, 80%, 65%))' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syntax-type, hsl(180, 60%, 64%))' },
  { tag: [t.tagName, t.standard(t.tagName)], color: 'var(--syntax-tag, hsl(0, 70%, 64%))' },
  { tag: [t.attributeName], color: 'var(--syntax-attribute, hsl(40, 80%, 64%))' },
  { tag: [t.attributeValue], color: 'var(--syntax-string, hsl(160, 60%, 60%))' },
  { tag: [t.heading, t.strong], color: 'var(--syntax-heading, var(--fg))', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--syntax-link, var(--primary))', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--danger, hsl(0, 72%, 60%))' },
]);

export function tokensTheme(): Extension {
  return [chrome, syntaxHighlighting(highlight, { fallback: true })];
}
