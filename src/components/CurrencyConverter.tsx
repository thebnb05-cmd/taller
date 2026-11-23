import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  DollarSign,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  CURRENCY_OPTIONS,
  getCurrencyOption,
  useActiveCurrency,
  type CurrencyCode,
} from '../utils/currency';
import {
  COUNTRY_BY_CURRENCY,
  FX_AUTO_POLL_MS,
  FX_UPDATE_EVENT,
  fetchUsdRates,
  formatRateNumber,
  readStoredFxSnapshot,
  updateFxRateHistory,
  type FxApiResponse,
} from '../utils/fxRates';
import { useI18n } from '../utils/i18n';

type ArsQuoteMode = 'blue' | 'oficial' | 'mep';

export const CurrencyConverter: React.FC = () => {
  const configuredCurrency = useActiveCurrency();
  const { lang, locale, tr } = useI18n();

  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<FxApiResponse | null>(() => readStoredFxSnapshot());
  const [loading, setLoading] = useState<boolean>(() => !readStoredFxSnapshot());
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // When workshop currency is USD, allow picking a comparison currency (defaults to ARS or EUR)
  const [compareCurrency, setCompareCurrency] = useState<CurrencyCode>(() =>
    lang === 'en' ? 'EUR' : 'ARS'
  );
  const [arsMode, setArsMode] = useState<ArsQuoteMode>('blue');
  const [direction, setDirection] = useState<'usd_to_local' | 'local_to_usd'>('usd_to_local');
  const [amountInput, setAmountInput] = useState('100');
  const [rateDelta, setRateDelta] = useState<{ diff: number; pct: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasSnapshotRef = useRef<boolean>(Boolean(snapshot));
  const lastUpdatedRef = useRef<number>(snapshot?.updatedAt ?? 0);

  const targetCurrency: CurrencyCode = useMemo(() => {
    return configuredCurrency === 'USD' ? compareCurrency : configuredCurrency;
  }, [compareCurrency, configuredCurrency]);

  useEffect(() => {
    hasSnapshotRef.current = Boolean(snapshot);
    lastUpdatedRef.current = snapshot?.updatedAt ?? 0;
  }, [snapshot]);

  const syncRates = useCallback(
    async (force = false) => {
      if (force) {
        setRefreshing(true);
      } else if (!hasSnapshotRef.current) {
        setLoading(true);
      }
      setErrorMsg(null);
      try {
        const data = await fetchUsdRates(force);
        hasSnapshotRef.current = true;
        lastUpdatedRef.current = data.updatedAt ?? Date.now();
        setSnapshot(data);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : tr(
                'Sin conexión para cotización.',
                'Offline for exchange rate.',
                'Sem conexão para cotação.'
              )
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tr]
  );

  useEffect(() => {
    void syncRates(false);
    const intervalId = window.setInterval(() => {
      void syncRates(false);
    }, FX_AUTO_POLL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const age = lastUpdatedRef.current ? Date.now() - lastUpdatedRef.current : Infinity;
        if (age > 90 * 1000) {
          void syncRates(false);
        }
      }
    };
    const handleOnline = () => void syncRates(false);
    const handleExternalFxUpdate = (event: Event) => {
      const detail = (event as CustomEvent<FxApiResponse>).detail;
      if (detail && detail.ok && detail.rates) {
        setSnapshot(detail);
        setLoading(false);
        setErrorMsg(null);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener(FX_UPDATE_EVENT, handleExternalFxUpdate);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(FX_UPDATE_EVENT, handleExternalFxUpdate);
    };
  }, [syncRates]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const activeRate = useMemo(() => {
    if (!snapshot?.rates) return null;
    if (targetCurrency === 'ARS' && snapshot.arsQuotes) {
      if (arsMode === 'blue' && snapshot.arsQuotes.blue?.sell) {
        return snapshot.arsQuotes.blue.sell;
      }
      if (arsMode === 'mep' && snapshot.arsQuotes.mep?.sell) {
        return snapshot.arsQuotes.mep.sell;
      }
      if (snapshot.arsQuotes.oficial?.sell) {
        return snapshot.arsQuotes.oficial.sell;
      }
    }
    const val = snapshot.rates[targetCurrency];
    return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
  }, [arsMode, snapshot, targetCurrency]);

  // Pill display rate prefers official/market rate or Blue when ARS is selected
  const headerDisplayRate = useMemo(() => {
    if (!snapshot?.rates) return null;
    if (targetCurrency === 'ARS') {
      if (arsMode === 'blue' && snapshot.arsQuotes?.blue?.sell) {
        return snapshot.arsQuotes.blue.sell;
      }
      if (arsMode === 'mep' && snapshot.arsQuotes?.mep?.sell) {
        return snapshot.arsQuotes.mep.sell;
      }
      if (snapshot.arsQuotes?.oficial?.sell) {
        return snapshot.arsQuotes.oficial.sell;
      }
    }
    return activeRate;
  }, [activeRate, arsMode, snapshot, targetCurrency]);

  useEffect(() => {
    if (!headerDisplayRate) {
      setRateDelta(null);
      return;
    }
    const historyKey =
      targetCurrency === 'ARS' ? `ARS_${arsMode.toUpperCase()}` : targetCurrency;
    const { current, prev } = updateFxRateHistory(historyKey, headerDisplayRate);
    if (prev && prev > 0 && Math.abs(current - prev) >= 0.005) {
      const diff = current - prev;
      const pct = (diff / prev) * 100;
      setRateDelta({ diff, pct });
    } else {
      setRateDelta(null);
    }
  }, [arsMode, headerDisplayRate, targetCurrency]);

  const targetOption = useMemo(() => getCurrencyOption(targetCurrency), [targetCurrency]);
  const configuredOption = useMemo(
    () => getCurrencyOption(configuredCurrency),
    [configuredCurrency]
  );
  const countryMeta = COUNTRY_BY_CURRENCY[targetCurrency];

  const updatedTimeLabel = useMemo(() => {
    if (!snapshot?.updatedAt) return '';
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(snapshot.updatedAt));
  }, [locale, snapshot?.updatedAt]);

  const parsedInput = Math.max(0, Number(amountInput.replace(',', '.')) || 0);
  const convertedResult = useMemo(() => {
    if (!activeRate || activeRate <= 0) return 0;
    return direction === 'usd_to_local'
      ? parsedInput * activeRate
      : parsedInput / activeRate;
  }, [activeRate, direction, parsedInput]);

  const selectableCompareCurrencies = useMemo(
    () => CURRENCY_OPTIONS.filter((c) => c.code !== 'USD'),
    []
  );

  const quickPresets = useMemo(
    () => (direction === 'usd_to_local' ? ['10', '50', '100', '500'] : ['10000', '50000', '100000']),
    [direction]
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={tr(
          'Cotización del dólar y conversor de moneda',
          'USD exchange rate & currency converter',
          'Cotação do dólar e conversor de moeda'
        )}
        title={
          headerDisplayRate
            ? `1 USD = ${targetOption.symbol} ${formatRateNumber(headerDisplayRate, targetCurrency, locale)}${updatedTimeLabel ? ` · ${updatedTimeLabel}` : ''}`
            : tr('Cotización del dólar', 'USD exchange rate', 'Cotação do dólar')
        }
        className={`inline-flex h-9 sm:h-10 items-center gap-1.5 rounded-xl border px-2 sm:px-2.5 text-xs font-semibold transition whitespace-nowrap ${
          open
            ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-500 dark:bg-sky-950/60 dark:text-sky-300'
            : 'border-slate-200 bg-slate-50/90 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-800'
        }`}
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400">
          <DollarSign className="h-3.5 w-3.5" />
          <span
            className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${
              errorMsg
                ? 'bg-amber-500'
                : loading
                  ? 'animate-pulse bg-sky-500'
                  : 'bg-emerald-500'
            }`}
          />
        </span>

        {loading && !headerDisplayRate ? (
          <span className="font-mono-num text-[11px] text-slate-400">USD...</span>
        ) : headerDisplayRate ? (
          <span className="flex items-center gap-1 font-mono-num">
            <span className="hidden md:inline text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-400">
              {targetCurrency === 'ARS'
                ? arsMode === 'blue'
                  ? 'Blue'
                  : arsMode === 'mep'
                    ? 'MEP'
                    : 'USD'
                : `USD/${targetCurrency}`}
            </span>
            <span className="text-[11px] sm:text-xs font-extrabold text-slate-900 dark:text-white">
              {targetOption.symbol}
              {formatRateNumber(headerDisplayRate, targetCurrency, locale, true)}
            </span>
            {rateDelta && (
              <span
                className={`hidden xl:inline-flex items-center text-[10px] font-bold ${
                  rateDelta.diff >= 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {rateDelta.diff >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-slate-500">USD</span>
        )}

        <ChevronDown
          className={`hidden sm:block h-3 w-3 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={tr(
            'Conversor y cotización del dólar en tiempo real',
            'Real-time USD rate and currency converter',
            'Conversor e cotação do dólar em tempo real'
          )}
          className="fixed inset-x-3 top-16 z-50 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-88 dark:border-slate-700 dark:bg-slate-900"
        >
          {/* Popover Header */}
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {tr('Valor del dólar hoy', 'Live USD rate', 'Valor do dólar hoje')}
                </span>
                <span className="rounded-md bg-sky-50 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                  {configuredOption.code}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                {errorMsg
                  ? errorMsg
                  : updatedTimeLabel
                    ? `${tr('Sincronizado', 'Synced', 'Sincronizado')} ${updatedTimeLabel} · ${countryMeta[lang]}`
                    : tr('Consultando ExchangeRate-API...', 'Fetching ExchangeRate-API...', 'Consultando ExchangeRate-API...')}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void syncRates(true)}
                disabled={refreshing}
                aria-label={tr('Actualizar tasa de cambio', 'Refresh exchange rate', 'Atualizar taxa')}
                title={tr('Actualizar ahora', 'Refresh now', 'Atualizar agora')}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tr('Cerrar conversor', 'Close converter', 'Fechar conversor')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Configured Workshop Currency Rate Cards */}
          <div className="mt-3 space-y-2.5">
            {configuredCurrency === 'USD' && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-800/60">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {tr('Convertir a:', 'Convert to:', 'Converter para:')}
                </span>
                <select
                  aria-label={tr('Moneda destino', 'Target currency', 'Moeda de destino')}
                  value={compareCurrency}
                  onChange={(e) => setCompareCurrency(e.target.value as CurrencyCode)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {selectableCompareCurrencies.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {COUNTRY_BY_CURRENCY[opt.code][lang]} ({opt.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {targetCurrency === 'ARS' && snapshot?.arsQuotes ? (
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    {
                      id: 'oficial' as ArsQuoteMode,
                      label: 'Oficial',
                      quote: snapshot.arsQuotes.oficial,
                    },
                    {
                      id: 'blue' as ArsQuoteMode,
                      label: 'Blue',
                      quote: snapshot.arsQuotes.blue,
                    },
                    {
                      id: 'mep' as ArsQuoteMode,
                      label: 'MEP',
                      quote: snapshot.arsQuotes.mep,
                    },
                  ] as const
                ).map((item) => {
                  if (!item.quote) return null;
                  const selected = arsMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setArsMode(item.id)}
                      className={`rounded-xl border px-2 py-1.5 text-left transition ${
                        selected
                          ? 'border-[#0072BB] bg-sky-50/80 dark:border-sky-500 dark:bg-sky-950/50'
                          : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                        {item.label}
                      </div>
                      <div className="font-mono-num text-xs font-extrabold text-slate-900 dark:text-white">
                        ${formatRateNumber(item.quote.sell, 'ARS', locale)}
                      </div>
                      <div className="font-mono-num text-[10px] text-slate-400">
                        C ${formatRateNumber(item.quote.buy, 'ARS', locale, true)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : activeRate ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 dark:border-emerald-900/60 dark:bg-emerald-950/40">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  1 USD ({tr('Dólar', 'Dollar', 'Dólar')})
                </span>
                <span className="font-mono-num text-sm font-extrabold text-slate-900 dark:text-white">
                  {targetOption.symbol} {formatRateNumber(activeRate, targetCurrency, locale)}{' '}
                  {targetCurrency}
                </span>
              </div>
            ) : null}

            {/* Interactive Two-Way Converter */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  {direction === 'usd_to_local'
                    ? `USD → ${targetCurrency}`
                    : `${targetCurrency} → USD`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDirection((prev) =>
                      prev === 'usd_to_local' ? 'local_to_usd' : 'usd_to_local'
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>{tr('Invertir', 'Swap', 'Inverter')}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900">
                  <span className="px-2.5 font-mono-num text-xs font-bold text-slate-500 dark:text-slate-400">
                    {direction === 'usd_to_local' ? 'US$' : targetOption.symbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    aria-label={tr('Monto a convertir', 'Amount to convert', 'Valor a converter')}
                    className="h-9 w-full min-w-0 bg-transparent pr-2.5 font-mono-num text-sm font-bold text-slate-900 outline-none dark:text-white"
                  />
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {tr('Equivale a', 'Equals', 'Equivale a')}
                </span>
                <span className="font-mono-num text-sm font-extrabold text-[#0072BB] dark:text-sky-400">
                  {direction === 'usd_to_local'
                    ? `${targetOption.symbol} ${formatRateNumber(convertedResult, targetCurrency, locale)} ${targetCurrency}`
                    : `US$ ${new Intl.NumberFormat(locale, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(convertedResult)} USD`}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {quickPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmountInput(preset)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 font-mono-num text-[10px] font-semibold text-slate-600 transition hover:border-[#0072BB] hover:text-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
                  >
                    {direction === 'usd_to_local' ? `US$${preset}` : `${targetOption.symbol}${Number(preset).toLocaleString(locale)}`}
                  </button>
                ))}
              </div>
            </div>

            {snapshot?.source && (
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  {tr('Moneda taller:', 'Workshop currency:', 'Moeda da oficina:')}{' '}
                  {configuredOption.name}
                </span>
                <span className="truncate font-mono-num">{snapshot.source}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
