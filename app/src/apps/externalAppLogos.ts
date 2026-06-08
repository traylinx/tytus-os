export interface ExternalAppLogo {
  src: string;
  background?: string;
  scale?: number;
}

// File-backed third-party app marks. Assets live under app/public so both
// App Store cards and Dock icons render the same product branding.
export const EXTERNAL_APP_LOGOS: Record<string, ExternalAppLogo> = {
  ail: { src: '/brand/external/switchai.png', background: '#101014', scale: 0.82 },
  pi: { src: '/brand/external/pi.svg', background: '#6f4dff', scale: 0.62 },
  openwork: { src: '/brand/external/openwork.svg', background: '#f7f4ef', scale: 0.78 },
  'open-design': { src: '/brand/external/open-design.png', background: '#1f2a1f', scale: 1 },
  odysseus: { src: '/brand/external/odysseus.png', background: '#111827', scale: 0.88 },
};

export const getExternalAppLogo = (appId: string): ExternalAppLogo | undefined =>
  EXTERNAL_APP_LOGOS[appId];
