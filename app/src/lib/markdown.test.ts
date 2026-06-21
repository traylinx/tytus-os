import { describe, it, expect } from 'vitest';
import { markdownToHtml } from './markdown';

describe('markdownToHtml — formatting', () => {
  it('renders headings as <h*> (not raw "###")', () => {
    const html = markdownToHtml('### Usage');
    expect(html).toContain('<h3');
    expect(html).not.toContain('### Usage');
  });

  it('renders bold and inline code', () => {
    expect(markdownToHtml('**Install**')).toContain('<strong>Install</strong>');
    expect(markdownToHtml('run `curl`')).toContain('<code');
  });

  it('renders GFM tables as <table> (not raw pipes)', () => {
    const md = '| OS | Command |\n|----|---------|\n| macOS | curl |\n';
    const html = markdownToHtml(md);
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).not.toContain('| OS | Command |');
  });

  it('renders fenced code blocks as <pre>', () => {
    expect(markdownToHtml('```bash\ncurl x\n```')).toContain('<pre');
  });
});

describe('markdownToHtml — security (LLM/untrusted content)', () => {
  it('escapes raw HTML so embedded markup cannot execute', () => {
    const html = markdownToHtml('Hello <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralizes a javascript: link to href="#"', () => {
    const html = markdownToHtml('[click](javascript:alert(1))');
    expect(html).toContain('href="#"');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('neutralizes javascript: regardless of case or whitespace obfuscation', () => {
    expect(markdownToHtml('[x](JavaScript:alert(1))')).toContain('href="#"');
    expect(markdownToHtml('[x](  javascript:alert(1))')).toContain('href="#"');
  });

  it('neutralizes data:, vbscript: and file: links', () => {
    expect(markdownToHtml('[x](data:text/html,<b>1</b>)')).toContain('href="#"');
    expect(markdownToHtml('[x](vbscript:msgbox)')).toContain('href="#"');
    expect(markdownToHtml('[x](file:///etc/passwd)')).toContain('href="#"');
  });

  it('preserves safe http(s), mailto and relative links', () => {
    expect(markdownToHtml('[x](https://get.traylinx.com)')).toContain(
      'href="https://get.traylinx.com"',
    );
    expect(markdownToHtml('[x](mailto:a@b.com)')).toContain('href="mailto:a@b.com"');
    expect(markdownToHtml('[x](/docs/page)')).toContain('href="/docs/page"');
  });

  it('encodes quotes so a URL cannot break out of the href attribute', () => {
    const html = markdownToHtml('[x](https://e.com" onmouseover="alert(1))');
    expect(html).toContain('&quot;'); // the injected quote was entity-encoded
    expect(html).not.toContain('e.com" '); // no raw breakout quote survived
  });

  it('neutralizes HTML-entity-obfuscated schemes (browser would decode them)', () => {
    // &#x6a; decodes to "j" -> "javascript:" in the browser; escaping & defeats it.
    const js = markdownToHtml('[click](&#x6a;avascript:alert(1))');
    expect(js).toContain('&amp;#x6a;'); // leading & escaped -> entity inert
    expect(js).not.toContain('&#x6a;'); // no decodable entity survives
    const data = markdownToHtml('[x](&#x64;ata:text/html,alert)');
    expect(data).toContain('&amp;#x64;');
    expect(data).not.toContain('&#x64;');
  });

  it('keeps legitimate ampersands in query strings (as &amp;)', () => {
    const html = markdownToHtml('[x](/search?a=1&b=2)');
    expect(html).toContain('href="/search?a=1&amp;b=2"');
  });
});

describe('markdownToHtml — Cortex answer rendering (br + code in tables)', () => {
  it('renders <br> as a line break instead of literal text', () => {
    const html = markdownToHtml('line one<br>line two');
    expect(html).toContain('<br />');
    expect(html).not.toContain('&lt;br&gt;');
  });

  it('accepts <br>, <br/> and <br /> in any case', () => {
    for (const v of ['a<br>b', 'a<br/>b', 'a<br />b', 'a<BR>b']) {
      expect(markdownToHtml(v)).toContain('<br />');
    }
  });

  it('does NOT split a table cell on a pipe inside inline code', () => {
    // The real screenshot bug: `irm … | iex` split the Windows cell into 3.
    const md =
      '| OS | Command |\n|----|---------|\n| Windows | `irm https://x | iex` |\n';
    const html = markdownToHtml(md);
    expect(html).toContain('<table');
    // Exactly 2 header cells and 2 body cells — the code pipe must not add a 3rd.
    expect((html.match(/<th /g) ?? []).length).toBe(2);
    expect((html.match(/<td /g) ?? []).length).toBe(2);
    // The pipe survives inside the rendered <code>, not as a cell boundary.
    expect(html).toContain('irm https://x | iex');
    expect(html).toContain('<code');
  });

  it('renders the install-style answer table: code cells + <br>, no raw leaks', () => {
    const md =
      '| OS | Command |\n' +
      '|----|---------|\n' +
      '| macOS / Linux | `curl -fsSL https://get.traylinx.com/install.sh`<br>Then `tytus setup` |\n' +
      '| Windows | `irm https://get.traylinx.com/install.ps1 | iex`<br>(zip fallback) |\n';
    const html = markdownToHtml(md);
    expect(html).toContain('<table');
    expect((html.match(/<th /g) ?? []).length).toBe(2); // OS | Command
    expect((html.match(/<td /g) ?? []).length).toBe(4); // 2 rows x 2 cells
    expect(html).not.toContain('&lt;br&gt;'); // no literal <br>
    expect(html).toContain('<br />'); // real line breaks in the cells
    expect(html).toContain('<code'); // commands shown as code
    expect(html).toContain('| iex'); // windows pipe preserved inside code
  });

  it('keeps a literal <br> inside inline code escaped (it is code, not a break)', () => {
    const html = markdownToHtml('`a<br>b`');
    expect(html).toContain('<code');
    expect(html).toContain('a&lt;br&gt;b');
    expect(html).not.toContain('<br />');
  });

  it('keeps a literal <br> inside a fenced code block (no line break)', () => {
    const html = markdownToHtml('```html\n<br>\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('&lt;br&gt;'); // literal, escaped — still code text
    expect(html).not.toContain('<br />'); // not rewritten to a line break
  });

  it('does not run markdown passes inside a fenced code block', () => {
    const html = markdownToHtml('```md\n**x** | [y](z) | # h\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('**x**'); // bold not applied inside code
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<table'); // pipes not turned into a table
  });

  it('shields markdown metacharacters inside inline code from being parsed', () => {
    const html = markdownToHtml('`a**b**c`');
    expect(html).toContain('a**b**c'); // literal, not bolded
    expect(html).not.toContain('<strong>');
  });

  it('cannot be spoofed by a NUL/placeholder-looking input', () => {
    // Input NULs are stripped first, so a forged sentinel can never index our
    // array (no out-of-bounds, no injected <code>).
    const NUL = String.fromCharCode(0);
    const html = markdownToHtml(`plain ${NUL}C0${NUL} text`);
    expect(html).toContain('plain');
    expect(html).toContain('text');
    expect(html).not.toContain('<code'); // no inline code was ever created
  });
});
