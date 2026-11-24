import { useEffect, useMemo, useRef } from 'react';
import type { WorkshopProfile } from '../types/workshop';
import type { CurrencyCode, SecondaryCurrencyConfig } from '../utils/currency';
import {
  DEFAULT_FX_INTERVAL_MINUTES,
  DEFAULT_FX_PROVIDER,
  buildSyncedSecondaryCurrencies,
  fetchUsdRates,
  readFxServiceStatus,
  writeFxServiceStatus,
  type ArsQuoteSource,
  type FxApiResponse,
  type FxProviderId,
  type FxSyncIntervalMinutes,
} from '../utils/fxRates';
import {
  parseWorkshopMeta,
  syncSecondaryCurrenciesToProfile,
} from '../utils/workshopMeta';

export interface SyncWorkshopFxOptions {
  force?: boolean;
  providerOverride?: FxProviderId;
  arsSourceOverride?: ArsQuoteSource;
  fxAutoSyncOverride?: boolean;
  fxIntervalOverride?: FxSyncIntervalMinutes;
  ensureDefaultSecondary?: boolean;
  defaultEnsureCode?: CurrencyCode;
  persistAlways?: boolean;
}

export interface SyncWorkshopFxResult {
  snapshot: FxApiResponse;
  items: SecondaryCurrencyConfig[];
  changed: boolean;
  persisted: boolean;
}

export async function syncWorkshopProfileFxRates(
  profile: WorkshopProfile,
  options: SyncWorkshopFxOptions = {}
): Promise<SyncWorkshopFxResult> {
  const meta = parseWorkshopMeta(profile);
  const provider = options.providerOverride ?? meta.fxProvider ?? DEFAULT_FX_PROVIDER;
  const arsSource = options.arsSourceOverride ?? meta.fxArsSource ?? 'blue';
  const intervalMinutes =
    options.fxIntervalOverride ?? meta.fxIntervalMinutes ?? DEFAULT_FX_INTERVAL_MINUTES;
  const nextAutoSync = options.fxAutoSyncOverride ?? Boolean(meta.fxAutoSync);
  const previousStatus = readFxServiceStatus();

  try {
    const snapshot = await fetchUsdRates({
      force: Boolean(options.force),
      provider,
    });

    const ensureCode: CurrencyCode | null =
      options.ensureDefaultSecondary && meta.secondaryCurrencies.length === 0
        ? options.defaultEnsureCode ?? (meta.currency === 'USD' ? 'ARS' : 'USD')
        : null;

    const { items, changed } = buildSyncedSecondaryCurrencies(
      meta.currency,
      meta.secondaryCurrencies,
      snapshot,
      arsSource,
      ensureCode
    );

    const shouldPersist = Boolean(changed || options.persistAlways);
    if (shouldPersist) {
      await syncSecondaryCurrenciesToProfile(profile, items, {
        fxAutoSync: nextAutoSync,
        fxArsSource: arsSource,
        fxProvider: provider,
        fxIntervalMinutes: intervalMinutes,
      });
    }

    const now = Date.now();
    writeFxServiceStatus({
      lastCheckedAt: now,
      lastUpdatedAt: changed ? now : previousStatus.lastUpdatedAt ?? snapshot.updatedAt ?? now,
      provider: snapshot.provider ?? provider,
      source: snapshot.source ?? null,
      error: null,
    });

    return {
      snapshot,
      items,
      changed,
      persisted: shouldPersist,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'No se pudo consultar la API de tipos de cambio.';
    writeFxServiceStatus({
      lastCheckedAt: Date.now(),
      lastUpdatedAt: previousStatus.lastUpdatedAt,
      provider,
      source: previousStatus.source,
      error: message,
    });
    throw err;
  }
}

export function useFxAutoSyncService(profile?: WorkshopProfile | null): void {
  const meta = useMemo(() => (profile ? parseWorkshopMeta(profile) : null), [profile]);
  const fxAutoSync = Boolean(meta?.fxAutoSync);
  const fxProvider = meta?.fxProvider ?? DEFAULT_FX_PROVIDER;
  const fxIntervalMinutes = meta?.fxIntervalMinutes ?? DEFAULT_FX_INTERVAL_MINUTES;
  const fxArsSource = meta?.fxArsSource ?? 'blue';
  const baseCurrency = meta?.currency ?? 'ARS';
  const secondaryCount = meta?.secondaryCurrencies.length ?? 0;

  const profileRef = useRef<WorkshopProfile | null | undefined>(profile);
  const inFlightRef = useRef(false);
  const lastConfigKeyRef = useRef('');

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    if (!profile?.id || !fxAutoSync) return;

    const intervalMs = fxIntervalMinutes * 60 * 1000;
    const configKey = `${profile.id}:${baseCurrency}:${fxProvider}:${fxArsSource}:${fxIntervalMinutes}:${secondaryCount}`;
    const configChanged = lastConfigKeyRef.current !== configKey;
    lastConfigKeyRef.current = configKey;

    const runCycle = async (forceFetch: boolean) => {
      const currentProfile = profileRef.current;
      if (!currentProfile || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await syncWorkshopProfileFxRates(currentProfile, {
          force: forceFetch,
          ensureDefaultSecondary: true,
        });
      } catch {
        // Status error recorded inside syncWorkshopProfileFxRates; retry next cycle
      } finally {
        inFlightRef.current = false;
      }
    };

    const status = readFxServiceStatus();
    const age = status.lastCheckedAt ? Date.now() - status.lastCheckedAt : Infinity;
    if (configChanged || age >= intervalMs || status.provider !== fxProvider) {
      void runCycle(false);
    }

    const timerId = window.setInterval(() => {
      void runCycle(true);
    }, intervalMs);

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const latestStatus = readFxServiceStatus();
      const latestAge = latestStatus.lastCheckedAt
        ? Date.now() - latestStatus.lastCheckedAt
        : Infinity;
      if (latestAge >= intervalMs) {
        void runCycle(false);
      }
    };

    const handleOnline = () => {
      void runCycle(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(timerId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [
    profile?.id,
    fxAutoSync,
    fxProvider,
    fxIntervalMinutes,
    fxArsSource,
    baseCurrency,
    secondaryCount,
  ]);
}
