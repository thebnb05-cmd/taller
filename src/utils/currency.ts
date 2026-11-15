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

export function sanitizeCurrencyCode(raw: unknown): CurrencyCode {
  if (typeof raw !== 'string') return DEFAULT_CURRENCY;
  const upper = raw.trim().toUpperCase() as CurrencyCode;
  return CURRENCY_MAP.has(upper) ? upper : DEFAULT_CURRENCY;
}

export function getCurrencyOption(code?: string | null): CurrencyOption {
  const valid = sanitizeCurrencyCode(code);
  return CURRENCY_MAP.get(valid) ?? CURRENCY_OPTIONS[0];
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
