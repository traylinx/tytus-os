import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ForgeCard, ForgeCardKind } from '../repo/forgeRepo';

export function ArtifactEditor({ card, onChange }: { card: ForgeCard; onChange: (content: string) => void }) {
  const [fallback, setFallback] = useState(false);
  const monacoRef = useRef<MonacoApi | null>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (!host || editorRef.current || fallback) return undefined;

    void loadMonaco()
      .then((monaco) => {
        if (disposed || !host) return;
        monacoRef.current = monaco;
        const editor = monaco.editor.create(host, {
          value: card.content,
          language: languageForKind(card.kind),
          theme: 'tytus-forge-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 13,
          lineHeight: 20,
          fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          padding: { top: 10, bottom: 10 },
          overviewRulerLanes: 0,
          renderLineHighlight: 'line',
          lineNumbersMinChars: 3,
          tabSize: 2,
          folding: false,
          glyphMargin: false,
        });
        editorRef.current = editor;
        const changeSub = editor.onDidChangeModelContent(() => {
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => {
            onChangeRef.current(editor.getValue());
          }, 260);
        });
        editor.onDidDispose(() => changeSub.dispose());
      })
      .catch((err: unknown) => {
        console.warn('Forge Monaco editor failed; falling back to textarea.', err);
        if (!disposed) setFallback(true);
      });

    return () => {
      disposed = true;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      editorRef.current?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, [fallback, card.id]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (editor.getValue() !== card.content) {
      const selection = editor.getSelection();
      editor.setValue(card.content);
      if (selection) editor.setSelection(selection);
    }
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, languageForKind(card.kind));
  }, [card.content, card.id, card.kind]);

  if (fallback) {
    const lineCount = Math.max(1, card.content.split(/\r?\n/).length);
    return (
      <div style={editorStyles.editorShell}>
        <div style={editorStyles.lineNumbers} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => <span key={i}>{i + 1}</span>)}
        </div>
        <textarea
          value={card.content}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={card.kind !== 'code' && card.kind !== 'json'}
          style={{ ...editorStyles.editorTextarea, fontFamily: card.kind === 'code' || card.kind === 'json' ? 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' : 'inherit' }}
        />
      </div>
    );
  }

  return (
    <div style={editorStyles.monacoFrame}>
      <div ref={hostRef} style={editorStyles.monacoHost} />
    </div>
  );
}

type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api.js');
type MonacoEditorInstance = import('monaco-editor/esm/vs/editor/editor.api.js').editor.IStandaloneCodeEditor;
type WorkerModule = { default: new () => Worker };

let monacoPromise: Promise<MonacoApi> | null = null;

function loadMonaco(): Promise<MonacoApi> {
  monacoPromise ??= (async () => {
    const [monacoModule, editorWorker] = await Promise.all([
      import('monaco-editor/esm/vs/editor/editor.api.js'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker') as Promise<WorkerModule>,
      import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'),
      import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js'),
      import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'),
      import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
      import('monaco-editor/esm/vs/basic-languages/html/html.contribution.js'),
      import('monaco-editor/esm/vs/basic-languages/css/css.contribution.js'),
    ]);
    const monaco = monacoModule;

    (globalThis as typeof globalThis & {
      MonacoEnvironment?: { getWorker: (_: unknown, label: string) => Worker };
    }).MonacoEnvironment = {
      getWorker: () => {
        return new editorWorker.default();
      },
    };

    monaco.editor.defineTheme('tytus-forge-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '7b8496' },
        { token: 'keyword', foreground: 'a78bfa' },
        { token: 'string', foreground: '86efac' },
        { token: 'number', foreground: 'fbbf24' },
      ],
      colors: {
        'editor.background': '#151517',
        'editor.foreground': '#d6d3dc',
        'editorLineNumber.foreground': '#6f6a7a',
        'editorCursor.foreground': '#7c4dff',
        'editor.lineHighlightBackground': '#24212b',
        'editor.selectionBackground': '#7c4dff55',
        'editor.inactiveSelectionBackground': '#7c4dff24',
        'editorIndentGuide.background1': '#302b38',
        'editorIndentGuide.activeBackground1': '#7c4dff',
      },
    });

    return monaco;
  })();
  return monacoPromise;
}

function languageForKind(kind: ForgeCardKind): string {
  if (kind === 'json') return 'json';
  if (kind === 'code') return 'typescript';
  if (kind === 'table') return 'csv';
  if (kind === 'markdown' || kind === 'output') return 'markdown';
  return 'plaintext';
}

const editorStyles: Record<string, CSSProperties> = {
  editorShell: { minHeight: 0, display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', background: 'var(--bg-window)' },
  monacoFrame: { minHeight: 0, height: '100%', background: '#151517', overflow: 'hidden' },
  monacoHost: { width: '100%', height: '100%', minHeight: 260 },
  lineNumbers: { padding: '10px 8px', display: 'grid', alignContent: 'start', gap: 0, color: 'var(--text-secondary)', opacity: 0.55, fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 12, lineHeight: 1.55, textAlign: 'right', borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: 'var(--border-subtle)', userSelect: 'none' },
  editorTextarea: { width: '100%', height: '100%', minHeight: 260, resize: 'none', borderWidth: 0, borderStyle: 'none', outline: 'none', padding: 10, background: 'transparent', color: 'var(--text-primary)', font: 'inherit', fontSize: 13, lineHeight: 1.55 },
};
