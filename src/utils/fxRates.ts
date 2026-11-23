import type { CurrencyCode } from './currency';

export interface ArsQuotePair {
  buy: number;
  sell: number;
}

export interface FxApiResponse {
  ok: boolean;
  base?: 'USD';
  rates?: Record<string, number>;
  arsQuotes?: {
    oficial?: ArsQuotePair;
    blue?: ArsQuotePair;
    mep?: ArsQuotePair;
  } | null;
  updatedAt?: number;
  source?: string;
  error?: string;
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
export const FX_UPDATE_EVENT = 'th3bnb:fx-snapshot-updated';
export const FX_AUTO_POLL_MS = 3 * 60 * 1000;

let inflightRequest: Promise<FxApiResponse> | null = null;

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

export async function fetchUsdRates(force = false): Promise<FxApiResponse> {
  if (!force && inflightRequest) {
    return inflightRequest;
  }

  const run = (async () => {
    const url = force ? '/api/fx/usd?force=1' : '/api/fx/usd';
    const res = await fetch(url, { cache: 'no-store' });
    const data = (await res.json()) as FxApiResponse;
    if (!res.ok || !data.ok || !data.rates) {
      throw new Error(data.error || 'No se pudo actualizar la cotización.');
    }
    writeStoredFxSnapshot(data);
    return data;
  })();

  if (!force) {
    inflightRequest = run.finally(() => {
      inflightRequest = null;
    });
    return inflightRequest;
  }

  return run;
}
