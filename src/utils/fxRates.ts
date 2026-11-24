import type { CurrencyCode, SecondaryCurrencyConfig } from './currency';

export type ArsQuoteSource = 'blue' | 'oficial' | 'mep';
export type FxProviderId = 'auto' | 'exchangerate-api' | 'fixer' | 'frankfurter';
export type FxSyncIntervalMinutes = 3 | 5 | 15 | 30 | 60 | 360;

export const DEFAULT_FX_PROVIDER: FxProviderId = 'auto';
export const DEFAULT_FX_INTERVAL_MINUTES: FxSyncIntervalMinutes = 15;

export const FX_PROVIDER_OPTIONS: readonly {
  id: FxProviderId;
  es: string;
  en: string;
  pt: string;
}[] = [
  {
    id: 'auto',
    es: 'Automático (ExchangeRate-API + respaldo)',
    en: 'Automatic (ExchangeRate-API + fallback)',
    pt: 'Automático (ExchangeRate-API + reserva)',
  },
  {
    id: 'exchangerate-api',
    es: 'ExchangeRate-API (open.er-api.com)',
    en: 'ExchangeRate-API (open.er-api.com)',
    pt: 'ExchangeRate-API (open.er-api.com)',
  },
  {
    id: 'fixer',
    es: 'Fixer.io (tasas de referencia)',
    en: 'Fixer.io (reference rates)',
    pt: 'Fixer.io (taxas de referência)',
  },
  {
    id: 'frankfurter',
    es: 'Frankfurter (Banco Central Europeo)',
    en: 'Frankfurter (European Central Bank)',
    pt: 'Frankfurter (Banco Central Europeu)',
  },
];

export const FX_INTERVAL_OPTIONS: readonly {
  minutes: FxSyncIntervalMinutes;
  es: string;
  en: string;
  pt: string;
}[] = [
  { minutes: 3, es: 'Cada 3 minutos', en: 'Every 3 minutes', pt: 'A cada 3 minutos' },
  { minutes: 5, es: 'Cada 5 minutos', en: 'Every 5 minutes', pt: 'A cada 5 minutos' },
  { minutes: 15, es: 'Cada 15 minutos', en: 'Every 15 minutes', pt: 'A cada 15 minutos' },
  { minutes: 30, es: 'Cada 30 minutos', en: 'Every 30 minutes', pt: 'A cada 30 minutos' },
  { minutes: 60, es: 'Cada 1 hora', en: 'Every 1 hour', pt: 'A cada 1 hora' },
  { minutes: 360, es: 'Cada 6 horas', en: 'Every 6 hours', pt: 'A cada 6 horas' },
];

export function sanitizeFxProvider(raw: unknown): FxProviderId {
  if (raw === 'exchangerate-api' || raw === 'fixer' || raw === 'frankfurter' || raw === 'auto') {
    return raw;
  }
  return DEFAULT_FX_PROVIDER;
}

export function sanitizeFxIntervalMinutes(raw: unknown): FxSyncIntervalMinutes {
  const num = Number(raw);
  if (num === 3 || num === 5 || num === 15 || num === 30 || num === 60 || num === 360) {
    return num;
  }
  return DEFAULT_FX_INTERVAL_MINUTES;
}

export interface ArsQuotePair {
  buy: number;
  sell: number;
}

export interface FxApiResponse {
  ok: boolean;
  base?: 'USD';
  provider?: FxProviderId;
  rates?: Record<string, number>;
  arsQuotes?: {
    oficial?: ArsQuotePair;
    blue?: ArsQuotePair;
    mep?: ArsQuotePair;
  } | null;
  updatedAt?: number;
  source?: string;
  configuredKeys?: {
    fixer?: boolean;
    exchangerateV6?: boolean;
  };
  error?: string;
}

export interface FxServiceStatus {
  lastCheckedAt: number | null;
  lastUpdatedAt: number | null;
  provider: FxProviderId;
  source: string | null;
  error: string | null;
}

interface StoredFxComparison {
  lastRate: number;
  prevRate: number | null;
}

export const COUNTRY_BY_CURRENCY: Record<
  CurrencyCode,
  { es: string; en: string; pt: string; short: string }
