const DEFAULT_PUBLIC_TRACKING_URL = 'https://taller-ashen.vercel.app';

export function normalizeTrackingBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isPrivatePreviewOrigin(url: string): boolean {
  const normalized = normalizeTrackingBaseUrl(url);
  if (!normalized) return true;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('ais-dev-') ||
      host.startsWith('ais-pre-')
    );
  } catch {
    return true;
  }
}

export function resolveTrackingBaseUrl(profileTrackingBaseUrl?: string | null): string {
  const configured = normalizeTrackingBaseUrl(profileTrackingBaseUrl || '');
  if (configured && !isPrivatePreviewOrigin(configured)) {
    return configured;
  }

  if (typeof window !== 'undefined') {
    const currentOrigin = normalizeTrackingBaseUrl(window.location.origin);
    if (currentOrigin && !isPrivatePreviewOrigin(currentOrigin)) {
      return currentOrigin;
    }
  }

  return DEFAULT_PUBLIC_TRACKING_URL;
}

export function buildTrackingUrl(
  trackingCode: string,
  profileTrackingBaseUrl?: string | null
): string {
  const baseUrl = resolveTrackingBaseUrl(profileTrackingBaseUrl);
  return `${baseUrl}/?track=${encodeURIComponent(trackingCode)}`;
}
