import type * as Monaco from 'monaco-editor';

export function registerTytusMonacoTheme(monaco: typeof Monaco): void {
  monaco.editor.defineTheme('tytus-vscode-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'keyword', foreground: '569cd6' },
      { token: 'number', foreground: 'b5cea8' },
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#2a2734',
      'editorCursor.foreground': '#aeafad',
      'editorLineNumber.foreground': '#858585',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#3a3d41',
    },
  });
}