> = {
  ARS: { es: 'Argentina', en: 'Argentina', pt: 'Argentina', short: 'AR' },
  USD: { es: 'EE. UU.', en: 'United States', pt: 'EUA', short: 'US' },
  EUR: { es: 'Zona Euro', en: 'Eurozone', pt: 'Zona do Euro', short: 'EU' },
  BRL: { es: 'Brasil', en: 'Brazil', pt: 'Brasil', short: 'BR' },
  UYU: { es: 'Uruguay', en: 'Uruguay', pt: 'Uruguai', short: 'UY' },
  CLP: { es: 'Chile', en: 'Chile', pt: 'Chile', short: 'CL' },
  PYG: { es: 'Paraguay', en: 'Paraguay', pt: 'Paraguai', short: 'PY' },
  MXN: { es: 'México', en: 'Mexico', pt: 'México', short: 'MX' },
  PEN: { es: 'Perú', en: 'Peru', pt: 'Peru', short: 'PE' },
  BOB: { es: 'Bolivia', en: 'Bolivia', pt: 'Bolívia', short: 'BO' },
  COP: { es: 'Colombia', en: 'Colombia', pt: 'Colômbia', short: 'CO' },
};

const FX_STORAGE_KEY = 'th3bnb-fx-usd-snapshot-v1';
const FX_HISTORY_KEY = 'th3bnb-fx-usd-history-v1';
const FX_SERVICE_STATUS_KEY = 'th3bnb-fx-service-status-v1';
export const FX_UPDATE_EVENT = 'th3bnb:fx-snapshot-updated';
export const FX_SERVICE_STATUS_EVENT = 'th3bnb:fx-service-status';
export const FX_AUTO_POLL_MS = 3 * 60 * 1000;

const inflightByProvider = new Map<FxProviderId, Promise<FxApiResponse>>();

export function formatRateNumber(
  value: number,
  currency: CurrencyCode,
  locale: string,
  compact = false
): string {
  const zeroDecimal = compact || currency === 'PYG' || currency === 'CLP';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(value);
}

export function readStoredFxSnapshot(): FxApiResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FxApiResponse;
    return parsed && parsed.ok && parsed.rates ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredFxSnapshot(data: FxApiResponse): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent<FxApiResponse>(FX_UPDATE_EVENT, { detail: data }));
  } catch {
    // Ignore storage errors
  }
}

export function readFxServiceStatus(): FxServiceStatus {
  const fallback: FxServiceStatus = {
    lastCheckedAt: null,
    lastUpdatedAt: null,
    provider: DEFAULT_FX_PROVIDER,
    source: null,
    error: null,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(FX_SERVICE_STATUS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FxServiceStatus>;
    return {
      lastCheckedAt:
        typeof parsed.lastCheckedAt === 'number' && Number.isFinite(parsed.lastCheckedAt)
          ? parsed.lastCheckedAt
          : null,
      lastUpdatedAt:
        typeof parsed.lastUpdatedAt === 'number' && Number.isFinite(parsed.lastUpdatedAt)
          ? parsed.lastUpdatedAt
          : null,
      provider: sanitizeFxProvider(parsed.provider),
      source: typeof parsed.source === 'string' ? parsed.source : null,
      error: typeof parsed.error === 'string' ? parsed.error : null,
    };
  } catch {
    return fallback;
  }
}

export function writeFxServiceStatus(status: FxServiceStatus): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FX_SERVICE_STATUS_KEY, JSON.stringify(status));
    window.dispatchEvent(new CustomEvent<FxServiceStatus>(FX_SERVICE_STATUS_EVENT, { detail: status }));
  } catch {
    // Ignore storage errors
  }
}

export function updateFxRateHistory(
  key: string,
  nextRate: number
): { current: number; prev: number | null } {
  if (typeof window === 'undefined' || !Number.isFinite(nextRate) || nextRate <= 0) {
    return { current: nextRate, prev: null };
  }
  try {
    const raw = window.localStorage.getItem(FX_HISTORY_KEY);
    const map: Record<string, StoredFxComparison> = raw ? JSON.parse(raw) : {};
    const existing = map[key];
    if (!existing || !Number.isFinite(existing.lastRate)) {
      map[key] = { lastRate: nextRate, prevRate: null };
      window.localStorage.setItem(FX_HISTORY_KEY, JSON.stringify(map));
      return { current: nextRate, prev: null };
    }

    const diff = Math.abs(nextRate - existing.lastRate);
    if (diff >= 0.005) {
      map[key] = { lastRate: nextRate, prevRate: existing.lastRate };
      window.localStorage.setItem(FX_HISTORY_KEY, JSON.stringify(map));
      return { current: nextRate, prev: existing.lastRate };
    }
    return { current: nextRate, prev: existing.prevRate };
  } catch {
    return { current: nextRate, prev: null };
  }
}

