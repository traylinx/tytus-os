export const TYTUS_WALLPAPERS = [
  { id: '/wallpapers/tytusOS-bg1.png', name: 'Tytus Aurora' },
  { id: '/wallpapers/tytusOS-bg2.png', name: 'Tytus Ember' },
  { id: '/wallpapers/tytusOS-bg3.png', name: 'Tytus Spectrum' },
  { id: '/wallpapers/tytusOS-bg4.png', name: 'Tytus Night' },
] as const;

export const DEFAULT_TYTUS_WALLPAPER = TYTUS_WALLPAPERS[2].id;

export const isTytusWallpaper = (value: string): boolean =>
  TYTUS_WALLPAPERS.some((wallpaper) => wallpaper.id === value);
