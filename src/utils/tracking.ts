import { DEFAULT_CURRENCY, sanitizeCurrencyCode, type CurrencyCode } from './currency';

const DEFAULT_PUBLIC_TRACKING_URL = 'https://taller-ashen.vercel.app';

export function normalizeTrackingBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return '';
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
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
  profileTrackingBaseUrl?: string | null,
  currencyCode?: CurrencyCode | string | null
): string {
  const baseUrl = resolveTrackingBaseUrl(profileTrackingBaseUrl);
  const safeCurrency = currencyCode ? sanitizeCurrencyCode(currencyCode) : DEFAULT_CURRENCY;
  const currencyParam = safeCurrency !== DEFAULT_CURRENCY ? `&cur=${encodeURIComponent(safeCurrency)}` : '';
  return `${baseUrl}/?track=${encodeURIComponent(trackingCode)}${currencyParam}`;
}
