import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Store, Trash2, UploadCloud } from 'lucide-react';
import { clampStr, handleDbError, OperationType, stripUndefined, updateRow } from '../lib/db';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import { compressImageToDataUrl } from '../utils/formatters';
import {
  isPrivatePreviewOrigin,
  normalizeTrackingBaseUrl,
  resolveTrackingBaseUrl,
} from '../utils/tracking';
import { parseWorkshopMeta, serializeWorkshopSubtitle } from '../utils/workshopMeta';
import type { WorkshopProfile } from '../types/workshop';
import { ModalShell } from './ModalShell';
import { BrandMark } from './BrandMark';
import { useToast } from './ToastProvider';

interface BrandSettingsModalProps {
  open: boolean;
  onClose: () => void;
  profile: WorkshopProfile;
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
    setWordColors(profile.wordColors || ['#0F172A', '#0072BB']);
    setLogoDataUrl(profile.logoDataUrl || '');
    setLogoScale(profile.logoScale ?? 100);
    setLogoTransparent(profile.logoTransparent ?? true);
    setReceiptTerms(profile.receiptTerms ?? DEFAULT_RECEIPT_TERMS);
    setTrackingBaseUrl(resolveTrackingBaseUrl(profile.trackingBaseUrl));
  }, [open, profile]);

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
      setLogoDataUrl(compressed);
    } catch {
      notify('No se pudo cargar la imagen del logo.', 'error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const path = `workshop_profiles/${profile.id}`;
    try {
      const cleanedTrackingUrl = normalizeTrackingBaseUrl(trackingBaseUrl);
      const safeTrackingBaseUrl = isPrivatePreviewOrigin(cleanedTrackingUrl)
        ? ''
        : clampStr(cleanedTrackingUrl, 250);
      const encodedSubtitle = serializeWorkshopSubtitle({
        subtitle: subtitleText,
        hours,
        social,
        taxId,
        businessEmail,
        footerNote,
      });
      const payload = stripUndefined({
        brandName: clampStr(brandName || 'TH3 BNB', 80) || 'TH3 BNB',
        subtitle: clampStr(encodedSubtitle, 900),
        businessPhone: clampStr(businessPhone, 50),
        businessAddress: clampStr(businessAddress, 200),
        wordColors: wordColors.slice(0, 12),
        logoDataUrl: clampStr(logoDataUrl, 700000),
        logoScale,
        logoTransparent,
        receiptTerms: clampStr(receiptTerms, 2000),
        trackingBaseUrl: safeTrackingBaseUrl,
        updatedAt: new Date().toISOString(),
      });
      await updateRow('workshop_profiles', profile.id, payload);
      notify('Configuración del taller actualizada.');
      onClose();
    } catch (err) {
      notify('Error al guardar la configuración.', 'error');
      await handleDbError(err, OperationType.UPDATE, path);
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
