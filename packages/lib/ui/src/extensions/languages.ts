import type { Extension } from '@codemirror/state';
import type { Language } from '../types.js';

export async function loadLanguage(lang: Language): Promise<Extension> {
  switch (lang) {
    case 'html': {
      const { html } = await import('@codemirror/lang-html');
      return html({ matchClosingTags: true, autoCloseTags: true });
    }
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({ jsx: true, typescript: true });
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css');
      return css();
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json');
      return json();
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown');
      return markdown();
    }
  }
}
