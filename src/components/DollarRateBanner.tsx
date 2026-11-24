import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  DollarSign,
  Link2,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import type { WorkshopProfile } from '../types/workshop';
import {
  CURRENCY_OPTIONS,
  getCurrencyOption,
  useActiveCurrency,
  type CurrencyCode,
} from '../utils/currency';
import { formatCurrency } from '../utils/formatters';
import {
  COUNTRY_BY_CURRENCY,
  DEFAULT_FX_PROVIDER,
  FX_AUTO_POLL_MS,
  FX_UPDATE_EVENT,
  fetchUsdRates,
  formatRateNumber,
  readStoredFxSnapshot,
  resolveLiveRateToBase,
  updateFxRateHistory,
  type ArsQuoteSource,
  type FxApiResponse,
} from '../utils/fxRates';
import { syncWorkshopProfileFxRates } from '../hooks/useFxAutoSyncService';
import { useI18n } from '../utils/i18n';
import { sanitizeDbErrorMessage } from '../utils/validation';
import { parseWorkshopMeta, syncSecondaryCurrenciesToProfile } from '../utils/workshopMeta';
import { useToast } from './ToastProvider';

interface DollarRateBannerProps {
  profile?: WorkshopProfile | null;
  onOpenSettings?: () => void;
}

export const DollarRateBanner: React.FC<DollarRateBannerProps> = ({
  profile,
  onOpenSettings,
}) => {
  const { notify } = useToast();
  const activeCurrency = useActiveCurrency();
  const { lang, locale, tr } = useI18n();

  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency = profile ? workshopMeta.currency : activeCurrency;
  const secondaryCurrencies = workshopMeta.secondaryCurrencies;
  const fxAutoSync = Boolean(workshopMeta.fxAutoSync);
  const persistedArsSource: ArsQuoteSource = workshopMeta.fxArsSource || 'blue';
  const configuredFxProvider = workshopMeta.fxProvider || DEFAULT_FX_PROVIDER;

  const [overrideCurrency, setOverrideCurrency] = useState<'AUTO' | CurrencyCode>('AUTO');
  const [selectedArsSource, setSelectedArsSource] = useState<ArsQuoteSource>(persistedArsSource);
  const [snapshot, setSnapshot] = useState<FxApiResponse | null>(() => readStoredFxSnapshot());
  const [loading, setLoading] = useState<boolean>(() => !readStoredFxSnapshot());
  const [refreshing, setRefreshing] = useState(false);
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConverter, setShowConverter] = useState(false);
  const [usdInput, setUsdInput] = useState('100');
  const [rateDelta, setRateDelta] = useState<{ diff: number; pct: number } | null>(null);

  const containerRef = useRef<HTMLElement | null>(null);
  const hasSnapshotRef = useRef<boolean>(Boolean(snapshot));
  const lastUpdatedRef = useRef<number>(snapshot?.updatedAt ?? 0);

  useEffect(() => {
    setSelectedArsSource(persistedArsSource);
  }, [persistedArsSource]);

  const targetCurrency: CurrencyCode = useMemo(() => {
    if (overrideCurrency !== 'AUTO') return overrideCurrency;
    return baseCurrency === 'USD' ? (lang === 'en' ? 'EUR' : 'ARS') : baseCurrency;
  }, [baseCurrency, lang, overrideCurrency]);

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
        const data = await fetchUsdRates({ force, provider: configuredFxProvider });
        hasSnapshotRef.current = true;
        lastUpdatedRef.current = data.updatedAt ?? Date.now();
        setSnapshot(data);
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
    },
    [configuredFxProvider, tr]
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

  const currentRate = useMemo(() => {
    if (!snapshot?.rates) return null;
    if (targetCurrency === 'ARS' && snapshot.arsQuotes) {
      if (selectedArsSource === 'oficial' && snapshot.arsQuotes.oficial?.sell) {
        return snapshot.arsQuotes.oficial.sell;
      }
      if (selectedArsSource === 'mep' && snapshot.arsQuotes.mep?.sell) {
        return snapshot.arsQuotes.mep.sell;
      }
      if (selectedArsSource === 'blue' && snapshot.arsQuotes.blue?.sell) {
        return snapshot.arsQuotes.blue.sell;
      }
      if (snapshot.arsQuotes.oficial?.sell) {
        return snapshot.arsQuotes.oficial.sell;
      }
    }
    const val = snapshot.rates[targetCurrency];
    return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
  }, [selectedArsSource, snapshot, targetCurrency]);

  useEffect(() => {
    if (!currentRate) {
      setRateDelta(null);
      return;
    }
    const historyKey =
      targetCurrency === 'ARS' ? `ARS_${selectedArsSource.toUpperCase()}` : targetCurrency;
    const { current, prev } = updateFxRateHistory(historyKey, currentRate);
    if (prev && prev > 0 && Math.abs(current - prev) >= 0.005) {
      const diff = current - prev;
      const pct = (diff / prev) * 100;
      setRateDelta({ diff, pct });
    } else {
      setRateDelta(null);
    }
  }, [currentRate, selectedArsSource, targetCurrency]);

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

  const effectiveConverterRate = currentRate || 0;
  const parsedUsd = Math.max(0, Number(usdInput.replace(',', '.')) || 0);
  const convertedLocal = parsedUsd * effectiveConverterRate;

  const secondarySyncSummary = useMemo(() => {
    if (!snapshot?.rates) {
      return { anyOutdated: false, rows: secondaryCurrencies.map((c) => ({ ...c, liveRate: null as number | null, outdated: false })) };
    }
    let anyOutdated = false;
    const rows = secondaryCurrencies.map((item) => {
      const liveRate = resolveLiveRateToBase(item.code, baseCurrency, snapshot, selectedArsSource);
      const outdated = Boolean(
        liveRate && liveRate > 0 && Math.abs(liveRate - item.rate) / item.rate > 0.0005
      );
      if (outdated) anyOutdated = true;
      return { ...item, liveRate, outdated };
    });
    return { anyOutdated, rows };
  }, [baseCurrency, secondaryCurrencies, selectedArsSource, snapshot]);

  const handleSelectArsSource = async (nextSource: ArsQuoteSource) => {
    setSelectedArsSource(nextSource);
    if (!profile || !fxAutoSync) return;
    setSyncingProfile(true);
    try {
      const result = await syncWorkshopProfileFxRates(profile, {
        force: false,
        arsSourceOverride: nextSource,
        fxAutoSyncOverride: true,
        ensureDefaultSecondary: true,
        defaultEnsureCode: baseCurrency === 'USD' ? targetCurrency : 'USD',
        persistAlways: true,
      });
      setSnapshot(result.snapshot);
      notify(
        tr(
          `Monedas secundarias actualizadas con dólar ${nextSource.toUpperCase()}.`,
          `Secondary currencies updated using ${nextSource.toUpperCase()} rate.`,
          `Moedas secundárias atualizadas com dólar ${nextSource.toUpperCase()}.`
        )
      );
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudieron actualizar las tasas.'), 'error');
    } finally {
      setSyncingProfile(false);
    }
  };

  const handleSyncSecondaryRates = async () => {
    if (!profile) return;
    setSyncingProfile(true);
    try {
      const result = await syncWorkshopProfileFxRates(profile, {
        force: true,
        arsSourceOverride: selectedArsSource,
        ensureDefaultSecondary: true,
        defaultEnsureCode: baseCurrency === 'USD' ? targetCurrency : 'USD',
        persistAlways: true,
      });
      setSnapshot(result.snapshot);

      if (result.items.length === 0) {
        notify(
          tr(
            'Agregá una moneda secundaria desde Configuración para sincronizar.',
            'Add a secondary currency in Settings to sync.',
            'Adicione uma moeda secundária nas Configurações para sincronizar.'
          ),
          'error'
        );
        return;
      }

      const summary = result.items
        .map((item) => {
          const opt = getCurrencyOption(item.code);
          return `1 ${opt.code} = ${formatCurrency(item.rate, baseCurrency)}`;
        })
        .join(' · ');

      notify(
        tr(
          `Tasas sincronizadas: ${summary}`,
          `Rates synced: ${summary}`,
          `Taxas sincronizadas: ${summary}`
        )
      );
    } catch (err) {
      notify(
        sanitizeDbErrorMessage(
          err,
          tr(
            'No se pudieron sincronizar las monedas secundarias.',
            'Could not sync secondary currencies.',
            'Não foi possível sincronizar as moedas secundárias.'
          )
        ),
        'error'
      );
    } finally {
      setSyncingProfile(false);
    }
  };

  const handleToggleAutoSync = async () => {
    if (!profile) return;
    const nextAuto = !fxAutoSync;
    setSyncingProfile(true);
    try {
      if (nextAuto) {
        const result = await syncWorkshopProfileFxRates(profile, {
          force: false,
          arsSourceOverride: selectedArsSource,
          fxAutoSyncOverride: true,
          ensureDefaultSecondary: true,
          defaultEnsureCode: baseCurrency === 'USD' ? targetCurrency : 'USD',
          persistAlways: true,
        });
        setSnapshot(result.snapshot);
      } else {
        await syncSecondaryCurrenciesToProfile(profile, secondaryCurrencies, {
          fxAutoSync: false,
          fxArsSource: selectedArsSource,
        });
      }
      notify(
        nextAuto
          ? tr(
              'Auto-sincronización activada con Monedas secundarias.',
              'Auto-sync enabled for secondary currencies.',
              'Sincronização automática ativada para moedas secundárias.'
            )
          : tr(
              'Auto-sincronización pausada (tasas manuales).',
              'Auto-sync paused (manual rates).',
              'Sincronização automática pausada (taxas manuais).'
            )
      );
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo cambiar la sincronización.'), 'error');
    } finally {
      setSyncingProfile(false);
    }
  };

  const defaultSyncPreviewRate = useMemo(() => {
    if (!snapshot?.rates || secondaryCurrencies.length > 0) return null;
    const fallbackCode: CurrencyCode = baseCurrency === 'USD' ? targetCurrency : 'USD';
    if (fallbackCode === baseCurrency) return null;
    const rate = resolveLiveRateToBase(fallbackCode, baseCurrency, snapshot, selectedArsSource);
    return rate ? { code: fallbackCode, rate } : null;
  }, [baseCurrency, secondaryCurrencies.length, selectedArsSource, snapshot, targetCurrency]);

  return (
    <section
      ref={containerRef}
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
                <button
                  type="button"
                  onClick={() => void handleSelectArsSource('oficial')}
                  title={tr(
                    'Usar dólar Oficial como referencia para sincronizar',
                    'Use Oficial rate as sync reference',
                    'Usar dólar Oficial como referência'
                  )}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition ${
                    selectedArsSource === 'oficial'
                      ? 'border-[#0072BB] bg-sky-50 ring-2 ring-[#0072BB]/15 dark:border-sky-400 dark:bg-sky-950/60'
                      : 'border-sky-200/80 bg-sky-50/70 hover:bg-sky-100/70 dark:border-sky-900/60 dark:bg-sky-950/40 dark:hover:bg-sky-950/60'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-sky-800 dark:text-sky-300">
                    Oficial
                  </span>
                  <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                    ${formatRateNumber(snapshot.arsQuotes.oficial.sell, 'ARS', locale)}
                  </span>
                </button>
              )}
              {snapshot.arsQuotes.blue && (
                <button
                  type="button"
                  onClick={() => void handleSelectArsSource('blue')}
                  title={tr(
                    'Usar dólar Blue como referencia para sincronizar',
                    'Use Blue rate as sync reference',
                    'Usar dólar Blue como referência'
                  )}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition ${
                    selectedArsSource === 'blue'
                      ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/15 dark:border-emerald-400 dark:bg-emerald-950/60'
                      : 'border-emerald-200/80 bg-emerald-50/70 hover:bg-emerald-100/70 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                    Blue
                  </span>
                  <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-300">
                    C ${formatRateNumber(snapshot.arsQuotes.blue.buy, 'ARS', locale)}
                  </span>
                  <span className="font-mono-num font-bold text-emerald-800 dark:text-emerald-200">
                    V ${formatRateNumber(snapshot.arsQuotes.blue.sell, 'ARS', locale)}
                  </span>
                </button>
              )}
              {snapshot.arsQuotes.mep && (
                <button
                  type="button"
                  onClick={() => void handleSelectArsSource('mep')}
                  title={tr(
                    'Usar dólar MEP como referencia para sincronizar',
                    'Use MEP rate as sync reference',
                    'Usar dólar MEP como referência'
                  )}
                  className={`hidden sm:inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition ${
                    selectedArsSource === 'mep'
                      ? 'border-[#0072BB] bg-sky-50 ring-2 ring-[#0072BB]/15 dark:border-sky-400 dark:bg-sky-950/60'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    MEP
                  </span>
                  <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                    ${formatRateNumber(snapshot.arsQuotes.mep.sell, 'ARS', locale)}
                  </span>
                </button>
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
                {tr('Auto', 'Auto', 'Auto')} ({baseCurrency === 'USD' ? (lang === 'en' ? 'EUR' : 'ARS') : baseCurrency})
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

      {/* Sync bar with Workshop Secondary Currencies & Conversion Rates */}
      {profile && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {tr('Monedas secundarias:', 'Secondary currencies:', 'Moedas secundárias:')}
            </span>

            {secondarySyncSummary.rows.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono-num tabular-nums">
                {secondarySyncSummary.rows.map((item, idx) => {
                  const opt = getCurrencyOption(item.code);
                  return (
                    <span key={item.code} className="inline-flex items-center gap-1">
                      {idx > 0 && (
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                          ·
                        </span>
                      )}
                      <span className="font-bold text-slate-900 dark:text-white">
                        1 {opt.code} = {formatCurrency(item.rate, baseCurrency)}
                      </span>
                      {item.outdated && item.liveRate ? (
                        <span className="text-amber-700 dark:text-amber-300">
                          (→ {formatCurrency(item.liveRate, baseCurrency)})
                        </span>
                      ) : item.liveRate ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          ✓
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">
                {defaultSyncPreviewRate
                  ? tr(
                      `Sin configurar · Listo para agregar 1 ${defaultSyncPreviewRate.code} = ${formatCurrency(defaultSyncPreviewRate.rate, baseCurrency)}`,
                      `Not configured · Ready to add 1 ${defaultSyncPreviewRate.code} = ${formatCurrency(defaultSyncPreviewRate.rate, baseCurrency)}`,
                      `Não configurado · Pronto para adicionar 1 ${defaultSyncPreviewRate.code} = ${formatCurrency(defaultSyncPreviewRate.rate, baseCurrency)}`
                    )
                  : tr(
                      'Sin monedas secundarias configuradas.',
                      'No secondary currencies configured.',
                      'Nenhuma moeda secundária configurada.'
                    )}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={syncingProfile || (loading && !snapshot)}
              onClick={() => void handleSyncSecondaryRates()}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition whitespace-nowrap disabled:opacity-50 ${
                secondarySyncSummary.anyOutdated || secondaryCurrencies.length === 0
                  ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] hover:bg-sky-100 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-950/70'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Link2 className="h-3 w-3 shrink-0" />
              <span>
                {syncingProfile
                  ? tr('Sincronizando...', 'Syncing...', 'Sincronizando...')
                  : secondaryCurrencies.length === 0 && defaultSyncPreviewRate
                    ? tr(
                        `Sincronizar ${defaultSyncPreviewRate.code}`,
                        `Sync ${defaultSyncPreviewRate.code}`,
                        `Sincronizar ${defaultSyncPreviewRate.code}`
                      )
                    : tr('Sincronizar tasas', 'Sync rates', 'Sincronizar taxas')}
              </span>
            </button>

            <button
              type="button"
              disabled={syncingProfile}
              onClick={() => void handleToggleAutoSync()}
              aria-pressed={fxAutoSync}
              title={tr(
                'Actualizar automáticamente las tasas de conversión de monedas secundarias cuando cambia la cotización',
                'Automatically keep secondary currency rates synced when FX updates',
                'Atualizar automaticamente as taxas de moedas secundárias'
              )}
              className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition whitespace-nowrap disabled:opacity-50 ${
                fxAutoSync
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {fxAutoSync && <Check className="h-3 w-3 shrink-0" />}
              <span>{tr('Auto-sync', 'Auto-sync', 'Auto-sync')}</span>
            </button>

            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                title={tr(
                  'Abrir Monedas secundarias y tasas de conversión',
                  'Open Secondary currencies & conversion rates',
                  'Abrir Moedas secundárias e taxas de conversão'
                )}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <Settings2 className="h-3 w-3 shrink-0" />
                <span className="hidden sm:inline">
                  {tr('Configurar', 'Configure', 'Configurar')}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

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
                onClick={() => void handleSelectArsSource('blue')}
                className={`rounded-md px-2 py-0.5 transition ${
                  selectedArsSource === 'blue'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Blue
              </button>
              <button
                type="button"
                onClick={() => void handleSelectArsSource('oficial')}
                className={`rounded-md px-2 py-0.5 transition ${
                  selectedArsSource === 'oficial'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Oficial
              </button>
              {snapshot.arsQuotes.mep && (
                <button
                  type="button"
                  onClick={() => void handleSelectArsSource('mep')}
                  className={`rounded-md px-2 py-0.5 transition ${
                    selectedArsSource === 'mep'
                      ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  MEP
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
