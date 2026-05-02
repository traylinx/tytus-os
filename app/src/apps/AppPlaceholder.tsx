import { memo } from 'react';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { getAppById } from './registry';
import { BrandIcon, isBrandIconName } from '../components/BrandIcon';

const DynamicIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  if (isBrandIconName(name)) {
    return <BrandIcon name={name} size={(props.size as number) ?? 28} className={props.className} />;
  }
  const C = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  return C ? <C {...props} /> : <Icons.Box {...props} />;
};

interface AppPlaceholderProps {
  appId: string;
}

const AppPlaceholder = memo(function AppPlaceholder({ appId }: AppPlaceholderProps) {
  const app = getAppById(appId);
  const phase = app?.phase ?? '?';

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center select-none"
      style={{ background: 'var(--bg-window)', color: 'var(--text-primary)' }}>
      <div className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center"
        style={{ background: 'rgba(124,77,255,0.12)', border: '1px solid rgba(124,77,255,0.35)' }}>
        <DynamicIcon name={app?.icon || 'Box'} size={28} />
      </div>
      <h2 className="text-lg font-semibold mb-1">{app?.name ?? appId}</h2>
      <p className="text-xs opacity-60 mb-5 max-w-sm">{app?.description ?? 'Tytus OS app — placeholder.'}</p>
      <div className="text-[10px] tracking-widest uppercase px-3 py-1 rounded-full"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
        Wires up in Phase {phase}
      </div>
    </div>
  );
});

export default AppPlaceholder;