export async function fetchUsdRates(
  forceOrOptions: boolean | { force?: boolean; provider?: FxProviderId } = false
): Promise<FxApiResponse> {
  const opts =
    typeof forceOrOptions === 'boolean' ? { force: forceOrOptions } : forceOrOptions || {};
  const force = Boolean(opts.force);
  const provider = sanitizeFxProvider(opts.provider);

  const existingInflight = inflightByProvider.get(provider);
  if (!force && existingInflight) {
    return existingInflight;
  }

  const run = (async () => {
    const params = new URLSearchParams();
    if (provider !== 'auto') params.set('provider', provider);
    if (force) params.set('force', '1');
    const query = params.toString();
    const url = query ? `/api/fx/usd?${query}` : '/api/fx/usd';
    const res = await fetch(url, { cache: 'no-store' });
    const data = (await res.json()) as FxApiResponse;
    if (!res.ok || !data.ok || !data.rates) {
      throw new Error(data.error || 'No se pudo actualizar la cotización.');
    }
    writeStoredFxSnapshot(data);
    return data;
  })();

  if (!force) {
    const tracked = run.finally(() => {
      inflightByProvider.delete(provider);
    });
    inflightByProvider.set(provider, tracked);
    return tracked;
  }

  return run;
}

export function roundFxConversionRate(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 1) return Math.round(raw * 100) / 100;
  if (raw >= 0.01) return Math.round(raw * 10_000) / 10_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

export function getUsdUnitRate(
  currency: CurrencyCode,
  snapshot: FxApiResponse | null | undefined,
  arsSource: ArsQuoteSource = 'blue'
): number | null {
  if (currency === 'USD') return 1;
  if (!snapshot?.rates) return null;
  if (currency === 'ARS' && snapshot.arsQuotes) {
    if (arsSource === 'oficial' && snapshot.arsQuotes.oficial?.sell) {
      return snapshot.arsQuotes.oficial.sell;
    }
    if (arsSource === 'mep' && snapshot.arsQuotes.mep?.sell) {
      return snapshot.arsQuotes.mep.sell;
    }
    if (arsSource === 'blue' && snapshot.arsQuotes.blue?.sell) {
      return snapshot.arsQuotes.blue.sell;
    }
    if (snapshot.arsQuotes.oficial?.sell) {
      return snapshot.arsQuotes.oficial.sell;
    }
  }
  const val = snapshot.rates[currency];
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
}

/**
 * Returns how many units of `baseCurrency` equal 1 unit of `secondaryCode`
 * using live FX rates (matching WorkshopReceiptMeta.secondaryCurrencies convention).
 */
export function resolveLiveRateToBase(
  secondaryCode: CurrencyCode,
  baseCurrency: CurrencyCode,
  snapshot: FxApiResponse | null | undefined,
  arsSource: ArsQuoteSource = 'blue'
): number | null {
  if (secondaryCode === baseCurrency) return 1;
  const basePerUsd = getUsdUnitRate(baseCurrency, snapshot, arsSource);
  const secPerUsd = getUsdUnitRate(secondaryCode, snapshot, arsSource);
  if (!basePerUsd || !secPerUsd || secPerUsd <= 0) return null;
  const raw = basePerUsd / secPerUsd;
  const rounded = roundFxConversionRate(raw);
  return rounded > 0 ? rounded : null;
}

export function buildSyncedSecondaryCurrencies(
  baseCurrency: CurrencyCode,
  existing: readonly SecondaryCurrencyConfig[],
  snapshot: FxApiResponse | null | undefined,
  arsSource: ArsQuoteSource = 'blue',
  ensureCurrency?: CurrencyCode | null
): { items: SecondaryCurrencyConfig[]; changed: boolean } {
  const next: SecondaryCurrencyConfig[] = [];
  const seen = new Set<CurrencyCode>();
  let changed = false;

  for (const entry of existing) {
    if (entry.code === baseCurrency || seen.has(entry.code)) {
      changed = true;
      continue;
    }
    seen.add(entry.code);
    const liveRate = resolveLiveRateToBase(entry.code, baseCurrency, snapshot, arsSource);
    if (liveRate && liveRate > 0) {
      const relDiff = entry.rate > 0 ? Math.abs(liveRate - entry.rate) / entry.rate : 1;
      if (relDiff > 0.0005) {
        changed = true;
        next.push({ code: entry.code, rate: liveRate });
      } else {
        next.push(entry);
      }
    } else {
      next.push(entry);
    }
  }

  if (ensureCurrency && ensureCurrency !== baseCurrency && !seen.has(ensureCurrency)) {
    const liveRate = resolveLiveRateToBase(ensureCurrency, baseCurrency, snapshot, arsSource);
    if (liveRate && liveRate > 0) {
      next.push({ code: ensureCurrency, rate: liveRate });
      changed = true;
    }
  }

  return { items: next, changed };
}

