// ============================================================
// Markdown → HTML renderer (GitHub-flavored, inline-styled)
// ============================================================
//
// Single-file pure function so it can be used by any app that needs
// to render markdown without pulling in a markdown library. Used by:
//   - apps/MarkdownPreview.tsx (live editor preview)
//   - apps/Help.tsx (bundled user-manual viewer)
//
// All styling is inline so the output drops into any component
// without a separate stylesheet. Theme tokens come from CSS vars
// (var(--text-primary), var(--accent-primary), etc.) so the output
// follows the active dark/light theme automatically.

// Neutralize a URL before it reaches an href/src attribute. markdownToHtml
// escapes < and >, so a markdown link/image is the only injection surface left
// — and it matters now that LLM-generated answers (Help "Ask Tytus Docs"), not
// just trusted bundled docs, are rendered through this function. Blocks
// script-bearing schemes (javascript:, data:, …) and percent-encodes quotes so
// the URL can't break out of the double-quoted attribute. Ordinary http(s),
// mailto and relative URLs pass through unchanged.
function safeUrl(raw: string, allowDataImage = false): string {
  // Strip control chars + whitespace the browser would ignore, to defeat
  // obfuscation like "java\tscript:".
  const probe = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (
    !(allowDataImage && probe.startsWith('data:image/')) &&
    /^(javascript|vbscript|data|file):/.test(probe)
  ) {
    return '#';
  }
  // HTML-attribute-escape the value. Escaping `&` FIRST is what defeats
  // entity-obfuscated payloads: the browser decodes attribute entities, so a URL
  // like "&#x6a;avascript:…" would otherwise decode back to "javascript:…" after
  // it passed the literal-scheme check above. With `&`→`&amp;`, every entity is
  // neutralized (and quotes can't break out of the double-quoted attribute).
  return raw
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML
  html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang: string, code) => {
    return `<pre style="background:var(--bg-code);padding:16px;border-radius:8px;overflow:auto;margin:12px 0"><code style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text-primary)">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(124,77,255,0.1);padding:2px 6px;border-radius:4px;font-family:\'JetBrains Mono\',monospace;font-size:12px">$1</code>');

  // Headings
  html = html.replace(/^###### (.*$)/gim, '<h6 style="font-size:13px;font-weight:600;margin:12px 0;color:var(--text-primary)">$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5 style="font-size:14px;font-weight:600;margin:12px 0;color:var(--text-primary)">$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4 style="font-size:16px;font-weight:600;margin:14px 0;color:var(--text-primary)">$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size:20px;font-weight:600;margin:16px 0;color:var(--text-primary)">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size:24px;font-weight:600;margin:20px 0;padding-bottom:8px;border-bottom:1px solid var(--border-default);color:var(--text-primary)">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size:32px;font-weight:700;margin:24px 0;padding-bottom:8px;border-bottom:2px solid var(--border-default);color:var(--text-primary)">$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links (href scheme- and quote-guarded for untrusted/LLM content)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${safeUrl(url)}" style="color:var(--accent-primary);text-decoration:none" target="_blank" rel="noopener">${text}</a>`,
  );

  // Images (src guarded; alt quote-escaped so it can't break out of the attr)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, url: string) =>
      `<img src="${safeUrl(url, true)}" alt="${alt.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="max-width:100%;border-radius:8px;margin:12px 0" />`,
  );

  // Blockquotes
  html = html.replace(/^&gt; (.*$)/gim, '<blockquote style="border-left:4px solid var(--accent-primary);padding-left:16px;margin:12px 0;color:var(--text-secondary)">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---+$/gim, '<hr style="border:none;border-top:1px solid var(--border-default);margin:24px 0" />');
  html = html.replace(/^\*\*\*+$/gim, '<hr style="border:none;border-top:1px solid var(--border-default);margin:24px 0" />');

  // Task lists
  html = html.replace(/^- \[x\] (.*$)/gim, '<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="color:var(--accent-success)">&#9745;</span><span>$1</span></div>');
  html = html.replace(/^- \[ \] (.*$)/gim, '<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span>&#9744;</span><span>$1</span></div>');

  // Ordered lists
  html = html.replace(/^(\d+\.\s.*(?:\n\d+\.\s.*)*)/gm, (block) => {
    const items = block.split('\n').map((line: string) =>
      `<li style="margin:4px 0">${line.replace(/^\d+\.\s/, '')}</li>`
    ).join('');
    return `<ol style="padding-left:24px;margin:12px 0">${items}</ol>`;
  });

  // Unordered lists
  html = html.replace(/^([-*]\s.*(?:\n[-*]\s.*)*)/gm, (block) => {
    const items = block.split('\n').map((line: string) =>
      `<li style="margin:4px 0">${line.replace(/^[-*]\s/, '')}</li>`
    ).join('');
    return `<ul style="padding-left:24px;margin:12px 0">${items}</ul>`;
  });

  // Tables
  html = html.replace(/\|(.+)\|\n\|[-:\|\s]+\|\n((?:\|.+\|\n?)+)/g, (_, header, rows) => {
    const headers = header.split('|').filter(Boolean).map((h: string) => `<th style="padding:8px 12px;background:var(--bg-titlebar);font-weight:600;font-size:13px;border:1px solid var(--border-default)">${h.trim()}</th>`).join('');
    const bodyRows = rows.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter(Boolean).map((c: string, i: number) =>
        `<td style="padding:8px 12px;border:1px solid var(--border-default);font-size:13px;background:${i % 2 === 0 ? 'transparent' : 'var(--bg-hover)'};color:var(--text-primary)">${c.trim()}</td>`
      ).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table style="border-collapse:collapse;margin:16px 0;width:100%;border:1px solid var(--border-default)"><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  });

  // Paragraphs (remaining lines)
  html = html.replace(/^(?!<[a-z])(.+)$/gim, '<p style="line-height:1.6;margin:12px 0;color:var(--text-primary)">$1</p>');

  // Fix multiple breaks
  html = html.replace(/\n+/g, '\n');

  return html;
}
