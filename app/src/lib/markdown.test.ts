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
