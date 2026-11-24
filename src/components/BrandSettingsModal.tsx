import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Coins,
  Copy,
  Crown,
  Download,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Terminal,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import {
  clampStr,
  fetchOwnerRows,
  handleDbError,
  OperationType,
  stripUndefined,
  supabase,
  updateRow,
} from '../lib/db';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import {
  CURRENCY_OPTIONS,
  convertFromBaseCurrency,
  getCurrencyOption,
  sanitizeCurrencyCode,
  sanitizeSecondaryCurrencies,
  setActiveCurrency,
  type CurrencyCode,
  type SecondaryCurrencyConfig,
} from '../utils/currency';
import {
  getActiveLanguage,
  getIntlLocale,
  LANGUAGE_OPTIONS,
  sanitizeLanguageCode,
  setActiveLanguage,
  useI18n,
  type LanguageCode,
} from '../utils/i18n';
import { compressImageToDataUrl, formatCurrency, todayISO } from '../utils/formatters';
import {
  DEFAULT_FX_INTERVAL_MINUTES,
  DEFAULT_FX_PROVIDER,
  FX_INTERVAL_OPTIONS,
  FX_PROVIDER_OPTIONS,
  FX_SERVICE_STATUS_EVENT,
  fetchUsdRates,
  readFxServiceStatus,
  readStoredFxSnapshot,
  resolveLiveRateToBase,
  sanitizeFxIntervalMinutes,
  sanitizeFxProvider,
  writeFxServiceStatus,
  type ArsQuoteSource,
  type FxApiResponse,
  type FxProviderId,
  type FxServiceStatus,
  type FxSyncIntervalMinutes,
} from '../utils/fxRates';
import {
  isPrivatePreviewOrigin,
  normalizeTrackingBaseUrl,
  resolveTrackingBaseUrl,
} from '../utils/tracking';
import {
  parseWorkshopMeta,
  sanitizeTechnicianList,
  serializeWorkshopSubtitle,
} from '../utils/workshopMeta';
import {
  isValidEmail,
  sanitizeDbErrorMessage,
  sanitizeEmail,
  sanitizeHexColor,
  sanitizeImageDataUrl,
  sanitizePhone,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import type { WorkshopProfile } from '../types/workshop';
import {
  clearMercadoPagoConfigCache,
  diagnosePlatformMercadoPagoToken,
  testPlatformSubscriptionCheckout,
  verifyPlatformMercadoPagoToken,
  type MpPlatformDiagnosticResult,
  type MpPlatformTokenVerificationResult,
  type MpTestCheckoutResult,
} from '../utils/mercadoPago';
import { clearTransferConfigCache } from '../utils/payment';
import {
  getPlanDisplayName,
  getSubscriptionRemaining,
  type SignedSubscriptionRecord,
} from '../utils/subscription';
import { ModalShell } from './ModalShell';
import { BrandMark } from './BrandMark';
import { PaymentSettingsPanel } from './PaymentSettingsPanel';
import { useToast } from './ToastProvider';

interface BrandSettingsModalProps {
  open: boolean;
  onClose: () => void;
  profile: WorkshopProfile;
  userEmail?: string | null;
  subscriptionRecord?: SignedSubscriptionRecord | null;
  nowMs?: number;
  onOpenSubscription?: () => void;
}

interface SecondaryCurrencyRow {
  code: CurrencyCode;
  rate: string;
}

export const BrandSettingsModal: React.FC<BrandSettingsModalProps> = ({
  open,
  onClose,
  profile,
  userEmail,
  subscriptionRecord,
  nowMs = Date.now(),
  onOpenSubscription,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const initialMeta = parseWorkshopMeta(profile);
  const [brandName, setBrandName] = useState(profile.brandName || 'TH3 BNB');
  const [subtitleText, setSubtitleText] = useState(initialMeta.subtitle);
  const [businessPhone, setBusinessPhone] = useState(profile.businessPhone || '');
  const [businessAddress, setBusinessAddress] = useState(profile.businessAddress || '');
  const [hours, setHours] = useState(initialMeta.hours);
  const [social, setSocial] = useState(initialMeta.social);
  const [taxId, setTaxId] = useState(initialMeta.taxId);
  const [businessEmail, setBusinessEmail] = useState(initialMeta.businessEmail);
  const [footerNote, setFooterNote] = useState(initialMeta.footerNote);
  const [currency, setCurrency] = useState<CurrencyCode>(initialMeta.currency);
  const [language, setLanguage] = useState<LanguageCode>(() =>
    initialMeta.hasExplicitLanguage ? initialMeta.language : getActiveLanguage()
  );
  const [languageBeforeOpen, setLanguageBeforeOpen] = useState<LanguageCode>(getActiveLanguage);
  const [secondaryRows, setSecondaryRows] = useState<SecondaryCurrencyRow[]>(() =>
    initialMeta.secondaryCurrencies.map((item) => ({
      code: item.code,
      rate: String(item.rate),
    }))
  );
  const [fxAutoSync, setFxAutoSync] = useState<boolean>(Boolean(initialMeta.fxAutoSync));
  const [fxArsSource, setFxArsSource] = useState<ArsQuoteSource>(
    initialMeta.fxArsSource || 'blue'
  );
  const [fxProvider, setFxProvider] = useState<FxProviderId>(
    initialMeta.fxProvider || DEFAULT_FX_PROVIDER
  );
  const [fxIntervalMinutes, setFxIntervalMinutes] = useState<FxSyncIntervalMinutes>(
    initialMeta.fxIntervalMinutes || DEFAULT_FX_INTERVAL_MINUTES
  );
  const [fxSnapshot, setFxSnapshot] = useState<FxApiResponse | null>(() => readStoredFxSnapshot());
  const [fxServiceStatus, setFxServiceStatus] = useState<FxServiceStatus>(() =>
    readFxServiceStatus()
  );
  const [syncingFxRates, setSyncingFxRates] = useState(false);
  const initOpenProfileRef = useRef<string | null>(null);
  const [wordColors, setWordColors] = useState<string[]>(
    profile.wordColors || ['#0F172A', '#0072BB']
  );
  const [logoDataUrl, setLogoDataUrl] = useState(profile.logoDataUrl || '');
  const [logoScale, setLogoScale] = useState(profile.logoScale ?? 100);
  const [logoTransparent, setLogoTransparent] = useState(profile.logoTransparent ?? true);
  const [receiptTerms, setReceiptTerms] = useState(
    profile.receiptTerms ?? DEFAULT_RECEIPT_TERMS
  );
  const [trackingBaseUrl, setTrackingBaseUrl] = useState(
    resolveTrackingBaseUrl(profile.trackingBaseUrl)
  );
  const [techniciansEnabled, setTechniciansEnabled] = useState(initialMeta.techniciansEnabled);
  const [technicians, setTechnicians] = useState<string[]>(initialMeta.technicians);
  const [newTechnicianName, setNewTechnicianName] = useState('');
  const [latestMpConfig, setLatestMpConfig] = useState(initialMeta.mercadoPago);
  const [platformCheck, setPlatformCheck] = useState<MpPlatformTokenVerificationResult | null>(null);
  const [checkingPlatformToken, setCheckingPlatformToken] = useState(false);
  const [testCheckout, setTestCheckout] = useState<MpTestCheckoutResult | null>(null);
  const [creatingTestCheckout, setCreatingTestCheckout] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<MpPlatformDiagnosticResult | null>(null);
  const [runningDiagnostic, setRunningDiagnostic] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');
  const [exportingBackup, setExportingBackup] = useState(false);

  const isPlatformAdmin = Boolean(
    subscriptionRecord?.payload?.isExemptAnnual ||
      (userEmail || profile.email || '').trim().toLowerCase() === 'thebnb05@gmail.com'
  );

  const runPlatformTokenCheck = useCallback(async (showToast = false) => {
    setCheckingPlatformToken(true);
    try {
      const result = await verifyPlatformMercadoPagoToken();
      setPlatformCheck(result);
      if (showToast) {
        if (result.valid) {
          notify('Conexión Exitosa con Mercado Pago.');
        } else {
          notify(result.error || 'Error en Credenciales de Mercado Pago.', 'error');
        }
      }
    } finally {
      setCheckingPlatformToken(false);
    }
  }, [notify]);

  const handleRunDiagnostic = useCallback(async () => {
    setRunningDiagnostic(true);
    try {
      const diag = await diagnosePlatformMercadoPagoToken();
      setDiagnosticResult(diag);
      if (diag.ok) {
        notify('Diagnóstico completado: variable y permisos correctos (registrado en consola).');
      } else {
        notify('Diagnóstico completado con observaciones (revisá el detalle y la consola).', 'error');
      }
    } finally {
      setRunningDiagnostic(false);
    }
  }, [notify]);

  const handleCopyDiagnosticLog = useCallback(async () => {
    if (!diagnosticResult || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticResult, null, 2));
      notify('Reporte de diagnóstico copiado al portapapeles.');
    } catch {
      notify('No se pudo copiar el reporte.', 'error');
    }
  }, [diagnosticResult, notify]);

  const handleCreateTestCheckout = useCallback(async () => {
    setCreatingTestCheckout(true);
    setTestCheckout(null);
    try {
      const res = await testPlatformSubscriptionCheckout(
        `${window.location.origin}/?mp_test=return`
      );
      setTestCheckout(res);
      if (res.ok && res.checkoutUrl) {
        notify('Link de prueba ($100) generado en Mercado Pago.');
      } else {
        notify(res.error || 'No se pudo generar el link de prueba.', 'error');
      }
    } finally {
      setCreatingTestCheckout(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!open) {
      initOpenProfileRef.current = null;
      return;
    }

    const handleServiceStatus = (event: Event) => {
      const detail = (event as CustomEvent<FxServiceStatus>).detail;
      if (detail) setFxServiceStatus(detail);
    };
    window.addEventListener(FX_SERVICE_STATUS_EVENT, handleServiceStatus);
    setFxServiceStatus(readFxServiceStatus());

    if (initOpenProfileRef.current === profile.id) {
      return () => {
        window.removeEventListener(FX_SERVICE_STATUS_EVENT, handleServiceStatus);
      };
    }
    initOpenProfileRef.current = profile.id;

    const meta = parseWorkshopMeta(profile);
    setBrandName(profile.brandName || 'TH3 BNB');
    setSubtitleText(meta.subtitle);
    setBusinessPhone(profile.businessPhone || '');
    setBusinessAddress(profile.businessAddress || '');
    setHours(meta.hours);
    setSocial(meta.social);
    setTaxId(meta.taxId);
    setBusinessEmail(meta.businessEmail);
    setFooterNote(meta.footerNote);
    setCurrency(meta.currency);
    const resolvedLang = meta.hasExplicitLanguage ? meta.language : getActiveLanguage();
    setLanguage(resolvedLang);
    setLanguageBeforeOpen(getActiveLanguage());
    setSecondaryRows(
      meta.secondaryCurrencies.map((item) => ({
        code: item.code,
        rate: String(item.rate),
      }))
    );
    setFxAutoSync(Boolean(meta.fxAutoSync));
    setFxArsSource(meta.fxArsSource || 'blue');
    setFxProvider(meta.fxProvider || DEFAULT_FX_PROVIDER);
    setFxIntervalMinutes(meta.fxIntervalMinutes || DEFAULT_FX_INTERVAL_MINUTES);
    setFxSnapshot(readStoredFxSnapshot());
    let active = true;
    void fetchUsdRates({ force: false, provider: meta.fxProvider || DEFAULT_FX_PROVIDER })
      .then((data) => {
        if (active) setFxSnapshot(data);
      })
      .catch(() => {});
    setWordColors(profile.wordColors || ['#0F172A', '#0072BB']);
    setLogoDataUrl(profile.logoDataUrl || '');
    setLogoScale(profile.logoScale ?? 100);
    setLogoTransparent(profile.logoTransparent ?? true);
    setReceiptTerms(profile.receiptTerms ?? DEFAULT_RECEIPT_TERMS);
    setTrackingBaseUrl(resolveTrackingBaseUrl(profile.trackingBaseUrl));
    setTechniciansEnabled(meta.techniciansEnabled);
    setTechnicians(meta.technicians);
    setNewTechnicianName('');
    setLatestMpConfig(meta.mercadoPago);
    setTestCheckout(null);
    setDiagnosticResult(null);
    setShowDeleteAccountConfirm(false);
    setDeleteConfirmText('');
    setDeleteAccountError('');
    setDeletingAccount(false);
    if (isPlatformAdmin) {
      void runPlatformTokenCheck(false);
    }
    return () => {
      active = false;
      window.removeEventListener(FX_SERVICE_STATUS_EVENT, handleServiceStatus);
    };
  }, [open, profile, isPlatformAdmin, runPlatformTokenCheck]);

  const ownerDisplayName = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  const handleAddTechnician = (rawName?: string) => {
    const candidate = sanitizePlainLine(rawName ?? newTechnicianName, 50)
      .replace(/:/g, ' ')
      .trim();
    if (!candidate) return;
    if (technicians.some((t) => t.toLowerCase() === candidate.toLowerCase())) {
      notify('Ese técnico ya está en la lista.', 'error');
      return;
    }
    if (technicians.length >= 25) {
      notify('Podés cargar hasta 25 técnicos.', 'error');
      return;
    }
    setTechnicians((prev) => sanitizeTechnicianList([...prev, candidate]));
    if (!rawName) setNewTechnicianName('');
  };

  const handleRemoveTechnician = (name: string) => {
    setTechnicians((prev) => prev.filter((t) => t !== name));
  };

  const baseCurrencyOption = getCurrencyOption(currency);
  const unusedSecondaryOptions = CURRENCY_OPTIONS.filter(
    (opt) => opt.code !== currency && !secondaryRows.some((row) => row.code === opt.code)
  );

  const handleBaseCurrencyChange = (nextRaw: string) => {
    const nextBase = sanitizeCurrencyCode(nextRaw);
    setCurrency(nextBase);
    setSecondaryRows((prev) => prev.filter((row) => row.code !== nextBase));
  };

  const handleAddSecondaryCurrency = () => {
    const nextOption = unusedSecondaryOptions[0];
    if (!nextOption) return;
    const liveRate = resolveLiveRateToBase(nextOption.code, currency, fxSnapshot, fxArsSource);
    setSecondaryRows((prev) => [
      ...prev,
      { code: nextOption.code, rate: liveRate ? String(liveRate) : '' },
    ]);
  };

  const handleUpdateSecondaryCode = (index: number, nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === currency) return;
    const liveRate = resolveLiveRateToBase(nextCode, currency, fxSnapshot, fxArsSource);
    setSecondaryRows((prev) =>
      prev.map((row, idx) =>
        idx === index
          ? {
              ...row,
              code: nextCode,
              rate: liveRate ? String(liveRate) : row.rate,
            }
          : row
      )
    );
  };

  const handleUpdateSecondaryRate = (index: number, nextRate: string) => {
    setSecondaryRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, rate: nextRate } : row))
    );
  };

  const handleRemoveSecondaryCurrency = (index: number) => {
    setSecondaryRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSyncFxIntoRows = async (
    sourceOverride?: ArsQuoteSource,
    providerOverride?: FxProviderId
  ) => {
    const effectiveSource = sourceOverride ?? fxArsSource;
    const effectiveProvider = providerOverride ?? fxProvider;
    setSyncingFxRates(true);
    try {
      const latest = await fetchUsdRates({ force: true, provider: effectiveProvider });
      setFxSnapshot(latest);
      const now = Date.now();
      const nextStatus: FxServiceStatus = {
        lastCheckedAt: now,
        lastUpdatedAt: now,
        provider: latest.provider ?? effectiveProvider,
        source: latest.source ?? null,
        error: null,
      };
      writeFxServiceStatus(nextStatus);
      setFxServiceStatus(nextStatus);

      setSecondaryRows((prev) => {
        if (prev.length === 0 && currency !== 'USD') {
          const usdRate = resolveLiveRateToBase('USD', currency, latest, effectiveSource);
          return usdRate ? [{ code: 'USD', rate: String(usdRate) }] : prev;
        }
        return prev.map((row) => {
          const live = resolveLiveRateToBase(row.code, currency, latest, effectiveSource);
          return live ? { ...row, rate: String(live) } : row;
        });
      });
      notify(
        tr(
          `Tasas consultadas (${latest.source || effectiveProvider}). Guardá para aplicar.`,
          `Rates fetched (${latest.source || effectiveProvider}). Save to apply.`,
          `Taxas consultadas (${latest.source || effectiveProvider}). Salve para aplicar.`
        )
      );
    } catch (err) {
      const msg = sanitizeDbErrorMessage(
        err,
        tr(
          'No se pudo obtener la cotización en vivo.',
          'Could not fetch live exchange rate.',
          'Não foi possível obter a cotação ao vivo.'
        )
      );
      const prevStatus = readFxServiceStatus();
      const nextStatus: FxServiceStatus = {
        ...prevStatus,
        lastCheckedAt: Date.now(),
        provider: effectiveProvider,
        error: msg,
      };
      writeFxServiceStatus(nextStatus);
      setFxServiceStatus(nextStatus);
      notify(msg, 'error');
    } finally {
      setSyncingFxRates(false);
    }
  };

  const words = (brandName || 'TH3 BNB').trim().split(/\s+/).filter(Boolean);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Usá una imagen PNG, JPG o WebP.', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify('El logo no puede superar los 2 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file, 480, 0.88);
      const safeLogo = sanitizeImageDataUrl(compressed, 700000);
      if (!safeLogo) {
        notify('El logo procesado no tiene un formato válido o supera el límite.', 'error');
        return;
      }
      setLogoDataUrl(safeLogo);
    } catch {
      notify('No se pudo cargar la imagen del logo.', 'error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = sanitizeEmail(businessEmail, 100);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      notify('El email de contacto del taller no tiene un formato válido.', 'error');
      return;
    }
    const rawTracking = trackingBaseUrl.trim();
    const cleanedTrackingUrl = normalizeTrackingBaseUrl(rawTracking);
    if (rawTracking && !cleanedTrackingUrl) {
      notify('La dirección del sitio de seguimiento debe empezar con https:// o http://', 'error');
      return;
    }

    const safeCurrency = sanitizeCurrencyCode(currency);
    const safeLanguage = sanitizeLanguageCode(language);
    const parsedSecondary: SecondaryCurrencyConfig[] = [];
    const seenSecondary = new Set<CurrencyCode>();

    for (const row of secondaryRows) {
      if (row.code === safeCurrency) continue;
      if (seenSecondary.has(row.code)) {
        notify(`La moneda secundaria ${row.code} está repetida.`, 'error');
        return;
      }
      const normalizedRate = row.rate.trim().replace(',', '.');
      const numericRate = Number(normalizedRate);
      if (!normalizedRate || !Number.isFinite(numericRate) || numericRate <= 0) {
        const rowOption = getCurrencyOption(row.code);
        notify(
          `Ingresá una tasa de conversión válida mayor a 0 para ${rowOption.name} (${rowOption.code}).`,
          'error'
        );
        return;
      }
      seenSecondary.add(row.code);
      parsedSecondary.push({ code: row.code, rate: numericRate });
    }

    setSaving(true);
    const path = `workshop_profiles/${profile.id}`;
    try {
      const safeTrackingBaseUrl = isPrivatePreviewOrigin(cleanedTrackingUrl)
        ? ''
        : clampStr(cleanedTrackingUrl, 250);
      const safeSecondaryCurrencies = sanitizeSecondaryCurrencies(parsedSecondary, safeCurrency);
      const existingMeta = parseWorkshopMeta(profile);
      const encodedSubtitle = serializeWorkshopSubtitle({
        subtitle: sanitizePlainLine(subtitleText, 80),
        hours: sanitizePlainLine(hours, 100),
        social: sanitizePlainLine(social, 100),
        taxId: sanitizePlainLine(taxId, 60),
        businessEmail: cleanEmail,
        footerNote: sanitizePlainLine(footerNote, 180),
        currency: safeCurrency,
        language: safeLanguage,
        secondaryCurrencies: safeSecondaryCurrencies,
        fxAutoSync,
        fxArsSource,
        fxProvider,
        fxIntervalMinutes,
        techniciansEnabled,
        technicians: sanitizeTechnicianList(technicians),
        mercadoPago: latestMpConfig ?? existingMeta.mercadoPago,
        subscription: existingMeta.subscription,
      });
      const safeColors = wordColors
        .slice(0, 12)
        .map((c, idx) => sanitizeHexColor(c, idx === 0 ? '#0F172A' : '#0072BB'));
      const safeScale = Math.min(200, Math.max(50, Math.round(Number(logoScale) || 100)));
      const safeLogoDataUrl = logoDataUrl ? sanitizeImageDataUrl(logoDataUrl, 700000) : '';

      const payload = stripUndefined({
        brandName: sanitizePlainLine(brandName || 'TH3 BNB', 80) || 'TH3 BNB',
        subtitle: clampStr(encodedSubtitle, 8000),
        businessPhone: sanitizePhone(businessPhone, 50),
        businessAddress: sanitizePlainLine(businessAddress, 200),
        wordColors: safeColors,
        logoDataUrl: safeLogoDataUrl,
        logoScale: safeScale,
        logoTransparent,
        receiptTerms: sanitizeText(receiptTerms, 2000),
        trackingBaseUrl: safeTrackingBaseUrl,
        updatedAt: new Date().toISOString(),
      });
      await updateRow('workshop_profiles', profile.id, payload);
      setActiveCurrency(safeCurrency);
      setActiveLanguage(safeLanguage);
      notify('Configuración del taller actualizada.');
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'Error al guardar la configuración.'), 'error');
      void handleDbError(err, OperationType.UPDATE, path).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR' || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteAccountError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setDeleteAccountError('Tu sesión expiró. Volvé a iniciar sesión e intentá de nuevo.');
        setDeletingAccount(false);
        return;
      }

      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ confirmation: 'ELIMINAR' }),
      });

      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        setDeleteAccountError(
          payload.error || 'No se pudo eliminar la cuenta en este momento.'
        );
        setDeletingAccount(false);
        return;
      }

      const ownerKey = profile.ownerId || profile.id;
      clearTransferConfigCache(ownerKey);
      clearMercadoPagoConfigCache(ownerKey);
      try {
        window.localStorage.removeItem(`th3bnb_onboarding_v1_${ownerKey}`);
        window.localStorage.removeItem(`th3bnb_mp_cfg_v1_${ownerKey}`);
        window.localStorage.removeItem(`th3bnb_transfer_cfg_v1_${ownerKey}`);
        window.localStorage.removeItem('th3bnb_install_ping_ts');
        window.sessionStorage.removeItem('th3bnb_pending_sub_v1');
      } catch {
        // Ignorar restricciones de almacenamiento
      }

      await supabase.auth.signOut().catch(() => {});
      notify('Tu cuenta y todos los datos del taller fueron eliminados.');
      onClose();
    } catch (err) {
      setDeleteAccountError(
        err instanceof Error ? err.message : 'Error de red al eliminar la cuenta.'
      );
      setDeletingAccount(false);
    }
  };

  const handleExportFullBackup = async () => {
    if (exportingBackup) return;
    const ownerKey = profile.ownerId || profile.id;
    if (!ownerKey) {
      notify('No se pudo identificar la sesión del taller.', 'error');
      return;
    }
    setExportingBackup(true);
    try {
      const [clients, repairs, products, sales, purchases, suppliers, tasks, publicTickets] =
        await Promise.all([
          fetchOwnerRows<Record<string, unknown>>('clients', ownerKey),
          fetchOwnerRows<Record<string, unknown>>('repairs', ownerKey),
          fetchOwnerRows<Record<string, unknown>>('products', ownerKey),
          fetchOwnerRows<Record<string, unknown>>('sales', ownerKey),
          fetchOwnerRows<Record<string, unknown>>('purchases', ownerKey),
          fetchOwnerRows<Record<string, unknown>>('suppliers', ownerKey),
          fetchOwnerRows<Record<string, unknown>>('tasks', ownerKey),
          fetchOwnerRows<Record<string, unknown>>('public_tickets', ownerKey),
        ]);

      const parsedMeta = parseWorkshopMeta(profile);
      const sanitizedSubtitle = serializeWorkshopSubtitle({
        subtitle: parsedMeta.subtitle,
        hours: parsedMeta.hours,
        social: parsedMeta.social,
        taxId: parsedMeta.taxId,
        businessEmail: parsedMeta.businessEmail,
        footerNote: parsedMeta.footerNote,
        currency: parsedMeta.currency,
        secondaryCurrencies: parsedMeta.secondaryCurrencies,
        fxAutoSync: parsedMeta.fxAutoSync,
        fxArsSource: parsedMeta.fxArsSource,
        fxProvider: parsedMeta.fxProvider,
        fxIntervalMinutes: parsedMeta.fxIntervalMinutes,
        techniciansEnabled: parsedMeta.techniciansEnabled,
        technicians: parsedMeta.technicians,
      });

      const safeProfile = {
        ...profile,
        subtitle: sanitizedSubtitle,
      };

      const totalRecords =
        clients.length +
        repairs.length +
        products.length +
        sales.length +
        purchases.length +
        suppliers.length +
        tasks.length +
        publicTickets.length;

      const backupPayload = {
        app: profile.brandName || 'TH3 BNB',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        baseCurrency: parsedMeta.currency,
        summary: {
          clients: clients.length,
          repairs: repairs.length,
          products: products.length,
          sales: sales.length,
          purchases: purchases.length,
          suppliers: suppliers.length,
          tasks: tasks.length,
          publicTickets: publicTickets.length,
          totalRecords,
        },
        profile: safeProfile,
        data: {
          clients,
          repairs,
          products,
          sales,
          purchases,
          suppliers,
          tasks,
          publicTickets,
        },
      };

      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `respaldo-taller-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      notify(`Copia de seguridad descargada (${totalRecords} registros).`);
    } catch (err) {
      notify(
        sanitizeDbErrorMessage(err, 'No se pudo generar la copia de seguridad.'),
        'error'
      );
    } finally {
      setExportingBackup(false);
    }
  };

  const handleCancel = () => {
    setActiveLanguage(languageBeforeOpen);
    onClose();
  };

  return (
    <ModalShell
      open={open}
      onClose={handleCancel}
      title={tr('Configuración', 'Settings', 'Configurações')}
      subtitle={tr(
        'Administrá tu taller, idioma, marca, logo y los datos visibles en cada boleta.',
        'Manage your workshop, language, brand, logo, and receipt details.',
        'Gerencie sua oficina, idioma, marca, logotipo e os dados exibidos em cada comprovante.'
      )}
      maxWidth="2xl"
    >
      <form onSubmit={handleSave} className="space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5 dark:border-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
            <Store className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white font-display">
              {tr(
                'Taller · Marca y comprobantes',
                'Workshop · Brand & receipts',
                'Oficina · Marca e comprovantes'
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr(
                'Todos estos datos se reflejan automáticamente en tus boletas A4, 80mm y PDF.',
                'All of these details automatically appear on your A4, 80mm, and PDF receipts.',
                'Todos esses dados aparecem automaticamente nos seus comprovantes A4, 80mm e PDF.'
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                <Globe className="h-4 w-4" />
              </span>
              <div>
                <label
                  htmlFor="workshop-language-select"
                  className="block text-xs font-bold text-slate-800 dark:text-slate-100"
                >
                  {tr(
                    'Idioma / Lenguaje del sistema',
                    'System language',
                    'Idioma do sistema'
                  )}
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(
                    'Elegí el idioma de los menús, botones, fechas y pantallas del taller.',
                    'Choose the language for menus, buttons, dates, and workshop screens.',
                    'Escolha o idioma dos menus, botões, datas e telas da oficina.'
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <select
              id="workshop-language-select"
              value={language}
              onChange={(e) => {
                const nextLang = sanitizeLanguageCode(e.target.value);
                setLanguage(nextLang);
                setActiveLanguage(nextLang);
              }}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {tr('Nombre o marca del taller', 'Workshop name or brand', 'Nome ou marca da oficina')}
            </label>
            <input
              type="text"
              maxLength={60}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {tr('Subtítulo / Rubro del taller', 'Subtitle / Workshop specialty', 'Subtítulo / Ramo da oficina')}
            </label>
            <input
              type="text"
              maxLength={80}
              value={subtitleText}
              onChange={(e) => setSubtitleText(e.target.value)}
              placeholder={tr(
                'Ej: Servicio técnico especializado',
                'Ex: Specialized repair service',
                'Ex: Assistência técnica especializada'
              )}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {tr('Teléfono del local', 'Shop phone', 'Telefone da loja')}
            </label>
            <input
              type="tel"
              maxLength={40}
              value={businessPhone}
              onChange={(e) => setBusinessPhone(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {tr('Dirección del local', 'Shop address', 'Endereço da loja')}
            </label>
            <input
              type="text"
              maxLength={120}
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <Coins className="h-4 w-4" />
              </span>
              <div>
                <label
                  htmlFor="workshop-currency-select"
                  className="block text-xs font-bold text-slate-800 dark:text-slate-100"
                >
                  {tr(
                    'Moneda base del taller, presupuestos y boletas',
                    'Base currency for workshop, quotes & receipts',
                    'Moeda base da oficina, orçamentos e comprovantes'
                  )}
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(
                    'Se aplica en presupuestos, señas, inventario, ventas, WhatsApp y boletas A4, 80mm y PDF.',
                    'Applied to quotes, deposits, inventory, sales, WhatsApp, and A4, 80mm & PDF receipts.',
                    'Aplicada em orçamentos, sinais, estoque, vendas, WhatsApp e comprovantes A4, 80mm e PDF.'
                  )}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono-num text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300">
              {tr('Ej:', 'Ex:', 'Ex:')} {formatCurrency(15000, currency)}
            </div>
          </div>

          <div>
            <select
              id="workshop-currency-select"
              value={currency}
              onChange={(e) => handleBaseCurrencyChange(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="border-t border-slate-200/80 pt-3.5 dark:border-slate-700/80">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {tr(
                    'Monedas secundarias y tasas de conversión',
                    'Secondary currencies & exchange rates',
                    'Moedas secundárias e taxas de conversão'
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(
                    `Definí monedas alternativas y su equivalencia respecto a ${baseCurrencyOption.code} (${baseCurrencyOption.symbol}).`,
                    `Set alternative currencies and their exchange rate relative to ${baseCurrencyOption.code} (${baseCurrencyOption.symbol}).`,
                    `Defina moedas alternativas e sua equivalência em relação a ${baseCurrencyOption.code} (${baseCurrencyOption.symbol}).`
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleSyncFxIntoRows()}
                  disabled={syncingFxRates}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950/80"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingFxRates ? 'animate-spin' : ''}`} />
                  {syncingFxRates
                    ? tr('Consultando API...', 'Fetching API...', 'Consultando API...')
                    : tr('Consultar API ahora', 'Fetch API now', 'Consultar API agora')}
                </button>
                <button
                  type="button"
                  onClick={handleAddSecondaryCurrency}
                  disabled={unusedSecondaryOptions.length === 0}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#0072BB]/30 bg-white px-2.5 text-xs font-semibold text-[#0072BB] transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-700/50 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('Agregar moneda', 'Add currency', 'Adicionar moeda')}
                </button>
              </div>
            </div>

            <div className="mt-2.5 space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={fxAutoSync}
                    onChange={(e) => {
                      const nextVal = e.target.checked;
                      setFxAutoSync(nextVal);
                      if (nextVal && secondaryRows.length === 0 && currency !== 'USD' && fxSnapshot) {
                        const usdRate = resolveLiveRateToBase('USD', currency, fxSnapshot, fxArsSource);
                        if (usdRate) {
                          setSecondaryRows([{ code: 'USD', rate: String(usdRate) }]);
                        }
                      }
                    }}
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <span>
                    {tr(
                      'Servicio automático de actualización periódica',
                      'Automatic periodic rate update service',
                      'Serviço automático de atualização periódica'
                    )}
                  </span>
                </label>

                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    fxAutoSync
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {fxAutoSync
                    ? tr('Servicio activo', 'Service active', 'Serviço ativo')
                    : tr('Manual', 'Manual', 'Manual')}
                </span>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="workshop-fx-provider-select"
                    className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                  >
                    {tr('Proveedor de tipos de cambio', 'Exchange rate API provider', 'Provedor de câmbio')}
                  </label>
                  <select
                    id="workshop-fx-provider-select"
                    value={fxProvider}
                    onChange={(e) => {
                      const nextProv = sanitizeFxProvider(e.target.value);
                      setFxProvider(nextProv);
                      void handleSyncFxIntoRows(fxArsSource, nextProv);
                    }}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {FX_PROVIDER_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {tr(opt.es, opt.en, opt.pt)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="workshop-fx-interval-select"
                    className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                  >
                    {tr('Frecuencia de actualización', 'Update frequency', 'Frequência de atualização')}
                  </label>
                  <select
                    id="workshop-fx-interval-select"
                    value={fxIntervalMinutes}
                    disabled={!fxAutoSync}
                    onChange={(e) =>
                      setFxIntervalMinutes(sanitizeFxIntervalMinutes(Number(e.target.value)))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-900 outline-none focus:border-[#0072BB] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {FX_INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.minutes} value={opt.minutes}>
                        {tr(opt.es, opt.en, opt.pt)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] dark:border-slate-800">
                <div className="min-w-0 flex-1 text-slate-500 dark:text-slate-400">
                  {fxServiceStatus.error ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {fxServiceStatus.error}
                    </span>
                  ) : (
                    <span className="truncate">
                      {tr('Fuente activa:', 'Active feed:', 'Fonte ativa:')}{' '}
                      <strong className="font-mono-num text-slate-700 dark:text-slate-200">
                        {fxSnapshot?.source || fxServiceStatus.source || 'ExchangeRate-API'}
                      </strong>
                      {(fxServiceStatus.lastCheckedAt || fxSnapshot?.updatedAt) && (
                        <>
                          {' · '}
                          {new Intl.DateTimeFormat(getIntlLocale(), {
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(
                            new Date(fxServiceStatus.lastCheckedAt || fxSnapshot?.updatedAt || Date.now())
                          )}
                        </>
                      )}
                    </span>
                  )}
                  {fxProvider === 'fixer' && fxSnapshot?.configuredKeys && !fxSnapshot.configuredKeys.fixer && (
                    <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                      {tr(
                        'FIXER_API_KEY no definida en el servidor: usa Frankfurter (BCE) + ExchangeRate-API como respaldo.',
                        'FIXER_API_KEY not set on server: using Frankfurter (ECB) + ExchangeRate-API fallback.',
                        'FIXER_API_KEY não definida no servidor: usando Frankfurter (BCE) + ExchangeRate-API.'
                      )}
                    </div>
                  )}
                </div>

                {(currency === 'ARS' || secondaryRows.some((r) => r.code === 'ARS')) && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Ref. ARS:', 'ARS ref:', 'Ref. ARS:')}
                    </span>
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold dark:bg-slate-800">
                      {(['blue', 'oficial', 'mep'] as const).map((src) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => {
                            setFxArsSource(src);
                            if (fxSnapshot) {
                              setSecondaryRows((prev) =>
                                prev.map((row) => {
                                  const live = resolveLiveRateToBase(row.code, currency, fxSnapshot, src);
                                  return live ? { ...row, rate: String(live) } : row;
                                })
                              );
                            }
                          }}
                          className={`rounded-md px-2 py-0.5 uppercase transition ${
                            fxArsSource === src
                              ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {src}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {secondaryRows.length === 0 ? (
              <p className="mt-2.5 rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-2.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                {tr(
                  `No hay monedas secundarias configuradas. Podés agregar por ejemplo USD o EUR con su cotización frente a ${baseCurrencyOption.code}.`,
                  `No secondary currencies configured. You can add e.g. USD or EUR with their rate against ${baseCurrencyOption.code}.`,
                  `Nenhuma moeda secundária configurada. Você pode adicionar por exemplo USD ou EUR com a cotação frente a ${baseCurrencyOption.code}.`
                )}
              </p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {secondaryRows.map((row, index) => {
                  const rowOption = getCurrencyOption(row.code);
                  const rowChoices = CURRENCY_OPTIONS.filter(
                    (opt) =>
                      opt.code !== currency &&
                      (opt.code === row.code || !secondaryRows.some((other) => other.code === opt.code))
                  );
                  const parsedRate = Number(row.rate.trim().replace(',', '.'));
                  const hasValidRate =
                    row.rate.trim().length > 0 && Number.isFinite(parsedRate) && parsedRate > 0;
                  const convertedSample = hasValidRate
                    ? convertFromBaseCurrency(15000, parsedRate)
                    : 0;
                  const liveRate = resolveLiveRateToBase(row.code, currency, fxSnapshot, fxArsSource);
                  const liveDiffers = Boolean(
                    liveRate && (!hasValidRate || Math.abs(liveRate - parsedRate) / parsedRate > 0.0005)
                  );

                  return (
                    <div
                      key={`${row.code}-${index}`}
                      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_auto] sm:items-center">
                        <select
                          aria-label={`Moneda secundaria ${index + 1}`}
                          value={row.code}
                          onChange={(e) => handleUpdateSecondaryCode(index, e.target.value)}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {rowChoices.map((opt) => (
                            <option key={opt.code} value={opt.code}>
                              {opt.label}
                            </option>
                          ))}
                        </select>

                        <div className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 focus-within:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800">
                          <span className="shrink-0 font-mono-num text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            1 {rowOption.symbol} =
                          </span>
                          <input
                            type="number"
                            min="0.000001"
                            step="any"
                            inputMode="decimal"
                            aria-label={`Tasa de conversión para ${rowOption.code}`}
                            value={row.rate}
                            onChange={(e) => handleUpdateSecondaryRate(index, e.target.value)}
                            placeholder="Ej: 1200"
                            className="w-full min-w-0 bg-transparent font-mono-num text-xs font-semibold text-slate-900 outline-none dark:text-white"
                          />
                          <span className="shrink-0 font-mono-num text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            {baseCurrencyOption.symbol}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveSecondaryCurrency(index)}
                          aria-label={`Quitar ${rowOption.name}`}
                          className="inline-flex h-10 w-full items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50/70 px-2.5 text-xs font-medium text-red-600 transition hover:bg-red-100 sm:w-10 sm:px-0 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sm:hidden">Quitar</span>
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        {hasValidRate ? (
                          <span className="font-mono-num text-emerald-700 dark:text-emerald-300">
                            Ref: {formatCurrency(15000, currency)} ≈{' '}
                            {formatCurrency(convertedSample, row.code)}
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">
                            Ingresá cuántos {baseCurrencyOption.code} equivalen a 1 {rowOption.code}.
                          </span>
                        )}

                        {liveRate && (
                          <div className="flex items-center gap-1.5 font-mono-num">
                            <span className="text-slate-500 dark:text-slate-400">
                              {tr('Dólar hoy:', 'Live rate:', 'Dólar hoje:')}{' '}
                              {formatCurrency(liveRate, currency)}
                            </span>
                            {liveDiffers && (
                              <button
                                type="button"
                                onClick={() => handleUpdateSecondaryRate(index, String(liveRate))}
                                className="rounded-md border border-[#0072BB]/30 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                              >
                                {tr('Aplicar', 'Apply', 'Aplicar')}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-sky-200/80 bg-sky-50/40 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
          <div>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
              {tr(
                'Opciones extra para mostrar en cada boleta',
                'Extra details shown on each receipt',
                'Opções extras para exibir em cada comprovante'
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr(
                'Completá las que quieras imprimir en boletas de reparación, ventas, lotes y PDF.',
                'Fill in any details you want printed on repair, sales, batch and PDF receipts.',
                'Preencha os campos que deseja imprimir nos comprovantes de reparo, vendas, lotes e PDF.'
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Horarios de atención', 'Business hours', 'Horário de atendimento')}
              </label>
              <input
                type="text"
                maxLength={100}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder={tr(
                  'Ej: Lun a Vie 9:30 a 19:00 · Sáb 10 a 14',
                  'Ex: Mon–Fri 9:30 AM – 7:00 PM · Sat 10 AM – 2 PM',
                  'Ex: Seg a Sex 9:30 às 19:00 · Sáb 10 às 14'
                )}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Instagram / Web', 'Instagram / Website', 'Instagram / Site')}
              </label>
              <input
                type="text"
                maxLength={100}
                value={social}
                onChange={(e) => setSocial(e.target.value)}
                placeholder={tr(
                  'Ej: @th3bnb.servicio · www.th3bnb.com',
                  'Ex: @myworkshop · www.myworkshop.com',
                  'Ex: @minhaoficina · www.minhaoficina.com'
                )}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr(
                  'CUIT / Documento comercial (opcional)',
                  'Tax ID / Business ID (optional)',
                  'CNPJ / Documento comercial (opcional)'
                )}
              </label>
              <input
                type="text"
                maxLength={60}
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder={tr('Ej: CUIT 20-12345678-9', 'Ex: EIN 12-3456789', 'Ex: CNPJ 12.345.678/0001-90')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Email de contacto', 'Contact email', 'E-mail de contato')}
              </label>
              <input
                type="email"
                maxLength={100}
                value={businessEmail}
                onChange={(e) => setBusinessEmail(e.target.value)}
                placeholder={tr('Ej: contacto@tutaller.com', 'Ex: contact@yourshop.com', 'Ex: contato@suaoficina.com')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr(
                  'Garantía o mensaje destacado al pie de boleta',
                  'Warranty or footer note on receipt',
                  'Garantia ou mensagem de rodapé no comprovante'
                )}
              </label>
              <input
                type="text"
                maxLength={180}
                value={footerNote}
                onChange={(e) => setFooterNote(e.target.value)}
                placeholder={tr(
                  'Ej: Garantía 30 días sobre el trabajo realizado · ¡Gracias por elegirnos!',
                  'Ex: 30-day warranty on service performed · Thank you for choosing us!',
                  'Ex: Garantia de 30 dias sobre o serviço realizado · Obrigado pela preferência!'
                )}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                <Users className="h-4 w-4" />
              </span>
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {tr(
                    'Asignación de técnicos (opcional)',
                    'Technician assignment (optional)',
                    'Atribuição de técnicos (opcional)'
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(
                    'Si trabajás solo como dueño del taller podés dejarlo desactivado. Activándolo elegís qué técnico toma cada orden.',
                    'If you work solo you can leave this off. Enable it to assign a technician to each order.',
                    'Se você trabalha sozinho pode deixar desativado. Ao ativar, escolha qual técnico assume cada ordem.'
                  )}
                </p>
              </div>
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
              <input
                type="checkbox"
                checked={techniciansEnabled}
                onChange={(e) => setTechniciansEnabled(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {techniciansEnabled
                  ? tr('Activo', 'Enabled', 'Ativo')
                  : tr('Opcional', 'Optional', 'Opcional')}
              </span>
            </label>
          </div>

          {techniciansEnabled && (
            <div className="space-y-2.5 border-t border-slate-200/80 pt-3 dark:border-slate-700/80">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  maxLength={50}
                  value={newTechnicianName}
                  onChange={(e) => setNewTechnicianName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTechnician();
                    }
                  }}
                  placeholder={tr(
                    'Nombre del técnico (ej: Marcos, Sofía...)',
                    'Technician name (ex: Alex, Sofia...)',
                    'Nome do técnico (ex: Marcos, Sofia...)'
                  )}
                  className="h-10 min-w-[180px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => handleAddTechnician()}
                  disabled={!newTechnicianName.trim()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('Agregar', 'Add', 'Adicionar')}
                </button>
                {ownerDisplayName &&
                  !technicians.some((t) => t.toLowerCase() === ownerDisplayName.toLowerCase()) && (
                    <button
                      type="button"
                      onClick={() => handleAddTechnician(ownerDisplayName)}
                      className="inline-flex h-10 items-center gap-1 rounded-xl border border-[#0072BB]/30 bg-white px-3 text-xs font-semibold text-[#0072BB] hover:bg-sky-50 dark:border-sky-700/50 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {tr('Agregarme', 'Add myself', 'Me adicionar')} ({ownerDisplayName})
                    </button>
                  )}
              </div>

              {technicians.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                  {tr(
                    'Agregá al menos un técnico para habilitar el selector en nuevas órdenes y filtros.',
                    'Add at least one technician to enable the selector on new orders and filters.',
                    'Adicione pelo menos um técnico para ativar o seletor em novas ordens e filtros.'
                  )}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {technicians.map((tech) => (
                    <span
                      key={tech}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <span>{tech}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTechnician(tech)}
                        aria-label={`Quitar técnico ${tech}`}
                        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <PaymentSettingsPanel
          ownerId={profile.ownerId || profile.id}
          profile={profile}
          onSaved={(saved) => setLatestMpConfig(saved)}
        />

        {subscriptionRecord && (() => {
          const subPayload = subscriptionRecord.payload;
          const rem = getSubscriptionRemaining(subPayload, nowMs);
          const isExempt = subPayload.isExemptAnnual;
          const expiryStr = new Date(subPayload.expiresAt).toLocaleDateString(getIntlLocale(), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
          return (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
                isExempt
                  ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                  : rem.isExpired
                    ? 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30'
                    : 'border-sky-200 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/30'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                    isExempt
                      ? 'bg-emerald-600 text-white'
                      : rem.isExpired
                        ? 'bg-red-600 text-white'
                        : 'bg-[#0072BB] text-white'
                  }`}
                >
                  {isExempt ? (
                    <Crown className="h-4 w-4" />
                  ) : (
                    <CalendarClock className="h-4 w-4" />
                  )}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      {getPlanDisplayName(subPayload.planId, isExempt)}
                    </h4>
                    <span className="rounded-md bg-white/90 px-2 py-0.5 font-mono-num text-[10px] font-bold text-slate-800 dark:bg-slate-900 dark:text-slate-100">
                      {rem.shortLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                    {isExempt
                      ? `${tr('Renovación anual automática sin costo ($0) el', 'Auto annual renewal at $0 on', 'Renovação anual automática gratuita em')} ${expiryStr}`
                      : `${rem.detailLabel} · ${tr('Vence el', 'Expires on', 'Vence em')} ${expiryStr}`}
                  </p>
                </div>
              </div>

              {onOpenSubscription && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSubscription();
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c]"
                >
                  {tr('Ver planes / Suscripción', 'View plans / Subscription', 'Ver planos / Assinatura')}
                </button>
              )}
            </div>
          );
        })()}

        {isPlatformAdmin && (
        <div
          className={`space-y-3 rounded-2xl border p-4 ${
            platformCheck?.valid
              ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30'
              : platformCheck && !platformCheck.valid
                ? 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30'
                : 'border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/40'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                  platformCheck?.valid
                    ? 'bg-emerald-600 text-white'
                    : platformCheck && !platformCheck.valid
                      ? 'bg-red-600 text-white'
                      : 'bg-[#0072BB] text-white'
                }`}
              >
                {checkingPlatformToken ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : platformCheck?.valid ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : platformCheck && !platformCheck.valid ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                    Validación Mercado Pago (Suscripciones)
                  </h4>
                  {checkingPlatformToken ? (
                    <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/70 dark:text-sky-300">
                      Verificando...
                    </span>
                  ) : platformCheck?.valid ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Conexión Exitosa
                    </span>
                  ) : platformCheck ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/70 dark:text-red-200">
                      <AlertTriangle className="h-3 w-3" />
                      Error en Credenciales
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 font-mono-num text-[11px] text-slate-600 dark:text-slate-300">
                  PLATFORM_MERCADOPAGO_ACCESS_TOKEN
                  {platformCheck?.valid && platformCheck.mode
                    ? ` · ${platformCheck.mode === 'test' ? 'Modo Prueba' : 'Modo Producción'}`
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={checkingPlatformToken}
                onClick={() => void runPlatformTokenCheck(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
              >
                {checkingPlatformToken ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {checkingPlatformToken ? 'Validando...' : 'Validar Mercado Pago'}
              </button>

              <button
                type="button"
                disabled={runningDiagnostic}
                onClick={() => void handleRunDiagnostic()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {runningDiagnostic ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Terminal className="h-3.5 w-3.5" />
                )}
                {runningDiagnostic ? 'Diagnosticando...' : 'Diagnóstico'}
              </button>
            </div>
          </div>

          {platformCheck?.valid ? (
            <div className="space-y-2.5 rounded-xl border border-emerald-200/80 bg-white/85 px-3 py-2.5 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-slate-900/70 dark:text-emerald-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    Conexión Exitosa
                    {platformCheck.account
                      ? ` · ${
                          platformCheck.account.nickname ||
                          platformCheck.account.email ||
                          platformCheck.account.sellerId
                        }${platformCheck.account.siteId ? ` (${platformCheck.account.siteId})` : ''}`
                      : ''}
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-85">
                    {platformCheck.subscriptionsReady
                      ? 'Credenciales verificadas y API de Suscripciones operativa.'
                      : 'Credenciales verificadas correctamente con Mercado Pago.'}
                  </div>
                </div>

                {platformCheck.account && (
                  <button
                    type="button"
                    disabled={creatingTestCheckout}
                    onClick={() => void handleCreateTestCheckout()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
                  >
                    {creatingTestCheckout ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3 w-3" />
                    )}
                    {creatingTestCheckout ? 'Generando...' : 'Probar link de pago ($100)'}
                  </button>
                )}
              </div>

              {testCheckout && (
                <div
                  className={`rounded-lg border px-2.5 py-2 text-[11px] ${
                    testCheckout.ok && testCheckout.checkoutUrl
                      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                      : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                  }`}
                >
                  {testCheckout.ok && testCheckout.checkoutUrl ? (
                    <div className="space-y-1">
                      <div className="font-semibold">
                        Link de prueba generado correctamente ({testCheckout.mode === 'test' ? 'Modo Prueba' : 'Modo Producción'}).
                      </div>
                      <a
                        href={testCheckout.checkoutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#0072BB] underline dark:text-sky-300"
                      >
                        Abrir checkout de Mercado Pago ($100)
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <div className="text-[10px] opacity-80">
                        Nota: Mercado Pago no permite pagar con la misma cuenta receptora; para probar un pago real usá otra cuenta o modo incógnito.
                      </div>
                    </div>
                  ) : (
                    <div>{testCheckout.error || 'No se pudo generar el link de prueba.'}</div>
                  )}
                </div>
              )}
            </div>
          ) : platformCheck ? (
            <div className="rounded-xl border border-red-200/80 bg-white/85 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-slate-900/70 dark:text-red-300">
              <div className="font-semibold">Error en Credenciales</div>
              <div className="mt-0.5 text-[11px]">
                {platformCheck.error ||
                  'Verificá que PLATFORM_MERCADOPAGO_ACCESS_TOKEN esté cargado correctamente en los Secrets.'}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
              Tocá <strong>«Validar Mercado Pago»</strong> para comprobar si el token configurado responde correctamente.
            </div>
          )}

          {diagnosticResult && (
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white/95 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/90">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-[#0072BB]" />
                  <span className="font-bold text-slate-900 dark:text-white">
                    Diagnóstico de entorno y permisos
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono-num text-[10px] font-bold ${
                      diagnosticResult.ok
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                    }`}
                  >
                    {diagnosticResult.runtime.toUpperCase()}
                    {diagnosticResult.vercelEnv ? ` (${diagnosticResult.vercelEnv})` : ''}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => void handleCopyDiagnosticLog()}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Copy className="h-3 w-3" />
                  Copiar log
                </button>
              </div>

              <div className="grid gap-1.5 font-mono-num text-[11px] text-slate-600 sm:grid-cols-3 dark:text-slate-300">
                <div>
                  Estado:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {diagnosticResult.envStatus === 'loaded'
                      ? 'Cargada'
                      : diagnosticResult.envStatus === 'empty_string'
                        ? 'Cadena vacía'
                        : 'No encontrada'}
                  </strong>
                </div>
                <div>
                  Prefijo:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {diagnosticResult.prefixType}
                  </strong>
                </div>
                <div>
                  Longitud:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {diagnosticResult.tokenLength} chars
                  </strong>
                </div>
              </div>

              <div className="space-y-1.5">
                {diagnosticResult.checks.map((chk) => (
                  <div
                    key={chk.id}
                    className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                      chk.status === 'pass'
                        ? 'border-emerald-200/80 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-200'
                        : chk.status === 'warn'
                          ? 'border-amber-200/80 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200'
                          : 'border-red-200/80 bg-red-50/70 text-red-800 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-300'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{chk.label}</div>
                      <div className="opacity-90">{chk.detail}</div>
                    </div>
                    {typeof chk.httpStatus === 'number' && (
                      <span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 font-mono-num text-[10px] font-bold dark:bg-slate-900/70">
                        HTTP {chk.httpStatus}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {diagnosticResult.hints.length > 0 && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-2 text-[11px] text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                  <div className="font-semibold">Sugerencias:</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {diagnosticResult.hints.map((hint, idx) => (
                      <li key={idx}>{hint}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                Resultado completo registrado en la consola del navegador (`[TH3 BNB · Diagnóstico Mercado Pago]`).
              </div>
            </div>
          )}
        </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            {tr('Color por palabra y vista previa', 'Word colors & preview', 'Cor por palavra e pré-visualização')}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {words.map((word, idx) => (
              <label
                key={`${word}-${idx}`}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <input
                  type="color"
                  value={wordColors[idx] || (idx === 0 ? '#0F172A' : '#0072BB')}
                  onChange={(e) => {
                    const next = [...wordColors];
                    next[idx] = e.target.value;
                    setWordColors(next);
                  }}
                  className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span>{word}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center rounded-xl border border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900">
            <BrandMark
              profile={{
                brandName,
                wordColors,
                logoDataUrl,
                logoScale,
                logoTransparent,
              }}
              size="lg"
              showLogoImage={false}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <ImageIcon className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              <span>{tr('Logo del taller', 'Workshop logo', 'Logotipo da oficina')}</span>
            </div>
            {logoDataUrl && (
              <button
                type="button"
                onClick={() => setLogoDataUrl('')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tr('Quitar logo', 'Remove logo', 'Remover logotipo')}
              </button>
            )}
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition ${
              dragOver
                ? 'border-[#0072BB] bg-sky-50 dark:bg-sky-950/30'
                : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/40'
            }`}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="hidden"
            />
            {logoDataUrl ? (
              <div
                className={`rounded-xl p-2 ${
                  logoTransparent ? '' : 'bg-white shadow-xs'
                }`}
              >
                <img
                  src={logoDataUrl}
                  alt={tr('Vista previa del logo', 'Logo preview', 'Pré-visualização do logotipo')}
                  referrerPolicy="no-referrer"
                  style={{ height: `${Math.round((48 * logoScale) / 100)}px` }}
                  className="max-w-full object-contain"
                />
              </div>
            ) : (
              <>
                <UploadCloud className="h-7 w-7 text-slate-400" />
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  <strong>{tr('Clic para seleccionar', 'Click to select', 'Clique para selecionar')}</strong>{' '}
                  {tr('o arrastrá una imagen', 'or drag an image here', 'ou arraste uma imagem')}
                </div>
                <div className="text-[11px] text-slate-400">
                  {tr(
                    'PNG transparente recomendado · Máx 2 MB',
                    'Transparent PNG recommended · Max 2 MB',
                    'PNG transparente recomendado · Máx. 2 MB'
                  )}
                </div>
              </>
            )}
          </label>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
              <span>{tr('Tamaño del logo', 'Logo size', 'Tamanho do logotipo')}</span>
              <span className="font-mono-num">{logoScale}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={200}
              step={10}
              value={logoScale}
              onChange={(e) => setLogoScale(Number(e.target.value))}
              className="w-full accent-[#0072BB]"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={logoTransparent}
              onChange={(e) => setLogoTransparent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-[#0072BB]"
            />
            <span>
              <strong className="block text-slate-900 dark:text-white">
                {tr(
                  'Mi logo tiene fondo transparente',
                  'My logo has a transparent background',
                  'Meu logotipo tem fundo transparente'
                )}
              </strong>
              {tr(
                'Si subiste un JPG o PNG con fondo blanco, desmarcalo para mostrarlo sobre un recuadro claro.',
                'If you uploaded a JPG or PNG with a white background, uncheck this to display it on a light box.',
                'Se enviou um JPG ou PNG com fundo branco, desmarque para exibi-lo sobre um fundo claro.'
              )}
            </span>
          </label>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            {tr('Términos y condiciones', 'Terms & conditions', 'Termos e condições')}
          </label>
          <textarea
            rows={4}
            maxLength={2000}
            value={receiptTerms}
            onChange={(e) => setReceiptTerms(e.target.value)}
            placeholder={tr(
              'Escribí los términos y condiciones que aparecerán en la boleta del cliente...',
              'Write the terms and conditions that will appear on the customer receipt...',
              'Escreva os termos e condições que aparecerão no comprovante do cliente...'
            )}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            {tr(
              'Dirección pública del sitio para links de seguimiento (opcional)',
              'Public website URL for tracking links (optional)',
              'Endereço público do site para links de acompanhamento (opcional)'
            )}
          </label>
          <input
            type="url"
            value={trackingBaseUrl}
            onChange={(e) => setTrackingBaseUrl(e.target.value)}
            placeholder="https://tu-taller.vercel.app"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-[#0072BB] dark:bg-sky-950/70 dark:text-sky-300">
                <Download className="h-4 w-4" />
              </span>
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                  {tr('Copia de seguridad completa', 'Full workshop backup', 'Backup completo')}
                </h4>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {tr(
                    'Descargá un respaldo en formato JSON con tus reparaciones, clientes, inventario, ventas, compras, caja diaria, agenda y proveedores (sin tokens privados).',
                    'Download a JSON backup of your repairs, clients, inventory, sales, purchases, cash register, schedule and suppliers (no private tokens).',
                    'Baixe um backup em JSON com seus reparos, clientes, estoque, vendas, compras, caixa, agenda e fornecedores (sem tokens privados).'
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={exportingBackup || deletingAccount}
              onClick={() => void handleExportFullBackup()}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-800 transition hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-sky-400 dark:hover:text-sky-300"
            >
              {exportingBackup ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exportingBackup
                ? tr('Generando...', 'Generating...', 'Gerando...')
                : tr('Descargar respaldo (.json)', 'Download backup (.json)', 'Baixar backup (.json)')}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/70 dark:text-red-400">
                <Trash2 className="h-4 w-4" />
              </span>
              <div>
                <h4 className="text-xs font-bold text-red-900 dark:text-red-200">
                  {tr(
                    'Eliminar cuenta y todos los datos',
                    'Delete account and all data',
                    'Excluir conta e todos os dados'
                  )}
                </h4>
                <p className="mt-0.5 text-[11px] leading-relaxed text-red-800/85 dark:text-red-300/85">
                  {tr(
                    `Borra de forma permanente tu usuario${(userEmail || profile.email) ? ` (${userEmail || profile.email})` : ''}, perfil del taller, reparaciones, clientes, inventario, ventas, compras, agenda, proveedores y links de seguimiento.`,
                    `Permanently deletes your account${(userEmail || profile.email) ? ` (${userEmail || profile.email})` : ''}, workshop profile, repairs, clients, inventory, sales, purchases, schedule, suppliers and tracking links.`,
                    `Exclui permanentemente sua conta${(userEmail || profile.email) ? ` (${userEmail || profile.email})` : ''}, perfil da oficina, reparos, clientes, estoque, vendas, compras, agenda, fornecedores e links de acompanhamento.`
                  )}
                </p>
              </div>
            </div>

            {!showDeleteAccountConfirm && (
              <button
                type="button"
                onClick={() => {
                  setShowDeleteAccountConfirm(true);
                  setDeleteConfirmText('');
                  setDeleteAccountError('');
                }}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-red-300 bg-white px-3.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tr('Eliminar cuenta', 'Delete account', 'Excluir conta')}
              </button>
            )}
          </div>

          {showDeleteAccountConfirm && (
            <div className="mt-3 space-y-3 border-t border-red-200/80 pt-3 dark:border-red-900/50">
              <div className="flex items-start gap-2 text-xs text-red-800 dark:text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <span>
                  {tr('Esta acción es', 'This action is', 'Esta ação é')}{' '}
                  <strong>{tr('irreversible', 'irreversible', 'irreversível')}</strong>.{' '}
                  {tr('Para confirmar, escribí', 'To confirm, type', 'Para confirmar, digite')}{' '}
                  <strong className="font-mono">ELIMINAR</strong> {tr('debajo:', 'below:', 'abaixo:')}
                </span>
              </div>

              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (deleteConfirmText.trim().toUpperCase() === 'ELIMINAR') {
                      void handleDeleteAccount();
                    }
                  }
                }}
                placeholder={tr('Escribí ELIMINAR', 'Type ELIMINAR', 'Digite ELIMINAR')}
                disabled={deletingAccount}
                className="h-10 w-full rounded-xl border border-red-300 bg-white px-3 font-mono text-xs font-semibold uppercase text-slate-900 outline-none focus:border-red-600 dark:border-red-800 dark:bg-slate-900 dark:text-white"
              />

              {deleteAccountError && (
                <div className="rounded-xl border border-red-300 bg-white px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-slate-900 dark:text-red-300">
                  {deleteAccountError}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={deletingAccount}
                  onClick={() => {
                    setShowDeleteAccountConfirm(false);
                    setDeleteConfirmText('');
                    setDeleteAccountError('');
                  }}
                  className="h-9 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {tr('Cancelar', 'Cancel', 'Cancelar')}
                </button>
                <button
                  type="button"
                  disabled={
                    deletingAccount || deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR'
                  }
                  onClick={() => void handleDeleteAccount()}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingAccount ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  {deletingAccount
                    ? tr('Eliminando todo...', 'Deleting everything...', 'Excluindo tudo...')
                    : tr('Confirmar eliminación', 'Confirm deletion', 'Confirmar exclusão')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={deletingAccount}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {tr('Cancelar', 'Cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={saving || deletingAccount}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
          >
            {saving
              ? tr('Guardando...', 'Saving...', 'Salvando...')
              : tr('Guardar configuración', 'Save settings', 'Salvar configurações')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
