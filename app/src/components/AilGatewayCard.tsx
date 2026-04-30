// ============================================================
// AIL LLM Gateway card — TytusOS port of Tower's "Always
// Included" panel. Surfaces the included AIL pod as the
// product's default LLM endpoint with full copy-config /
// snippet / open-in affordances.
// ============================================================

import type { FC } from 'react';
import { useCallback, useState } from 'react';
import {
  ChevronDown, Copy, ExternalLink, Eye, EyeOff,
  FlaskConical, Info, Sparkles, Terminal,
} from 'lucide-react';
import type { IncludedPod } from '@/types/daemon';
import { revealSecret } from '@/lib/secrets';
import type { DaemonClient } from '@/lib/daemon';

interface AilGatewayCardProps {
  included: IncludedPod;
  client: DaemonClient;
  onErr: (msg: string) => void;
  onOpenApiTester?: () => void;
  /** Open the in-OS Terminal app with `tytus llm-docs` preloaded so the
   * user can read the full AIL reference and then chat about it. */
  onOpenTerminalDocs?: () => void;
  /** Open the in-OS Terminal app with an interactive `tytus chat` so the
   * user can ask anything about AIL. */
  onOpenTerminalChat?: () => void;
}

// Snippet builders. Tower's COPY_VARIANTS, plus per-CLI shell exports
// users actually paste into Cursor/Claude Code/etc. Keep formatters
// pure — easy to unit-test if we add tests later.
type SnippetBuilder = (url: string, key: string) => string;

const FORMATS: Array<{ id: string; label: string; build: SnippetBuilder }> = [
  {
    id: 'openai',
    label: 'Shell exports (OpenAI)',
    build: (url, key) =>
      `export OPENAI_BASE_URL="${url}"\n` +
      `export OPENAI_API_KEY="${key}"\n` +
      `export OPENAI_API_BASE="${url}"`,
  },
  {
    id: 'anthropic',
    label: 'Shell exports (Anthropic)',
    build: (url, key) => {
      const origin = url.replace(/\/v1\/?$/, '');
      return (
        `export ANTHROPIC_API_KEY="${key}"\n` +
        `export ANTHROPIC_BASE_URL="${origin}"`
      );
    },
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    build: (url, key) => {
      const origin = url.replace(/\/v1\/?$/, '');
      return (
        `# Add to ~/.zshrc or run before launching Claude Code\n` +
        `export ANTHROPIC_BASE_URL="${origin}"\n` +
        `export ANTHROPIC_API_KEY="${key}"`
      );
    },
  },
  {
    id: 'cursor',
    label: 'Cursor (OpenAI override)',
    build: (url, key) =>
      `# Cursor → Settings → Models → OpenAI API key\n` +
      `OPENAI_BASE_URL=${url}\n` +
      `OPENAI_API_KEY=${key}`,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    build: (url, key) =>
      `# OpenCode reads OPENAI_BASE_URL + OPENAI_API_KEY at startup\n` +
      `export OPENAI_BASE_URL="${url}"\n` +
      `export OPENAI_API_KEY="${key}"`,
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    build: (url, key) =>
      `# gemini cli routes through OpenAI-compatible gateways\n` +
      `export GEMINI_API_KEY="${key}"\n` +
      `export GEMINI_BASE_URL="${url}"`,
  },
  {
    id: 'codex',
    label: 'Codex / aider',
    build: (url, key) =>
      `# aider --openai-api-base=$OPENAI_BASE_URL\n` +
      `export OPENAI_API_BASE="${url}"\n` +
      `export OPENAI_API_KEY="${key}"`,
  },
  {
    id: 'json',
    label: 'JSON ({url, api_key})',
    build: (url, key) => JSON.stringify({ url, api_key: key }, null, 2),
  },
  { id: 'urlOnly', label: 'URL only', build: (url) => url },
  { id: 'keyOnly', label: 'API key only', build: (_u, key) => key },
];

