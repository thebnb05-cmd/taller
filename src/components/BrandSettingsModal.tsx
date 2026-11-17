import React, { useEffect, useState } from 'react';
import { Coins, Image as ImageIcon, Plus, Store, Trash2, UploadCloud, Users, X } from 'lucide-react';
import { clampStr, handleDbError, OperationType, stripUndefined, updateRow } from '../lib/db';
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
import { compressImageToDataUrl, formatCurrency } from '../utils/formatters';
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
import { ModalShell } from './ModalShell';
import { BrandMark } from './BrandMark';
import { PaymentSettingsPanel } from './PaymentSettingsPanel';
import { useToast } from './ToastProvider';

interface BrandSettingsModalProps {
  open: boolean;
  onClose: () => void;
  profile: WorkshopProfile;
}

interface SecondaryCurrencyRow {
  code: CurrencyCode;
  rate: string;
}

export const BrandSettingsModal: React.FC<BrandSettingsModalProps> = ({
  open,
  onClose,
  profile,
}) => {
  const { notify } = useToast();
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
  const [secondaryRows, setSecondaryRows] = useState<SecondaryCurrencyRow[]>(() =>
    initialMeta.secondaryCurrencies.map((item) => ({
      code: item.code,
      rate: String(item.rate),
    }))
  );
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
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
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
    setSecondaryRows(
      meta.secondaryCurrencies.map((item) => ({
        code: item.code,
        rate: String(item.rate),
      }))
    );
    setWordColors(profile.wordColors || ['#0F172A', '#0072BB']);
    setLogoDataUrl(profile.logoDataUrl || '');
    setLogoScale(profile.logoScale ?? 100);
    setLogoTransparent(profile.logoTransparent ?? true);
    setReceiptTerms(profile.receiptTerms ?? DEFAULT_RECEIPT_TERMS);
    setTrackingBaseUrl(resolveTrackingBaseUrl(profile.trackingBaseUrl));
    setTechniciansEnabled(meta.techniciansEnabled);
    setTechnicians(meta.technicians);
    setNewTechnicianName('');
  }, [open, profile]);

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
    setSecondaryRows((prev) => [...prev, { code: nextOption.code, rate: '' }]);
  };

  const handleUpdateSecondaryCode = (index: number, nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === currency) return;
    setSecondaryRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, code: nextCode } : row))
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
      const encodedSubtitle = serializeWorkshopSubtitle({
        subtitle: sanitizePlainLine(subtitleText, 80),
        hours: sanitizePlainLine(hours, 100),
        social: sanitizePlainLine(social, 100),
        taxId: sanitizePlainLine(taxId, 60),
        businessEmail: cleanEmail,
        footerNote: sanitizePlainLine(footerNote, 180),
        currency: safeCurrency,
        secondaryCurrencies: safeSecondaryCurrencies,
        techniciansEnabled,
        technicians: sanitizeTechnicianList(technicians),
      });
      const safeColors = wordColors
        .slice(0, 12)
        .map((c, idx) => sanitizeHexColor(c, idx === 0 ? '#0F172A' : '#0072BB'));
      const safeScale = Math.min(200, Math.max(50, Math.round(Number(logoScale) || 100)));
      const safeLogoDataUrl = logoDataUrl ? sanitizeImageDataUrl(logoDataUrl, 700000) : '';

      const payload = stripUndefined({
        brandName: sanitizePlainLine(brandName || 'TH3 BNB', 80) || 'TH3 BNB',
        subtitle: clampStr(encodedSubtitle, 2000),
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
      notify('Configuración del taller actualizada.');
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'Error al guardar la configuración.'), 'error');
      void handleDbError(err, OperationType.UPDATE, path).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Configuración"
      subtitle="Administrá tu taller, marca, logo y los datos visibles en cada boleta."
      maxWidth="2xl"
    >
      <form onSubmit={handleSave} className="space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5 dark:border-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
            <Store className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Taller · Marca y comprobantes
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Todos estos datos se reflejan automáticamente en tus boletas A4, 80mm y PDF.
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Nombre o marca del taller
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
              Subtítulo / Rubro del taller
            </label>
            <input
              type="text"
              maxLength={80}
              value={subtitleText}
              onChange={(e) => setSubtitleText(e.target.value)}
              placeholder="Ej: Servicio técnico especializado"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Teléfono del local
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
              Dirección del local
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
                  Moneda base del taller, presupuestos y boletas
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Se aplica en presupuestos, señas, inventario, ventas, WhatsApp y boletas A4, 80mm y PDF.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono-num text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300">
              Ej: {formatCurrency(15000, currency)}
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
                  Monedas secundarias y tasas de conversión
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Definí monedas alternativas y su equivalencia respecto a {baseCurrencyOption.code} ({baseCurrencyOption.symbol}).
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddSecondaryCurrency}
                disabled={unusedSecondaryOptions.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#0072BB]/30 bg-white px-2.5 text-xs font-semibold text-[#0072BB] transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-700/50 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/40"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar moneda
              </button>
            </div>

            {secondaryRows.length === 0 ? (
              <p className="mt-2.5 rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-2.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                No hay monedas secundarias configuradas. Podés agregar por ejemplo USD o EUR con su cotización frente a {baseCurrencyOption.code}.
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
              Opciones extra para mostrar en cada boleta
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Completá las que quieras imprimir en boletas de reparación, ventas, lotes y PDF.
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Horarios de atención
              </label>
              <input
                type="text"
                maxLength={100}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="Ej: Lun a Vie 9:30 a 19:00 · Sáb 10 a 14"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Instagram / Web
              </label>
              <input
                type="text"
                maxLength={100}
                value={social}
                onChange={(e) => setSocial(e.target.value)}
                placeholder="Ej: @th3bnb.servicio · www.th3bnb.com"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                CUIT / Documento comercial (opcional)
              </label>
              <input
                type="text"
                maxLength={60}
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="Ej: CUIT 20-12345678-9"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Email de contacto
              </label>
              <input
                type="email"
                maxLength={100}
                value={businessEmail}
                onChange={(e) => setBusinessEmail(e.target.value)}
                placeholder="Ej: contacto@tutaller.com"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Garantía o mensaje destacado al pie de boleta
              </label>
              <input
                type="text"
                maxLength={180}
                value={footerNote}
                onChange={(e) => setFooterNote(e.target.value)}
                placeholder="Ej: Garantía 30 días sobre el trabajo realizado · ¡Gracias por elegirnos!"
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
                  Asignación de técnicos (opcional)
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Si trabajás solo como dueño del taller podés dejarlo desactivado. Activándolo elegís qué técnico toma cada orden.
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
                {techniciansEnabled ? 'Activo' : 'Opcional'}
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
                  placeholder="Nombre del técnico (ej: Marcos, Sofía...)"
                  className="h-10 min-w-[180px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => handleAddTechnician()}
                  disabled={!newTechnicianName.trim()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Agregar
                </button>
                {ownerDisplayName &&
                  !technicians.some((t) => t.toLowerCase() === ownerDisplayName.toLowerCase()) && (
                    <button
                      type="button"
                      onClick={() => handleAddTechnician(ownerDisplayName)}
                      className="inline-flex h-10 items-center gap-1 rounded-xl border border-[#0072BB]/30 bg-white px-3 text-xs font-semibold text-[#0072BB] hover:bg-sky-50 dark:border-sky-700/50 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Agregarme ({ownerDisplayName})
                    </button>
                  )}
              </div>

              {technicians.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                  Agregá al menos un técnico para habilitar el selector en nuevas órdenes y filtros.
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

        <PaymentSettingsPanel ownerId={profile.ownerId || profile.id} />

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Color por palabra y vista previa
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
              <span>Logo del taller</span>
            </div>
            {logoDataUrl && (
              <button
                type="button"
                onClick={() => setLogoDataUrl('')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Quitar logo
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
                  alt="Vista previa del logo"
                  referrerPolicy="no-referrer"
                  style={{ height: `${Math.round((48 * logoScale) / 100)}px` }}
                  className="max-w-full object-contain"
                />
              </div>
            ) : (
              <>
                <UploadCloud className="h-7 w-7 text-slate-400" />
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  <strong>Clic para seleccionar</strong> o arrastrá una imagen
                </div>
                <div className="text-[11px] text-slate-400">
                  PNG transparente recomendado · Máx 2 MB
                </div>
              </>
            )}
          </label>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
              <span>Tamaño del logo</span>
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
                Mi logo tiene fondo transparente
              </strong>
              Si subiste un JPG o PNG con fondo blanco, desmarcalo para mostrarlo sobre un recuadro
              claro.
            </span>
          </label>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Términos y condiciones
          </label>
          <textarea
            rows={4}
            maxLength={2000}
            value={receiptTerms}
            onChange={(e) => setReceiptTerms(e.target.value)}
            placeholder="Escribí los términos y condiciones que aparecerán en la boleta del cliente..."
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Dirección pública del sitio para links de seguimiento (opcional)
          </label>
          <input
            type="url"
            value={trackingBaseUrl}
            onChange={(e) => setTrackingBaseUrl(e.target.value)}
            placeholder="https://tu-taller.vercel.app"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
