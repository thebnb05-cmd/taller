import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  DollarSign,
  RefreshCw,
} from 'lucide-react';
import {
  CURRENCY_OPTIONS,
  getCurrencyOption,
  useActiveCurrency,
  type CurrencyCode,
} from '../utils/currency';
import { useI18n } from '../utils/i18n';

interface ArsQuotePair {
  buy: number;
  sell: number;
}

interface FxApiResponse {
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

const COUNTRY_BY_CURRENCY: Record<
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
const AUTO_POLL_MS = 3 * 60 * 1000;

function formatRateNumber(value: number, currency: CurrencyCode, locale: string): string {
  const zeroDecimal = currency === 'PYG' || currency === 'CLP';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(value);
}

function readStoredSnapshot(): FxApiResponse | null {
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

function writeStoredSnapshot(data: FxApiResponse): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

function updateRateHistory(
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

export const DollarRateBanner: React.FC = () => {
  const activeCurrency = useActiveCurrency();
  const { lang, locale, tr } = useI18n();

  const [overrideCurrency, setOverrideCurrency] = useState<'AUTO' | CurrencyCode>('AUTO');
  const [snapshot, setSnapshot] = useState<FxApiResponse | null>(() => readStoredSnapshot());
  const [loading, setLoading] = useState<boolean>(() => !readStoredSnapshot());
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConverter, setShowConverter] = useState(false);
  const [usdInput, setUsdInput] = useState('100');
  const [arsConvMode, setArsConvMode] = useState<'blue' | 'oficial'>('blue');
  const [rateDelta, setRateDelta] = useState<{ diff: number; pct: number } | null>(null);

  const targetCurrency: CurrencyCode = useMemo(() => {
    if (overrideCurrency !== 'AUTO') return overrideCurrency;
    return activeCurrency === 'USD' ? (lang === 'en' ? 'EUR' : 'ARS') : activeCurrency;
  }, [activeCurrency, lang, overrideCurrency]);

  const hasSnapshotRef = useRef<boolean>(Boolean(snapshot));
  const lastUpdatedRef = useRef<number>(snapshot?.updatedAt ?? 0);

  useEffect(() => {
    hasSnapshotRef.current = Boolean(snapshot);
    lastUpdatedRef.current = snapshot?.updatedAt ?? 0;
  }, [snapshot]);

  const syncRates = useCallback(async (force = false) => {
    if (force) {
      setRefreshing(true);
    } else if (!hasSnapshotRef.current) {
      setLoading(true);
    }
    setErrorMsg(null);
    try {
      const url = force ? '/api/fx/usd?force=1' : '/api/fx/usd';
      const res = await fetch(url, { cache: 'no-store' });
      const data = (await res.json()) as FxApiResponse;
      if (!res.ok || !data.ok || !data.rates) {
        throw new Error(
          data.error ||
            tr(
              'No se pudo actualizar la cotización.',
              'Could not refresh exchange rate.',
              'Não foi possível atualizar a cotação.'
            )
        );
      }
      hasSnapshotRef.current = true;
      lastUpdatedRef.current = data.updatedAt ?? Date.now();
      setSnapshot(data);
      writeStoredSnapshot(data);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : tr('Sin conexión para cotización.', 'Offline for exchange rate.', 'Sem conexão para cotação.')
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useEffect(() => {
    void syncRates(false);
    const intervalId = window.setInterval(() => {
      void syncRates(false);
    }, AUTO_POLL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const age = lastUpdatedRef.current ? Date.now() - lastUpdatedRef.current : Infinity;
        if (age > 90 * 1000) {
          void syncRates(false);
        }
      }
    };
    const handleOnline = () => void syncRates(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [syncRates]);

  const currentRate = useMemo(() => {
    if (!snapshot?.rates) return null;
    if (targetCurrency === 'ARS' && snapshot.arsQuotes?.oficial?.sell) {
      return snapshot.arsQuotes.oficial.sell;
    }
    const val = snapshot.rates[targetCurrency];
    return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
  }, [snapshot, targetCurrency]);

  useEffect(() => {
    if (!currentRate) {
      setRateDelta(null);
      return;
    }
    const historyKey =
      targetCurrency === 'ARS' && snapshot?.arsQuotes?.blue?.sell
        ? 'ARS_BLUE'
        : targetCurrency;
    const trackedValue =
      targetCurrency === 'ARS' && snapshot?.arsQuotes?.blue?.sell
        ? snapshot.arsQuotes.blue.sell
        : currentRate;

    const { current, prev } = updateRateHistory(historyKey, trackedValue);
    if (prev && prev > 0 && Math.abs(current - prev) >= 0.005) {
      const diff = current - prev;
      const pct = (diff / prev) * 100;
      setRateDelta({ diff, pct });
    } else {
      setRateDelta(null);
    }
  }, [currentRate, snapshot?.arsQuotes?.blue?.sell, targetCurrency]);

  const targetOption = useMemo(() => getCurrencyOption(targetCurrency), [targetCurrency]);
  const countryMeta = COUNTRY_BY_CURRENCY[targetCurrency];
  const countryName = countryMeta[lang] || countryMeta.es;

  const updatedTimeLabel = useMemo(() => {
    if (!snapshot?.updatedAt) return '';
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(snapshot.updatedAt));
  }, [locale, snapshot?.updatedAt]);

  const selectableCurrencies = useMemo(
    () => CURRENCY_OPTIONS.filter((c) => c.code !== 'USD'),
    []
  );

  const effectiveConverterRate = useMemo(() => {
    if (targetCurrency === 'ARS') {
      if (arsConvMode === 'blue' && snapshot?.arsQuotes?.blue?.sell) {
        return snapshot.arsQuotes.blue.sell;
      }
      if (snapshot?.arsQuotes?.oficial?.sell) {
        return snapshot.arsQuotes.oficial.sell;
      }
    }
    return currentRate || 0;
  }, [arsConvMode, currentRate, snapshot?.arsQuotes, targetCurrency]);

  const parsedUsd = Math.max(0, Number(usdInput.replace(',', '.')) || 0);
  const convertedLocal = parsedUsd * effectiveConverterRate;

  return (
    <section
      aria-label={tr('Cotización del dólar', 'USD exchange rate', 'Cotação do dólar')}
      className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-2xs sm:px-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Sync status & Country badge */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <DollarSign className="h-4 w-4" />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                {tr('Dólar hoy', 'USD rate', 'Dólar hoje')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <span>{countryMeta.short}</span>
                <span>·</span>
                <span>{countryName}</span>
                <span>({targetCurrency})</span>
              </span>
              {rateDelta && (
                <span
                  title={tr(
                    'Variación respecto a la consulta anterior',
                    'Change since previous check',
                    'Variação em relação à consulta anterior'
                  )}
                  className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono-num text-[10px] font-bold ${
                    rateDelta.diff >= 0
                      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  }`}
                >
                  {rateDelta.diff >= 0 ? (
                    <ArrowUpRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 shrink-0" />
                  )}
                  <span>
                    {rateDelta.diff >= 0 ? '+' : ''}
                    {formatRateNumber(rateDelta.diff, targetCurrency, locale)} (
                    {rateDelta.pct >= 0 ? '+' : ''}
                    {rateDelta.pct.toFixed(2)}%)
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  errorMsg
                    ? 'bg-amber-500'
                    : loading
                      ? 'animate-pulse bg-sky-500'
                      : 'bg-emerald-500'
                }`}
              />
              <span className="truncate">
                {errorMsg
                  ? errorMsg
                  : updatedTimeLabel
                    ? `${tr('Sincronizado', 'Synced', 'Sincronizado')} · ${updatedTimeLabel}`
                    : tr('Sincronizando cotización...', 'Syncing rate...', 'Sincronizando cotação...')}
              </span>
            </div>
          </div>
        </div>

        {/* Center/Right: Live quotes + country selector + refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {loading && !snapshot ? (
            <div className="h-8 w-44 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ) : targetCurrency === 'ARS' && snapshot?.arsQuotes ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {snapshot.arsQuotes.oficial && (
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200/80 bg-sky-50/70 px-2.5 py-1 text-xs dark:border-sky-900/60 dark:bg-sky-950/40">
                  <span className="text-[11px] font-semibold text-sky-800 dark:text-sky-300">
                    Oficial
                  </span>
                  <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                    ${formatRateNumber(snapshot.arsQuotes.oficial.sell, 'ARS', locale)}
                  </span>
                </div>
              )}
              {snapshot.arsQuotes.blue && (
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-2.5 py-1 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/40">
                  <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                    Blue
                  </span>
                  <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-300">
                    C ${formatRateNumber(snapshot.arsQuotes.blue.buy, 'ARS', locale)}
                  </span>
                  <span className="font-mono-num font-bold text-emerald-800 dark:text-emerald-200">
                    V ${formatRateNumber(snapshot.arsQuotes.blue.sell, 'ARS', locale)}
                  </span>
                </div>
              )}
              {snapshot.arsQuotes.mep && (
                <div className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-800/70">
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    MEP
                  </span>
                  <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                    ${formatRateNumber(snapshot.arsQuotes.mep.sell, 'ARS', locale)}
                  </span>
                </div>
              )}
            </div>
          ) : currentRate ? (
            <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-1 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/40">
              <span className="font-mono-num font-semibold text-emerald-800 dark:text-emerald-300">
                1 USD =
              </span>
              <span className="font-mono-num text-sm font-extrabold text-slate-900 dark:text-white">
                {targetOption.symbol} {formatRateNumber(currentRate, targetCurrency, locale)}
              </span>
            </div>
          ) : null}

          <div className="flex items-center gap-1.5">
            <select
              aria-label={tr(
                'País o moneda a consultar',
                'Country or currency to track',
                'País ou moeda para consultar'
              )}
              value={overrideCurrency}
              onChange={(e) =>
                setOverrideCurrency(
                  e.target.value === 'AUTO' ? 'AUTO' : (e.target.value as CurrencyCode)
                )
              }
              className="h-8 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="AUTO">
                {tr('Auto', 'Auto', 'Auto')} ({activeCurrency === 'USD' ? (lang === 'en' ? 'EUR' : 'ARS') : activeCurrency})
              </option>
              {selectableCurrencies.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {COUNTRY_BY_CURRENCY[opt.code][lang]} ({opt.code})
                </option>
              ))}
            </select>

            {effectiveConverterRate > 0 && (
              <button
                type="button"
                onClick={() => setShowConverter((prev) => !prev)}
                aria-expanded={showConverter}
                title={tr(
                  'Convertir rápido USD a moneda local',
                  'Quick convert USD to local currency',
                  'Converter rápido USD para moeda local'
                )}
                className={`flex h-8 w-8 items-center justify-center rounded-xl border transition ${
                  showConverter
                    ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-300'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => void syncRates(true)}
              disabled={refreshing}
              aria-label={tr(
                'Actualizar cotización del dólar',
                'Refresh USD rate',
                'Atualizar cotação do dólar'
              )}
              title={tr('Actualizar ahora', 'Refresh now', 'Atualizar agora')}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {showConverter && effectiveConverterRate > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-300">
              {tr('Conversor rápido:', 'Quick converter:', 'Conversor rápido:')}
            </span>
            <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <span className="px-2 font-mono-num text-[11px] font-bold text-slate-500 dark:text-slate-400">
                US$
              </span>
              <input
                type="number"
                min="0"
                step="any"
                value={usdInput}
                onChange={(e) => setUsdInput(e.target.value)}
                aria-label={tr('Monto en dólares', 'Amount in USD', 'Valor em dólares')}
                className="h-7 w-24 bg-white px-2 font-mono-num text-xs font-bold text-slate-900 outline-none dark:bg-slate-900 dark:text-white"
              />
            </div>
            <span className="font-mono-num font-bold text-slate-400">=</span>
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-mono-num text-xs font-extrabold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              {targetOption.symbol} {formatRateNumber(convertedLocal, targetCurrency, locale)}{' '}
              {targetCurrency}
            </span>
          </div>

          {targetCurrency === 'ARS' && snapshot?.arsQuotes?.blue && snapshot?.arsQuotes?.oficial && (
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setArsConvMode('blue')}
                className={`rounded-md px-2 py-0.5 transition ${
                  arsConvMode === 'blue'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Blue
              </button>
              <button
                type="button"
                onClick={() => setArsConvMode('oficial')}
                className={`rounded-md px-2 py-0.5 transition ${
                  arsConvMode === 'oficial'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Oficial
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