const AilGatewayCard: FC<AilGatewayCardProps> = ({
  included,
  client,
  onErr,
  onOpenApiTester,
  onOpenTerminalDocs,
  onOpenTerminalChat,
}) => {
  const endpointV1 = `${included.endpoint}/v1`;
  const publicApi = included.public_url ? `${included.public_url}/v1` : null;
  const apiKey = revealSecret(included.user_key, 'user_gesture');

  const [flash, setFlash] = useState<string | null>(null);
  const [showFormats, setShowFormats] = useState(false);
  const [showOpenIn, setShowOpenIn] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);

  const flashOk = useCallback((label: string) => {
    setFlash(label);
    window.setTimeout(
      () => setFlash((c) => (c === label ? null : c)),
      1200,
    );
  }, []);

  const copy = useCallback(
    async (label: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        flashOk(label);
      } catch {
        onErr(`Copy failed (${label}). Browser clipboard blocked?`);
      }
    },
    [flashOk, onErr],
  );

  const envSnippet =
    `export OPENAI_BASE_URL="${endpointV1}"\n` +
    `export OPENAI_API_KEY="${apiKey}"`;

  // The preferred URL for snippets — public when available (works from
  // any network), private WG endpoint as fallback. Mirrors Tower.
  const preferredUrl = publicApi ?? endpointV1;

  // Fall back to spawning the OS terminal if the parent didn't wire an
  // in-OS Terminal opener. The in-OS path is preferred because it can
  // preload `tytus llm-docs` / `tytus chat` and the user never has to
  // leave the desktop.
  const launchTerminal = useCallback(async () => {
    setShowOpenIn(false);
    const r = await client.postLaunch('terminal');
    if (!r.ok) onErr(`Open Terminal failed: ${r.error.message}`);
  }, [client, onErr]);

  return (
    <div
      className="mx-5 mt-4 mb-2 rounded-xl p-5 flex flex-col gap-4"
      style={{
        background: 'var(--bg-card, rgba(255,255,255,0.03))',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3.5">
        <div
          className="flex-shrink-0 w-11 h-11 rounded-md flex items-center justify-center"
          style={{
            background: 'rgba(124,77,255,0.12)',
            border: '1px solid rgba(124,77,255,0.20)',
          }}
        >
          <Sparkles size={20} style={{ color: '#D6C8FF' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[16px] font-bold tracking-tight text-[var(--text-primary)]">
              AIL LLM Gateway
            </span>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
              style={{
                background: 'rgba(76,175,80,0.12)',
                color: '#A5D6A7',
              }}
            >
              Included
            </span>
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-1 leading-snug">
            OpenAI-compatible · paste into Cursor, Claude Code, or any SDK ·
            free, doesn't count against units
          </div>
        </div>
      </div>

      {/* URLs */}
      <div className="flex flex-col gap-2">
        <UrlRow
          label="Private (WireGuard)"
          value={endpointV1}
          onCopy={() => copy('private', endpointV1)}
          flashed={flash === 'private'}
        />
        {publicApi && (
          <UrlRow
            label="Public"
            value={publicApi}
            onCopy={() => copy('public', publicApi)}
            flashed={flash === 'public'}
          />
        )}
        <KeyRow
          value={apiKey}
          visible={keyVisible}
          onToggle={() => setKeyVisible((v) => !v)}
          onCopy={() => copy('key', apiKey)}
          flashed={flash === 'key'}
        />
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => copy('env', envSnippet)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-colors"
          style={{ background: 'var(--accent-primary)' }}
        >
          <Copy size={12} />
          {flash === 'env' ? 'Copied!' : 'Copy env'}
        </button>

        {/* More formats dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowFormats((v) => !v);
              setShowOpenIn(false);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: 'var(--bg-hover, rgba(255,255,255,0.04))',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            <Copy size={12} />
            More formats
            <ChevronDown
              size={12}
              style={{
                transform: showFormats ? 'rotate(180deg)' : undefined,
                transition: 'transform 120ms',
              }}
            />
          </button>
          {showFormats && (
            <div
              className="absolute left-0 top-full mt-1 z-10 min-w-[240px] rounded-md py-1 shadow-lg"
              style={{
                background: 'var(--bg-elevated, #1f1f23)',
                border: '1px solid var(--border-default)',
              }}
            >
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    void copy(f.id, f.build(preferredUrl, apiKey));
                    setShowFormats(false);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.04))] transition-colors"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Open in dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowOpenIn((v) => !v);
              setShowFormats(false);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: 'var(--bg-hover, rgba(255,255,255,0.04))',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            <ExternalLink size={12} />
            Open in
            <ChevronDown
              size={12}
              style={{
                transform: showOpenIn ? 'rotate(180deg)' : undefined,
                transition: 'transform 120ms',
              }}
            />
          </button>
          {showOpenIn && (
            <div
              className="absolute left-0 top-full mt-1 z-10 min-w-[200px] rounded-md py-1 shadow-lg"
              style={{
                background: 'var(--bg-elevated, #1f1f23)',
                border: '1px solid var(--border-default)',
              }}
            >
              {onOpenTerminalDocs && (
                <button
                  onClick={() => {
                    setShowOpenIn(false);
                    onOpenTerminalDocs();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.04))] transition-colors"
                >
                  <Terminal size={12} />
                  Terminal — load AIL docs
                </button>
              )}
              {onOpenTerminalChat && (
                <button
                  onClick={() => {
                    setShowOpenIn(false);
                    onOpenTerminalChat();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.04))] transition-colors"
                >
                  <Terminal size={12} />
                  Terminal — chat with AIL
                </button>
              )}
              <button
                onClick={launchTerminal}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.04))] transition-colors"
              >
                <Terminal size={12} />
                System Terminal (with env)
              </button>
              {onOpenApiTester && (
                <button
                  onClick={() => {
                    setShowOpenIn(false);
                    onOpenApiTester();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.04))] transition-colors"
                >
                  <FlaskConical size={12} />
                  API Tester (preset collection)
                </button>
              )}
              <a
                href="https://github.com/traylinx/tytus-cli#connect-from-claude-cursor-opencode"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowOpenIn(false)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.04))] transition-colors no-underline"
              >
                <Info size={12} />
                Paste-into-AI guide ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const UrlRow: FC<{
  label: string;
  value: string;
  onCopy: () => void;
  flashed: boolean;
}> = ({ label, value, onCopy, flashed }) => (
  <div className="flex items-center gap-2">
    <span
      className="text-[10px] uppercase tracking-wider w-32 flex-shrink-0"
      style={{ color: 'var(--text-secondary)' }}
    >
      {label}
    </span>
    <code
      className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md font-mono truncate"
      style={{
        background: 'var(--bg-input, rgba(0,0,0,0.30))',
        border: '1px solid var(--border-default)',
        color: 'var(--text-primary)',
      }}
      title={value}
    >
      {value}
    </code>
    <button
      onClick={onCopy}
      aria-label={`Copy ${label} URL`}
      className="flex-shrink-0 p-1.5 rounded-md transition-colors"
      style={{
        background: 'var(--bg-hover, rgba(255,255,255,0.04))',
        border: '1px solid var(--border-default)',
        color: flashed ? '#A5D6A7' : 'var(--text-secondary)',
      }}
    >
      <Copy size={11} />
    </button>
  </div>
);

const KeyRow: FC<{
  value: string;
  visible: boolean;
  onToggle: () => void;
  onCopy: () => void;
  flashed: boolean;
}> = ({ value, visible, onToggle, onCopy, flashed }) => (
  <div className="flex items-center gap-2">
    <span
      className="text-[10px] uppercase tracking-wider w-32 flex-shrink-0"
      style={{ color: 'var(--text-secondary)' }}
    >
      API Key
    </span>
    <code
      className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md font-mono truncate"
      style={{
        background: 'var(--bg-input, rgba(0,0,0,0.30))',
        border: '1px solid var(--border-default)',
        color: 'var(--text-primary)',
      }}
      title={visible ? value : undefined}
    >
      {visible ? value : '•'.repeat(Math.min(value.length, 32))}
    </code>
    <button
      onClick={onToggle}
      aria-label={visible ? 'Hide API key' : 'Reveal API key'}
      className="flex-shrink-0 p-1.5 rounded-md transition-colors"
      style={{
        background: 'var(--bg-hover, rgba(255,255,255,0.04))',
        border: '1px solid var(--border-default)',
        color: 'var(--text-secondary)',
      }}
    >
      {visible ? <EyeOff size={11} /> : <Eye size={11} />}
    </button>
    <button
      onClick={onCopy}
      aria-label="Copy API key"
      className="flex-shrink-0 p-1.5 rounded-md transition-colors"
      style={{
        background: 'var(--bg-hover, rgba(255,255,255,0.04))',
        border: '1px solid var(--border-default)',
        color: flashed ? '#A5D6A7' : 'var(--text-secondary)',
      }}
    >
      <Copy size={11} />
    </button>
  </div>
);

export default AilGatewayCard;
