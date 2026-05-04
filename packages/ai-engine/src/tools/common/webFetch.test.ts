import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyUrl,
  isAllowedContentType,
  isPrivateIPv4,
  isPrivateIPv6,
  webFetchTool,
} from './webFetch';
import type { HostClient } from '@tytus/host-api';

const fakeHost = {} as HostClient;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isPrivateIPv4', () => {
  it('blocks every spec-listed range', () => {
    for (const ip of [
      '0.0.0.1',
      '10.5.5.5',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.5',
    ]) {
      expect(isPrivateIPv4(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.190.46']) {
      expect(isPrivateIPv4(ip), ip).toBe(false);
    }
  });

  it('blocks malformed addresses (fail closed)', () => {
    expect(isPrivateIPv4('not-an-ip')).toBe(true);
    expect(isPrivateIPv4('999.999.999.999')).toBe(true);
  });
});

describe('isPrivateIPv6', () => {
  it('blocks ::1, ULA, link-local', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('fc00::1')).toBe(true);
    expect(isPrivateIPv6('fd12:3456::1')).toBe(true);
    expect(isPrivateIPv6('fe80::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 addresses pointing at private v4', () => {
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true);
  });

  it('allows public IPv6', () => {
    expect(isPrivateIPv6('2001:db8::1')).toBe(false);
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false);
  });
});

describe('classifyUrl', () => {
  it('rejects non-http(s) schemes', () => {
    expect(classifyUrl('file:///etc/passwd').ok).toBe(false);
    expect(classifyUrl('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects localhost / *.local / *.internal', () => {
    for (const u of [
      'http://localhost/foo',
      'http://api.local/foo',
      'http://corp.internal/foo',
    ]) {
      expect(classifyUrl(u).ok, u).toBe(false);
    }
  });

  it('rejects URLs with private IP literals', () => {
    expect(classifyUrl('http://10.0.0.5/').ok).toBe(false);
    expect(classifyUrl('http://[::1]/').ok).toBe(false);
  });

  it('honors hostnameAllowList', () => {
    expect(classifyUrl('http://localhost/x', ['localhost']).ok).toBe(true);
  });

  it('accepts public hostnames', () => {
    const r = classifyUrl('https://example.com/path');
    expect(r.ok).toBe(true);
  });

  it('returns the parsed URL on accept', () => {
    const r = classifyUrl('https://example.com/?a=1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.hostname).toBe('example.com');
  });
});

describe('isAllowedContentType', () => {
  it('accepts every default-allowed family', () => {
    expect(isAllowedContentType('text/html; charset=utf-8')).toBe(true);
    expect(isAllowedContentType('application/json')).toBe(true);
    expect(isAllowedContentType('application/xml')).toBe(true);
    expect(isAllowedContentType('application/ld+json')).toBe(true);
  });

  it('rejects unknown media types', () => {
    expect(isAllowedContentType('image/png')).toBe(false);
    expect(isAllowedContentType('application/octet-stream')).toBe(false);
  });

  it('honors the extra allow-list', () => {
    expect(
      isAllowedContentType('image/png', ['image/png']),
    ).toBe(true);
  });
});

describe('webFetchTool — runtime', () => {
  it('rejects without an approval callback', async () => {
    const tool = webFetchTool(fakeHost);
    await expect(
      tool.execute({ url: 'https://example.com' }, {
        sessionId: 's',
        appId: 'studio',
        approvalAlreadyGranted: false,
      }),
    ).rejects.toThrow(/declined/);
  });

  it('rejects private URLs even when approved', async () => {
    const tool = webFetchTool(fakeHost, {
      requestApproval: async () => true,
    });
    await expect(
      tool.execute({ url: 'http://10.0.0.5/x' }, {
        sessionId: 's',
        appId: 'studio',
        approvalAlreadyGranted: false,
      }),
    ).rejects.toThrow(/private IPv4/);
  });

  it('fetches an allowed public URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const onFetch = vi.fn();
    const tool = webFetchTool(fakeHost, {
      requestApproval: async () => true,
      onFetch,
    });
    const r = (await tool.execute({ url: 'https://example.com/x' }, {
      sessionId: 's',
      appId: 'studio',
      approvalAlreadyGranted: false,
    })) as { status: number; text: string; truncated: boolean };
    expect(fetchSpy).toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(r.text).toContain('"ok":true');
    expect(r.truncated).toBe(false);
    expect(onFetch).toHaveBeenCalled();
  });

  it('rejects disallowed content types', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ArrayBuffer(8), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    const tool = webFetchTool(fakeHost, {
      requestApproval: async () => true,
    });
    await expect(
      tool.execute({ url: 'https://example.com/img' }, {
        sessionId: 's',
        appId: 'studio',
        approvalAlreadyGranted: false,
      }),
    ).rejects.toThrow(/disallowed content-type/);
  });

  it('truncates bodies past the 256 KB cap', async () => {
    const big = 'x'.repeat(300 * 1024);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(big, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const tool = webFetchTool(fakeHost, {
      requestApproval: async () => true,
    });
    const r = (await tool.execute({ url: 'https://example.com/big' }, {
      sessionId: 's',
      appId: 'studio',
      approvalAlreadyGranted: false,
    })) as { truncated: boolean; sizeBytes: number };
    expect(r.truncated).toBe(true);
    expect(r.sizeBytes).toBe(256 * 1024);
  });

  it('returns metadata-only for HEAD requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const tool = webFetchTool(fakeHost, {
      requestApproval: async () => true,
    });
    const r = (await tool.execute(
      { url: 'https://example.com/page', method: 'HEAD' },
      {
        sessionId: 's',
        appId: 'studio',
        approvalAlreadyGranted: false,
      },
    )) as { status: number; headers: Record<string, string> };
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html');
  });
});
