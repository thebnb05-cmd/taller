import { useSyncExternalStore } from 'react';
import { getPreferenceCookie, setPreferenceCookie } from './cookieStorage';

export type CurrencyCode =
  | 'ARS'
  | 'USD'
  | 'EUR'
  | 'BRL'
  | 'UYU'
  | 'CLP'
  | 'PYG'
  | 'MXN'
  | 'PEN'
  | 'BOB'
  | 'COP';

export interface CurrencyOption {
  code: CurrencyCode;
  name: string;
  symbol: string;
  label: string;
}

export interface SecondaryCurrencyConfig {
  code: CurrencyCode;
  rate: number;
}

export const DEFAULT_CURRENCY: CurrencyCode = 'ARS';

export const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
  {
    code: 'ARS',
    name: 'Peso argentino',
    symbol: '$',
    label: 'Peso argentino (ARS · $)',
  },
  {
    code: 'USD',
    name: 'Dólar estadounidense',
    symbol: 'US$',
    label: 'Dólar estadounidense (USD · US$)',
  },
  {
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    label: 'Euro (EUR · €)',
  },
  {
    code: 'BRL',
    name: 'Real brasileño',
    symbol: 'R$',
    label: 'Real brasileño (BRL · R$)',
  },
  {
    code: 'UYU',
    name: 'Peso uruguayo',
    symbol: '$U',
    label: 'Peso uruguayo (UYU · $U)',
  },
  {
    code: 'CLP',
    name: 'Peso chileno',
    symbol: 'CLP$',
    label: 'Peso chileno (CLP · CLP$)',
  },
  {
    code: 'PYG',
    name: 'Guaraní paraguayo',
    symbol: 'Gs.',
    label: 'Guaraní paraguayo (PYG · Gs.)',
  },
  {
    code: 'MXN',
    name: 'Peso mexicano',
    symbol: 'MX$',
    label: 'Peso mexicano (MXN · MX$)',
  },
  {
    code: 'PEN',
    name: 'Sol peruano',
    symbol: 'S/',
    label: 'Sol peruano (PEN · S/)',
  },
  {
    code: 'BOB',
    name: 'Boliviano',
    symbol: 'Bs.',
    label: 'Boliviano (BOB · Bs.)',
  },
  {
    code: 'COP',
    name: 'Peso colombiano',
    symbol: 'COP$',
    label: 'Peso colombiano (COP · COP$)',
  },
];

const CURRENCY_MAP = new Map<CurrencyCode, CurrencyOption>(
  CURRENCY_OPTIONS.map((opt) => [opt.code, opt])
);

const CURRENCY_COOKIE_KEY = 'th3bnb_currency';
const CURRENCY_STORAGE_KEY = 'th3bnb-currency';

export function isValidCurrencyCode(raw: unknown): raw is CurrencyCode {
  if (typeof raw !== 'string') return false;
  const upper = raw.trim().toUpperCase() as CurrencyCode;
  return CURRENCY_MAP.has(upper);
}

export function sanitizeCurrencyCode(raw: unknown): CurrencyCode {
  if (typeof raw !== 'string') return DEFAULT_CURRENCY;
  const upper = raw.trim().toUpperCase() as CurrencyCode;
  return CURRENCY_MAP.has(upper) ? upper : DEFAULT_CURRENCY;
}

export function getCurrencyOption(code?: string | null): CurrencyOption {
  const valid = sanitizeCurrencyCode(code);
  return CURRENCY_MAP.get(valid) ?? CURRENCY_OPTIONS[0];
}

export function sanitizeSecondaryCurrencies(
  raw: unknown,
  baseCurrency: CurrencyCode
): SecondaryCurrencyConfig[] {
  if (!Array.isArray(raw)) return [];
  const base = sanitizeCurrencyCode(baseCurrency);
  const seen = new Set<CurrencyCode>();
  const result: SecondaryCurrencyConfig[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { c?: unknown; r?: unknown; code?: unknown; rate?: unknown };
    const rawCode = record.code ?? record.c;
    if (!isValidCurrencyCode(rawCode)) continue;
    const code = rawCode.trim().toUpperCase() as CurrencyCode;
    if (code === base || seen.has(code)) continue;

    const rawRate = record.rate ?? record.r;
    const numericRate =
      typeof rawRate === 'string' ? Number(rawRate.trim().replace(',', '.')) : Number(rawRate);
    if (!Number.isFinite(numericRate) || numericRate <= 0) continue;

    const normalizedRate = Math.round(numericRate * 1_000_000) / 1_000_000;
    if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) continue;

    seen.add(code);
    result.push({ code, rate: normalizedRate });
    if (result.length >= CURRENCY_OPTIONS.length - 1) break;
  }

  return result;
}

export function convertFromBaseCurrency(amountInBase: number, rate: number): number {
  if (!Number.isFinite(amountInBase) || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return amountInBase / rate;
}

export function convertToBaseCurrency(amountInSecondary: number, rate: number): number {
  if (!Number.isFinite(amountInSecondary) || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return amountInSecondary * rate;
}

export function getCurrencyRateFromBase(
  currencyCode: CurrencyCode,
  baseCurrency: CurrencyCode,
  secondaryCurrencies: readonly SecondaryCurrencyConfig[]
): number | null {
  if (currencyCode === baseCurrency) return 1;
  const match = secondaryCurrencies.find((item) => item.code === currencyCode);
  return match && Number.isFinite(match.rate) && match.rate > 0 ? match.rate : null;
}

export function convertBetweenCurrencies(
  amount: number,
  fromCode: CurrencyCode,
  toCode: CurrencyCode,
  baseCurrency: CurrencyCode,
  secondaryCurrencies: readonly SecondaryCurrencyConfig[]
): number {
  if (!Number.isFinite(amount)) return 0;
  if (fromCode === toCode) return amount;
  const fromRate = getCurrencyRateFromBase(fromCode, baseCurrency, secondaryCurrencies);
  const toRate = getCurrencyRateFromBase(toCode, baseCurrency, secondaryCurrencies);
  if (!fromRate || !toRate) return amount;
  return (amount * fromRate) / toRate;
}

function readInitialCurrency(): CurrencyCode {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY;
  const fromCookie = getPreferenceCookie(CURRENCY_COOKIE_KEY);
  if (fromCookie) {
    return sanitizeCurrencyCode(fromCookie);
  }
  try {
    const fromStorage = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (fromStorage) {
      return sanitizeCurrencyCode(fromStorage);
    }
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_CURRENCY;
}

let activeCurrency: CurrencyCode = readInitialCurrency();
const currencyListeners = new Set<() => void>();

export function getActiveCurrency(): CurrencyCode {
  return activeCurrency;
}

export function setActiveCurrency(code: unknown): CurrencyCode {
  const next = sanitizeCurrencyCode(code);
  if (typeof window !== 'undefined') {
    setPreferenceCookie(CURRENCY_COOKIE_KEY, next);
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch {
      // Ignore storage access errors
    }
  }
  if (next !== activeCurrency) {
    activeCurrency = next;
    currencyListeners.forEach((listener) => listener());
  }
  return next;
}

export function subscribeCurrencyChange(listener: () => void): () => void {
  currencyListeners.add(listener);
  return () => {
    currencyListeners.delete(listener);
  };
}

export function useActiveCurrency(): CurrencyCode {
  return useSyncExternalStore(
    subscribeCurrencyChange,
    getActiveCurrency,
    () => DEFAULT_CURRENCY
  );
}
