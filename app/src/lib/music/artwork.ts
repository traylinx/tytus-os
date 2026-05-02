import type { ArtworkSet, ArtistRef } from './types';

export const pickArtwork = (
  artwork?: ArtworkSet | null,
  purpose: 'thumb' | 'hero' | 'cover' = 'cover',
  minSize = 0,
): string | null => {
  if (!artwork) return null;
  const ordered = purpose === 'thumb'
    ? [artwork.thumbnail, artwork.small, artwork.medium, artwork.large, artwork.original]
    : [artwork.original, artwork.large, artwork.medium, artwork.small, artwork.thumbnail];
  const direct = ordered.find(Boolean);
  if (direct) return direct ?? null;
  const sorted = [...(artwork.images ?? [])]
    .filter((img) => img.url)
    .sort((a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)));
  return sorted.find((img) => Math.max(img.width ?? 0, img.height ?? 0) >= minSize)?.url
    ?? sorted[0]?.url
    ?? null;
};

export const formatArtistCredits = (artists?: ArtistRef[] | null): string =>
  (artists ?? []).map((a) => a.name).filter(Boolean).join(', ');

export const musicTrackId = (provider: string, id: string): string => `${provider}:${id}`;
