// ============================================================
// Juli3ta in-app help — slide-in panel with manual + use cases.
// ============================================================
//
// Triggered from the Music Creator header. Three tabs:
//
//   1. Start   — quick-start steps for the first song.
//   2. Recipes — copy-paste prompts ("write a cumbia about...").
//   3. Help    — troubleshooting + endpoint resolution explainer.
//
// Strings live in i18n (en + es) so the help content tracks the
// user's locale.

import { useState } from 'react';
import {
  X, Sparkles, Wand2, Mic, Disc3, AlertCircle, ChevronRight, Copy, Check,
} from 'lucide-react';
import { useI18n } from '@/i18n';

type Tab = 'start' | 'recipes' | 'help';

interface Recipe {
  id: string;
  emoji: string;
  title: string;
  theme: string;
  style: string;
}

const RECIPES_EN: Recipe[] = [
  {
    id: 'birthday',
    emoji: '🎂',
    title: 'Birthday song for someone special',
    theme: "Happy birthday song for Julieta — celebrating her sparkle, her laugh, and another year of adventures. Warm, joyful, family-album feel.",
    style: 'pop, upbeat, acoustic guitar, hand claps, joyful, family-friendly',
  },
  {
    id: 'lullaby',
    emoji: '🌙',
    title: 'Lullaby to fall asleep',
    theme: "A gentle lullaby about stars watching over a sleepy child, soft dreams floating on a quiet night.",
    style: 'lullaby, soft piano, music box, slow tempo, calm, dreamy',
  },
  {
    id: 'roadtrip',
    emoji: '🚗',
    title: 'Road-trip anthem',
    theme: "An anthem about driving down the coast with the windows open, friends in the back, sun setting over the ocean.",
    style: 'indie pop, driving rhythm, electric guitar, summer, optimistic',
  },
  {
    id: 'study',
    emoji: '📚',
    title: 'Study / focus background',
    theme: "Calm music for focusing on homework. No distractions, just a steady warm vibe.",
    style: 'lo-fi, instrumental, soft piano, light beat, ambient, relaxed',
  },
  {
    id: 'silly',
    emoji: '🤪',
    title: 'Silly song about pets',
    theme: "A funny song about a cat who thinks he's the boss of the house, knocks things off tables, and demands snacks at 3am.",
    style: 'comedic, ukulele, jaunty, kids-friendly, lighthearted',
  },
  {
    id: 'cumbia',
    emoji: '💃',
    title: 'Cumbia para bailar',
    theme: "Una cumbia alegre sobre una fiesta familiar al atardecer, primos bailando en el patio, risas que no paran.",
    style: 'cumbia, accordion, percussion, festive, danceable, latin',
  },
];

const RECIPES_ES: Recipe[] = [
  {
    id: 'birthday',
    emoji: '🎂',
    title: 'Canción de cumpleaños',
    theme: "Canción de cumpleaños para Julieta — celebrando su brillo, su risa y un nuevo año de aventuras. Cálida, alegre, ambiente familiar.",
    style: 'pop, alegre, guitarra acústica, palmas, ambiente familiar',
  },
  {
    id: 'lullaby',
    emoji: '🌙',
    title: 'Canción de cuna',
    theme: "Una canción de cuna suave sobre estrellas que cuidan a una niña dormida, sueños que flotan en una noche tranquila.",
    style: 'canción de cuna, piano suave, caja musical, tempo lento, calma',
  },
  {
    id: 'roadtrip',
    emoji: '🚗',
    title: 'Himno de viaje en coche',
    theme: "Un himno sobre un viaje por la costa con las ventanas abiertas, amigos atrás, atardecer sobre el océano.",
    style: 'indie pop, ritmo conductor, guitarra eléctrica, verano, optimista',
  },
  {
    id: 'study',
    emoji: '📚',
    title: 'Música para estudiar',
    theme: "Música calmada para concentrarse en los deberes. Sin distracciones, solo una vibra cálida y constante.",
    style: 'lo-fi, instrumental, piano suave, ritmo ligero, ambiente',
  },
  {
    id: 'silly',
    emoji: '🤪',
    title: 'Canción graciosa de mascotas',
    theme: "Una canción divertida sobre un gato que cree ser el jefe de la casa, tira cosas de la mesa y pide premios a las 3 AM.",
    style: 'cómica, ukelele, alegre, infantil, ligera',
  },
  {
    id: 'cumbia',
    emoji: '💃',
    title: 'Cumbia para bailar',
    theme: "Una cumbia alegre sobre una fiesta familiar al atardecer, primos bailando en el patio, risas que no paran.",
    style: 'cumbia, acordeón, percusión, festiva, bailable, latina',
  },
];

interface RecipeCardProps {
  recipe: Recipe;
  onUse: (recipe: Recipe) => void;
}

function RecipeCard({ recipe, onUse }: RecipeCardProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyTheme = async () => {
    try {
      await navigator.clipboard.writeText(`${recipe.theme}\n\nStyle: ${recipe.style}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; ignore — user can still hit Use.
    }
  };
  return (
    <div
      className="rounded-lg p-3 transition-all"
      style={{
        background: 'var(--bg-titlebar)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-start gap-2 mb-2">
        <span style={{ fontSize: 22 }}>{recipe.emoji}</span>
        <div className="flex-1">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {recipe.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45 }}>
            {recipe.theme}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4, fontStyle: 'italic' }}>
            {recipe.style}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onUse(recipe)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all hover:scale-[1.02]"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'white',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          }}
        >
          <Wand2 size={12} />
          {t('julietaHelp.recipe.use')}
        </button>
        <button
          onClick={copyTheme}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md transition-all hover:bg-[var(--bg-hover)]"
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
          title={t('julietaHelp.recipe.copy')}
        >
          {copied ? <Check size={12} style={{ color: '#4ade80' }} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

interface JulietaHelpProps {
  open: boolean;
  onClose: () => void;
  onUseRecipe: (theme: string, style: string) => void;
}

export default function JulietaHelp({ open, onClose, onUseRecipe }: JulietaHelpProps) {
  const { t, language } = useI18n();
  const [tab, setTab] = useState<Tab>('start');

  if (!open) return null;

  const recipes = language === 'es' ? RECIPES_ES : RECIPES_EN;

  return (
    <div
      className="absolute inset-0 z-40 flex"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="ml-auto h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: '95%',
          background: 'var(--bg-window)',
          borderLeft: '1px solid var(--border-subtle)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center rounded-lg flex-shrink-0"
              style={{
                width: 32, height: 32,
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              }}
            >
              <Disc3 size={18} style={{ color: 'white' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t('julietaHelp.title')}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                {t('julietaHelp.subtitle')}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-all hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 flex-shrink-0">
          {(['start', 'recipes', 'help'] as const).map((id) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="px-3 py-1.5 rounded-lg transition-all"
                style={{
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: active ? 'var(--bg-titlebar)' : 'transparent',
                  border: active ? '1px solid var(--border-subtle)' : '1px solid transparent',
                }}
              >
                {t(`julietaHelp.tab.${id}`)}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto invisible-scrollbar px-5 py-4" style={{ paddingBottom: 96 }}>
          {tab === 'start' && (
            <div className="space-y-4">
              <SectionTitle icon={<Sparkles size={14} />} text={t('julietaHelp.start.workflow.title')} />
              <Step n={1} title={t('julietaHelp.start.s1.title')} body={t('julietaHelp.start.s1.body')} />
              <Step n={2} title={t('julietaHelp.start.s2.title')} body={t('julietaHelp.start.s2.body')} />
              <Step n={3} title={t('julietaHelp.start.s3.title')} body={t('julietaHelp.start.s3.body')} />
              <Step n={4} title={t('julietaHelp.start.s4.title')} body={t('julietaHelp.start.s4.body')} />

              <SectionTitle icon={<Wand2 size={14} />} text={t('julietaHelp.start.modes.title')} />
              <div className="space-y-2">
                <ModeCard emoji="🎵" name={t('julietaHelp.start.mode.song.name')} body={t('julietaHelp.start.mode.song.body')} />
                <ModeCard emoji="🎨" name={t('julietaHelp.start.mode.cover.name')} body={t('julietaHelp.start.mode.cover.body')} />
                <ModeCard emoji="✍️" name={t('julietaHelp.start.mode.lyrics.name')} body={t('julietaHelp.start.mode.lyrics.body')} />
              </div>

              <SectionTitle icon={<Mic size={14} />} text={t('julietaHelp.start.recorder.title')} />
              <Tip body={t('julietaHelp.start.recorder.body')} />

              <div
                className="p-3 rounded-lg"
                style={{
                  background: 'linear-gradient(135deg, rgba(124,77,255,0.1), rgba(255,152,0,0.1))',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  {t('julietaHelp.start.tip.title')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t('julietaHelp.start.tip.body')}
                </div>
              </div>
            </div>
          )}

          {tab === 'recipes' && (
            <div className="space-y-3">
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('julietaHelp.recipes.intro')}
              </div>
              {recipes.map((r) => (
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  onUse={(rec) => { onUseRecipe(rec.theme, rec.style); onClose(); }}
                />
              ))}
            </div>
          )}

          {tab === 'help' && (
            <div className="space-y-4">
              <SectionTitle icon={<AlertCircle size={14} />} text={t('julietaHelp.help.connection.title')} />
              <FaqItem q={t('julietaHelp.help.q.failed.title')} a={t('julietaHelp.help.q.failed.body')} />
              <FaqItem q={t('julietaHelp.help.q.nopod.title')} a={t('julietaHelp.help.q.nopod.body')} />
              <FaqItem q={t('julietaHelp.help.q.local.title')} a={t('julietaHelp.help.q.local.body')} />

              <SectionTitle icon={<Wand2 size={14} />} text={t('julietaHelp.help.usage.title')} />
              <FaqItem q={t('julietaHelp.help.q.howlong.title')} a={t('julietaHelp.help.q.howlong.body')} />
              <FaqItem q={t('julietaHelp.help.q.quota.title')} a={t('julietaHelp.help.q.quota.body')} />
              <FaqItem q={t('julietaHelp.help.q.length.title')} a={t('julietaHelp.help.q.length.body')} />
              <FaqItem q={t('julietaHelp.help.q.coverlen.title')} a={t('julietaHelp.help.q.coverlen.body')} />

              <SectionTitle icon={<Mic size={14} />} text={t('julietaHelp.help.troubleshoot.title')} />
              <FaqItem q={t('julietaHelp.help.q.silentmic.title')} a={t('julietaHelp.help.q.silentmic.body')} />
              <FaqItem q={t('julietaHelp.help.q.shortrec.title')} a={t('julietaHelp.help.q.shortrec.body')} />
              <FaqItem q={t('julietaHelp.help.q.privacy.title')} a={t('julietaHelp.help.q.privacy.body')} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tiny presentational helpers ──────────────────────────────────

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
      <span style={{ color: 'var(--accent-primary)' }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {text}
      </span>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div
        className="flex items-center justify-center rounded-full flex-shrink-0"
        style={{
          width: 22, height: 22,
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          color: 'white',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {n}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

function ModeCard({ emoji, name, body }: { emoji: string; name: string; body: string }) {
  return (
    <div
      className="flex gap-3 p-3 rounded-lg"
      style={{ background: 'var(--bg-titlebar)', border: '1px solid var(--border-subtle)' }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

function Tip({ body }: { body: string }) {
  return (
    <div
      className="px-3 py-2 rounded-lg"
      style={{ background: 'var(--bg-titlebar)', border: '1px solid var(--border-subtle)' }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-titlebar)', border: '1px solid var(--border-subtle)' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-all hover:bg-[var(--bg-hover)]"
      >
        <ChevronRight
          size={12}
          style={{
            color: 'var(--text-secondary)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{q}</span>
      </button>
      {open && (
        <div className="px-3 pb-3" style={{ paddingLeft: 28 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
            {a}
          </div>
        </div>
      )}
    </div>
  );
}
