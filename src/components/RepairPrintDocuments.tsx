import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  FileDown,
  FileText,
  MessageCircle,
  Printer,
  ReceiptText,
  Scissors,
  Share2,
  Tag,
  Wrench,
} from 'lucide-react';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import type { RepairRecord, WorkshopProfile } from '../types/workshop';
import { formatCurrency, formatDateShort, getStatusMeta } from '../utils/formatters';
import { parsePaymentInfo } from '../utils/payment';
import {
  buildClientRepairReceiptPdf,
  downloadClientRepairReceiptPdf,
} from '../utils/pdfReport';
import { BrandMark } from './BrandMark';
import { useToast } from './ToastProvider';

export type PrintDocKey = 'client' | 'workshop' | 'label';
export type PrintFormat = 'a4' | 'thermal80';

interface RepairPrintDocumentsProps {
  repair: RepairRecord;
  profile?: WorkshopProfile | null;
  trackingUrl: string;
  justCreated?: boolean;
  justPaid?: boolean;
}

const PatternMiniSvg: React.FC<{ pattern: number[]; size?: number }> = ({
  pattern,
  size = 84,
}) => {
  const step = size / 3;
  const center = (idx: number) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    return { x: col * step + step / 2, y: row * step + step / 2 };
  };

  const points = pattern.map(center);
  const pathD =
    points.length > 1
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      : '';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 rounded-lg border border-slate-300 bg-white"
      aria-label={`Patrón ${pattern.join('-')}`}
    >
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke="#0f172a"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {Array.from({ length: 9 }, (_, i) => {
        const c = center(i);
        const orderIndex = pattern.indexOf(i);
        const active = orderIndex !== -1;
        return (
          <g key={i}>
            <circle
              cx={c.x}
              cy={c.y}
              r={active ? 6.5 : 3.5}
              fill={active ? '#0072BB' : '#cbd5e1'}
            />
            {orderIndex === 0 && (
              <circle cx={c.x} cy={c.y} r={2.5} fill="#ffffff" />
            )}
          </g>
        );
      })}
    </svg>
  );
};

export const RepairPrintDocuments: React.FC<RepairPrintDocumentsProps> = ({
  repair,
  profile,
  trackingUrl,
  justCreated = false,
  justPaid = false,
}) => {
  const { notify } = useToast();
  const [printFormat, setPrintFormat] = useState<PrintFormat>('a4');
  const [trackingQrDataUrl, setTrackingQrDataUrl] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Record<PrintDocKey, boolean>>({
    client: true,
    workshop: !justPaid,
    label: !justPaid,
  });

  const canNativeSharePdf = useMemo(() => {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
        return false;
      }
      const isTouch =
        typeof window !== 'undefined' &&
        (window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0);
      if (!isTouch) return false;
      const testFile = new File([''], 'boleta.pdf', { type: 'application/pdf' });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  }, []);

  const cleanPhoneForWa = (repair.clientPhone || '').replace(/[^\d]/g, '');
  const waReceiptMessage = useMemo(() => {
    const brand = profile?.brandName || 'TH3 BNB Servicio Técnico';
    const pending = Math.max(0, Number(repair.price || 0) - Number(repair.deposit || 0));
    const paidInfo = parsePaymentInfo(repair);
    const amountLine = paidInfo.isPaid
      ? `Total abonado: ${formatCurrency(repair.price)} (PAGO).`
      : `Presupuesto: ${formatCurrency(repair.price)}${
          Number(repair.deposit || 0) > 0 ? ` · Seña: ${formatCurrency(repair.deposit)}` : ''
        } · Saldo pendiente: ${formatCurrency(pending)}.`;
    return (
      `Hola ${repair.clientName}, te enviamos la boleta PDF de ${brand} para tu ${repair.brand} ${repair.model} (Orden ${repair.code}).\n` +
      `${amountLine}\n` +
      `Seguimiento en línea (${repair.trackingCode}): ${trackingUrl}`
    );
  }, [profile?.brandName, repair, trackingUrl]);

  const whatsappPdfHref = cleanPhoneForWa
    ? `https://wa.me/${cleanPhoneForWa}?text=${encodeURIComponent(waReceiptMessage)}`
    : `https://wa.me/?text=${encodeURIComponent(waReceiptMessage)}`;

  const handleDownloadClientPdf = async (forWhatsApp = false) => {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const { fileName } = await downloadClientRepairReceiptPdf({
        repair,
        profile,
        trackingUrl,
        trackingQrDataUrl,
      });
      notify(
        forWhatsApp
          ? `PDF descargado (${fileName}). Adjuntalo en el chat de WhatsApp.`
          : `PDF descargado (${fileName}).`
      );
    } catch (err) {
      console.error(err);
      notify('No se pudo generar el PDF de la boleta.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleNativeShareClientPdf = async () => {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const { fileName, blob } = await buildClientRepairReceiptPdf({
        repair,
        profile,
        trackingUrl,
        trackingQrDataUrl,
      });
      const pdfFile = new File([blob], fileName, { type: 'application/pdf' });
      await navigator.share({
        title: `Boleta Cliente ${repair.code}`,
        text: waReceiptMessage,
        files: [pdfFile],
      });
    } catch (err) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        return;
      }
      console.error(err);
      notify('No se pudo compartir directamente. Podés descargar el PDF.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  useEffect(() => {
    if (justPaid) {
      setSelectedDocs({ client: true, workshop: false, label: false });
    }
  }, [justPaid, repair.id]);

  useEffect(() => {
    if (!trackingUrl) {
      setTrackingQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(trackingUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setTrackingQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTrackingQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [trackingUrl]);

  const pendingBalance = Math.max(0, Number(repair.price || 0) - Number(repair.deposit || 0));
  const statusMeta = getStatusMeta(repair.status);
  const paymentInfo = useMemo(() => parsePaymentInfo(repair), [repair]);

  const selectedCount = useMemo(
    () => Object.values(selectedDocs).filter(Boolean).length,
    [selectedDocs]
  );

  const toggleDoc = (key: PrintDocKey) => {
    setSelectedDocs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAll = () => setSelectedDocs({ client: true, workshop: true, label: true });
  const selectOnly = (key: PrintDocKey) =>
    setSelectedDocs({
      client: key === 'client',
      workshop: key === 'workshop',
      label: key === 'label',
    });

  const accessoriesText = useMemo(() => {
    if (repair.accessories && repair.accessories.length > 0) {
      return repair.accessories.join(', ');
    }
    if (repair.consoleAccessories && Object.keys(repair.consoleAccessories).length > 0) {
      return Object.entries(repair.consoleAccessories)
        .filter(([, v]) => v === 'Sí')
        .map(([k]) => k)
        .join(', ');
    }
    return 'Ninguno';
  }, [repair]);

  const securityText = useMemo(() => {
    if (repair.securityType === 'pattern' && repair.securityPattern?.length) {
      return `Patrón: ${repair.securityPattern.join(' → ')}`;
    }
    if (repair.securityPin?.trim()) {
      return `PIN/Clave: ${repair.securityPin}`;
    }
    return 'Sin clave';
  }, [repair]);

  const renderClientReceipt = (isPrintMode: boolean) => {
    const physicalEntries = Object.entries(repair.physicalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );
    const functionalEntries = Object.entries(repair.functionalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );

    return (
      <div
        className={`bg-white text-slate-900 ${
          isPrintMode
            ? 'p-7'
            : 'rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs'
        }`}
      >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-col items-start gap-1.5">
          <div className="inline-block rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0072BB]">
            Boleta Cliente · Comprobante de Ingreso
          </div>
          <div>
            {isPrintMode ? (
              <h1 className="text-xl font-extrabold text-slate-900">
                {profile?.brandName || 'TH3 BNB Servicio Técnico'}
              </h1>
            ) : (
              <BrandMark profile={profile} size="lg" forceLight />
            )}
          </div>
          <p className="flex flex-col gap-0.5 text-xs text-slate-600">
            <span>{profile?.businessAddress || 'Servicio técnico especializado'}</span>
            {profile?.businessPhone && <span>Tel: {profile.businessPhone}</span>}
          </p>
        </div>

        <div className="text-right">
          <div className="font-mono-num text-lg font-extrabold text-slate-900">
            Orden {repair.code}
          </div>
          <div className="font-mono-num text-xs font-semibold text-[#0072BB]">
            Seguimiento: {repair.trackingCode}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Ingreso: {formatDateShort(repair.dateIn)}
          </div>
          {repair.dateEst && (
            <div className="text-xs text-slate-500">
              Entrega est.: {formatDateShort(repair.dateEst)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Datos del cliente
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">{repair.clientName}</div>
          {repair.clientPhone && <div>Tel: {repair.clientPhone}</div>}
          {repair.clientDni && <div>DNI: {repair.clientDni}</div>}
          {repair.clientAddress && <div>Dir: {repair.clientAddress}</div>}
        </div>

        <div className="rounded-xl border border-slate-200/80 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Equipo ingresado
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">
            {repair.deviceType} · {repair.brand} {repair.model}
          </div>
          <div className="text-slate-600">
            {[repair.color, repair.capacity].filter(Boolean).join(' · ') || 'Sin detalles físicos adicionales'}
          </div>
          {repair.imei && (
            <div className="font-mono-num text-slate-700">IMEI / Serie: {repair.imei}</div>
          )}
          <div className="mt-0.5 text-slate-600">
            <strong>Accesorios:</strong> {accessoriesText}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
        <div className="font-bold text-slate-600">Falla declarada / Motivo de ingreso</div>
        <div className="mt-0.5 text-slate-900">{repair.problem}</div>
      </div>

      {(physicalEntries.length > 0 || functionalEntries.length > 0) && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200/80 p-3 text-[11px]">
          {physicalEntries.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                CHECK OUT · Estado físico
              </div>
              <div className="flex flex-wrap gap-1.5">
                {physicalEntries.map(([k, v]) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700"
                  >
                    <span className="text-slate-500">{k}:</span>
                    <strong className="text-slate-900">{v}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
          {functionalEntries.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                CHECK OUT · Estado funcional
              </div>
              <div className="flex flex-wrap gap-1.5">
                {functionalEntries.map(([k, v]) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700"
                  >
                    <span className="text-slate-500">{k}:</span>
                    <strong className="text-slate-900">{v}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-200 py-3 text-center text-xs">
        <div>
          <div className="text-slate-500">Presupuesto</div>
          <div className="font-mono-num text-sm font-bold text-slate-900">
            {formatCurrency(repair.price)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Seña / Anticipo</div>
          <div className="font-mono-num text-sm font-bold text-emerald-700">
            {formatCurrency(repair.deposit)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Saldo pendiente</div>
          <div className="font-mono-num text-sm font-bold text-slate-900">
            {formatCurrency(pendingBalance)}
          </div>
        </div>
      </div>

      {paymentInfo.isPaid && (
        <div className="mt-3 flex justify-end">
          <div className="inline-block -rotate-2 rounded-lg border-2 border-emerald-700 bg-emerald-50/90 px-4 py-2 text-center text-emerald-900 ring-1 ring-emerald-700/40 ring-offset-2">
            <div className="text-base font-black uppercase tracking-[0.22em] text-emerald-800">
              PAGO
            </div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-900">
              {repair.clientName}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-emerald-800">
              {paymentInfo.methodLabel ? `${paymentInfo.methodLabel} · ` : ''}
              {formatCurrency(repair.price)}
            </div>
          </div>
        </div>
      )}

      {(profile?.receiptTerms ?? DEFAULT_RECEIPT_TERMS).trim() && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-[10px] leading-relaxed text-slate-600">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-700">
            Términos y condiciones
          </div>
          <div className="whitespace-pre-line text-[8px] leading-snug text-slate-600">
            {profile?.receiptTerms ?? DEFAULT_RECEIPT_TERMS}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-dashed border-slate-300 pt-4 text-[11px] text-slate-600">
        <div className="flex items-center gap-3">
          {trackingQrDataUrl && (
            <img
              src={trackingQrDataUrl}
              alt={`QR seguimiento ${repair.trackingCode}`}
              className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 bg-white p-1"
            />
          )}
          <div>
            <div className="font-semibold text-slate-800">Seguimiento en línea</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              Escaneá el QR para ver el estado de tu equipo
            </div>
            <div className="mt-0.5 font-mono-num text-[10px] font-bold text-[#0072BB]">
              Código: {repair.trackingCode}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="mt-4 w-52 border-b border-slate-400" />
          <div className="mt-1 text-[10px] text-slate-500">Firma y aclaración del cliente</div>
        </div>
      </div>
    </div>
    );
  };

  const renderWorkshopReceipt = (isPrintMode: boolean) => {
    const physicalEntries = Object.entries(repair.physicalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );
    const functionalEntries = Object.entries(repair.functionalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );

    return (
      <div
        className={`bg-white text-slate-900 ${
          isPrintMode
            ? 'p-7'
            : 'rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
          <div>
            <div className="mb-1 inline-block rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Boleta Taller · Orden Interna de Trabajo
            </div>
            <div className="text-lg font-extrabold text-slate-900">
              {repair.brand} {repair.model}{' '}
              <span className="text-sm font-semibold text-slate-500">({repair.deviceType})</span>
            </div>
            <div className="text-xs text-slate-600">
              Cliente: <strong>{repair.clientName}</strong>
              {repair.clientPhone ? ` · Tel: ${repair.clientPhone}` : ''}
              {repair.clientDni ? ` · DNI: ${repair.clientDni}` : ''}
            </div>
          </div>

          <div className="text-right">
            <div className="font-mono-num text-xl font-black text-slate-900">{repair.code}</div>
            <div className="text-[11px] font-bold uppercase text-slate-700">
              Prioridad: {repair.priority} · {statusMeta.label}
            </div>
            <div className="text-xs text-slate-500">
              Ingreso: {formatDateShort(repair.dateIn)}
              {repair.dateEst ? ` · Est.: ${formatDateShort(repair.dateEst)}` : ''}
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-2.5 sm:col-span-2">
            <div className="text-[11px] font-bold uppercase text-slate-500">
              Falla reportada y especificaciones
            </div>
            <p className="mt-1 text-sm font-medium text-slate-900">{repair.problem}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              {repair.imei && (
                <span className="font-mono-num">
                  <strong>IMEI/Serie:</strong> {repair.imei}
                </span>
              )}
              {repair.color && (
                <span>
                  <strong>Color:</strong> {repair.color}
                </span>
              )}
              {repair.capacity && (
                <span>
                  <strong>Cap.:</strong> {repair.capacity}
                </span>
              )}
              <span>
                <strong>Accesorios:</strong> {accessoriesText}
              </span>
            </div>
            {repair.partNames && repair.partNames.length > 0 && (
              <div className="mt-1.5 text-[11px] text-slate-700">
                <strong>Repuestos asignados:</strong> {repair.partNames.join(', ')}
              </div>
            )}
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-500">
                Seguridad / Desbloqueo
              </div>
              {repair.securityType === 'pattern' && repair.securityPattern?.length ? (
                <div className="mt-1.5 flex items-center gap-2.5">
                  <PatternMiniSvg pattern={repair.securityPattern} size={74} />
                  <div className="font-mono-num text-[11px] font-bold text-slate-800">
                    {repair.securityPattern.join(' → ')}
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 font-mono-num text-sm font-bold text-slate-900">
                  {repair.securityPin?.trim() || 'Sin clave'}
                </div>
              )}
            </div>
            <div className="mt-2 border-t border-slate-200 pt-1.5 text-[11px]">
              <div>
                Presupuesto: <strong className="font-mono-num">{formatCurrency(repair.price)}</strong>
              </div>
              <div>
                Seña: <strong className="font-mono-num">{formatCurrency(repair.deposit)}</strong> ·
                Saldo: <strong className="font-mono-num">{formatCurrency(pendingBalance)}</strong>
              </div>
            </div>
          </div>
        </div>

        {(physicalEntries.length > 0 || functionalEntries.length > 0) && (
          <div className="mt-3 grid gap-3 text-[11px] sm:grid-cols-2">
            {physicalEntries.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-2.5">
                <div className="mb-1 font-bold uppercase text-slate-500">Check-in Físico</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {physicalEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-1">
                      <span className="truncate text-slate-500">{k}:</span>
                      <span className="font-semibold text-slate-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {functionalEntries.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-2.5">
                <div className="mb-1 font-bold uppercase text-slate-500">Check-in Funcional</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {functionalEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-1">
                      <span className="truncate text-slate-500">{k}:</span>
                      <span className="font-semibold text-slate-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 rounded-xl border border-slate-200 p-2.5 text-xs">
          <div className="text-[11px] font-bold uppercase text-slate-500">
            Notas internas / Diagnóstico técnico
          </div>
          {repair.notes ? (
            <p className="mt-1 text-slate-800">{repair.notes}</p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="border-b border-dashed border-slate-300" />
              <div className="border-b border-dashed border-slate-300" />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderDeviceLabel = (isPrintMode: boolean) => (
    <div
      className={`mx-auto w-full max-w-sm rounded-xl border-2 border-dashed border-slate-400 bg-white p-3.5 text-slate-900 ${
        isPrintMode ? '' : 'shadow-xs'
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-300 pb-2">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            {profile?.brandName || 'TH3 BNB'} · Etiqueta de Equipo
          </div>
          <div className="font-mono-num text-xl font-black leading-tight text-slate-900">
            {repair.code}
          </div>
        </div>
        <div className="text-right">
          <span className="inline-block rounded border border-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase">
            {repair.priority}
          </span>
          <div className="mt-0.5 font-mono-num text-[10px] text-slate-600">
            {repair.trackingCode}
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Cliente:</span>
          <span className="truncate font-bold text-slate-900">{repair.clientName}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Equipo:</span>
          <span className="truncate font-bold text-slate-900">
            {repair.brand} {repair.model}
          </span>
        </div>
        {(repair.color || repair.imei) && (
          <div className="flex justify-between gap-2 text-[11px]">
            <span className="text-slate-500">{repair.color ? `Color: ${repair.color}` : 'IMEI:'}</span>
            <span className="truncate font-mono-num text-slate-700">
              {repair.imei || repair.capacity || ''}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
          <span className="font-mono-num font-bold text-slate-900">{securityText}</span>
          <span className="text-slate-500">Acc: {accessoriesText}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-1.5 text-[10px] text-slate-500">
        <span>Ing: {formatDateShort(repair.dateIn)}</span>
        <span>
          Est: {repair.dateEst ? formatDateShort(repair.dateEst) : 'A conf.'}
        </span>
      </div>
    </div>
  );

  const renderThermalClientReceipt = (isPrintMode: boolean) => {
    const physicalEntries = Object.entries(repair.physicalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );
    const functionalEntries = Object.entries(repair.functionalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );

    return (
      <div
        className={`mx-auto bg-white text-black font-mono text-[11px] leading-snug ${
          isPrintMode
            ? 'w-[74mm] max-w-[76mm] px-1.5 py-2'
            : 'w-full max-w-[302px] rounded-xl border border-slate-300 p-3.5 shadow-xs'
        }`}
      >
        <div className="border-b border-dashed border-black pb-2 text-center">
          <div className="text-sm font-black uppercase tracking-tight">
            {profile?.brandName || 'TH3 BNB Servicio Técnico'}
          </div>
          {profile?.businessAddress && (
            <div className="text-[10px]">{profile.businessAddress}</div>
          )}
          {profile?.businessPhone && (
            <div className="text-[10px]">Tel: {profile.businessPhone}</div>
          )}
          <div className="mt-1.5 inline-block border border-black px-2 py-0.5 text-[10px] font-bold uppercase">
            Boleta Cliente
          </div>
        </div>

        <div className="border-b border-dashed border-black py-2 text-[10.5px]">
          <div className="flex justify-between font-bold">
            <span>ORDEN: {repair.code}</span>
            <span>SEG: {repair.trackingCode}</span>
          </div>
          <div className="flex justify-between">
            <span>Ingreso: {formatDateShort(repair.dateIn)}</span>
            {repair.dateEst && <span>Est: {formatDateShort(repair.dateEst)}</span>}
          </div>
        </div>

        <div className="border-b border-dashed border-black py-2 text-[10.5px]">
          <div className="font-bold uppercase">Cliente</div>
          <div className="font-bold">{repair.clientName}</div>
          {repair.clientPhone && <div>Tel: {repair.clientPhone}</div>}
          {repair.clientDni && <div>DNI: {repair.clientDni}</div>}
        </div>

        <div className="border-b border-dashed border-black py-2 text-[10.5px]">
          <div className="font-bold uppercase">Equipo</div>
          <div className="font-bold">
            {repair.deviceType} · {repair.brand} {repair.model}
          </div>
          {(repair.color || repair.capacity) && (
            <div>{[repair.color, repair.capacity].filter(Boolean).join(' · ')}</div>
          )}
          {repair.imei && <div>IMEI/Serie: {repair.imei}</div>}
          <div>Accesorios: {accessoriesText}</div>
          <div className="mt-1">
            <strong>Falla:</strong> {repair.problem}
          </div>
        </div>

        {(physicalEntries.length > 0 || functionalEntries.length > 0) && (
          <div className="space-y-1.5 border-b border-dashed border-black py-2 text-[9.5px] leading-tight">
            {physicalEntries.length > 0 && (
              <div>
                <div className="font-bold uppercase">CHECK OUT · Estado físico</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {physicalEntries.map(([k, v]) => (
                    <span key={k}>
                      {k}: <strong>{v}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {functionalEntries.length > 0 && (
              <div>
                <div className="font-bold uppercase">CHECK OUT · Estado funcional</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {functionalEntries.map(([k, v]) => (
                    <span key={k}>
                      {k}: <strong>{v}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="border-b border-dashed border-black py-2 text-[11px]">
          <div className="flex justify-between">
            <span>Presupuesto:</span>
            <strong>{formatCurrency(repair.price)}</strong>
          </div>
          <div className="flex justify-between">
            <span>Seña / Anticipo:</span>
            <strong>{formatCurrency(repair.deposit)}</strong>
          </div>
          <div className="mt-0.5 flex justify-between border-t border-dotted border-black pt-1 text-xs font-black">
            <span>SALDO PENDIENTE:</span>
            <span>{formatCurrency(pendingBalance)}</span>
          </div>
        </div>

        {paymentInfo.isPaid && (
          <div className="my-2 border-2 border-black px-2 py-1.5 text-center">
            <div className="text-sm font-black uppercase tracking-[0.2em]">★ PAGO ★</div>
            <div className="text-[11px] font-extrabold uppercase">{repair.clientName}</div>
            <div className="text-[9.5px] font-bold">
              {paymentInfo.methodLabel ? `${paymentInfo.methodLabel} · ` : ''}
              Total: {formatCurrency(repair.price)}
            </div>
          </div>
        )}

        {(profile?.receiptTerms ?? DEFAULT_RECEIPT_TERMS).trim() && (
          <div className="border-b border-dashed border-black py-2 text-[8.5px] leading-tight">
            <div className="mb-0.5 font-bold uppercase">Términos y condiciones</div>
            <div className="whitespace-pre-line">
              {profile?.receiptTerms ?? DEFAULT_RECEIPT_TERMS}
            </div>
          </div>
        )}

        <div className="pt-2 text-center text-[9.5px]">
          <div>Seguimiento en línea · Escaneá el QR:</div>
          {trackingQrDataUrl ? (
            <img
              src={trackingQrDataUrl}
              alt={`QR seguimiento ${repair.trackingCode}`}
              className="mx-auto my-1.5 h-24 w-24 border border-black bg-white p-1"
            />
          ) : (
            <div className="break-all font-bold">{trackingUrl}</div>
          )}
          <div className="font-bold">Código: {repair.trackingCode}</div>
          <div className="mt-6 border-t border-black pt-1">Firma y aclaración del cliente</div>
          <div className="mt-2 text-[9px] tracking-widest">--------------------------------</div>
        </div>
      </div>
    );
  };

  const renderThermalWorkshopReceipt = (isPrintMode: boolean) => {
    const physicalEntries = Object.entries(repair.physicalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );
    const functionalEntries = Object.entries(repair.functionalCheck || {}).filter(
      ([, v]) => Boolean(v && String(v).trim())
    );

    return (
      <div
        className={`mx-auto bg-white text-black font-mono text-[11px] leading-snug ${
          isPrintMode
            ? 'w-[74mm] max-w-[76mm] px-1.5 py-2'
            : 'w-full max-w-[302px] rounded-xl border border-slate-300 p-3.5 shadow-xs'
        }`}
      >
        <div className="border-b-2 border-black pb-1.5 text-center">
          <div className="bg-black px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
            Boleta Taller · Interna
          </div>
          <div className="mt-1 text-base font-black">{repair.code}</div>
          <div className="text-[10px] font-bold uppercase">
            Prioridad: {repair.priority} · {statusMeta.label}
          </div>
          <div className="text-[9.5px]">
            Ing: {formatDateShort(repair.dateIn)}
            {repair.dateEst ? ` · Est: ${formatDateShort(repair.dateEst)}` : ''}
          </div>
        </div>

        <div className="border-b border-dashed border-black py-2 text-[10.5px]">
          <div className="font-bold">
            {repair.brand} {repair.model} ({repair.deviceType})
          </div>
          <div>
            Cliente: <strong>{repair.clientName}</strong>
          </div>
          {repair.clientPhone && <div>Tel: {repair.clientPhone}</div>}
          {repair.imei && <div>IMEI/Serie: {repair.imei}</div>}
          {(repair.color || repair.capacity) && (
            <div>{[repair.color, repair.capacity].filter(Boolean).join(' · ')}</div>
          )}
          <div>Accesorios: {accessoriesText}</div>
          {repair.partNames && repair.partNames.length > 0 && (
            <div>Repuestos: {repair.partNames.join(', ')}</div>
          )}
        </div>

        <div className="border-b border-dashed border-black py-2 text-[10.5px]">
          <div className="font-bold uppercase">Falla / Trabajo</div>
          <div>{repair.problem}</div>
          {repair.notes && (
            <div className="mt-1 text-[10px]">
              <strong>Notas:</strong> {repair.notes}
            </div>
          )}
        </div>

        <div className="border-b border-dashed border-black py-2 text-[10.5px]">
          <div className="font-bold uppercase">Seguridad / Desbloqueo</div>
          {repair.securityType === 'pattern' && repair.securityPattern?.length ? (
            <div className="mt-1 flex items-center gap-2">
              <PatternMiniSvg pattern={repair.securityPattern} size={60} />
              <span className="font-bold">{repair.securityPattern.join(' → ')}</span>
            </div>
          ) : (
            <div className="font-bold">{repair.securityPin?.trim() || 'Sin clave'}</div>
          )}
        </div>

        {(physicalEntries.length > 0 || functionalEntries.length > 0) && (
          <div className="space-y-1.5 border-b border-dashed border-black py-2 text-[9.5px] leading-tight">
            {physicalEntries.length > 0 && (
              <div>
                <div className="font-bold uppercase">Check-in Físico</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {physicalEntries.map(([k, v]) => (
                    <span key={k}>
                      {k}: <strong>{v}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {functionalEntries.length > 0 && (
              <div>
                <div className="font-bold uppercase">Check-in Funcional</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {functionalEntries.map(([k, v]) => (
                    <span key={k}>
                      {k}: <strong>{v}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pt-2 text-[10.5px]">
          <div className="flex justify-between">
            <span>Presup: {formatCurrency(repair.price)}</span>
            <span>Seña: {formatCurrency(repair.deposit)}</span>
          </div>
          <div className="flex justify-between font-black">
            <span>SALDO:</span>
            <span>{formatCurrency(pendingBalance)}</span>
          </div>
          <div className="mt-2 text-center text-[9px] tracking-widest">
            --------------------------------
          </div>
        </div>
      </div>
    );
  };

  const renderThermalDeviceLabel = (isPrintMode: boolean) => (
    <div
      className={`mx-auto border-2 border-dashed border-black bg-white text-black font-mono text-[10.5px] leading-snug ${
        isPrintMode
          ? 'w-[74mm] max-w-[76mm] p-2'
          : 'w-full max-w-[302px] rounded-xl p-3 shadow-xs'
      }`}
    >
      <div className="flex items-center justify-between border-b border-black pb-1">
        <div>
          <div className="text-[8.5px] font-bold uppercase">
            {profile?.brandName || 'TH3 BNB'} · Etiqueta
          </div>
          <div className="text-lg font-black leading-none">{repair.code}</div>
        </div>
        <div className="text-right">
          <div className="border border-black px-1 text-[9px] font-bold uppercase">
            {repair.priority}
          </div>
          <div className="text-[9px]">{repair.trackingCode}</div>
        </div>
      </div>

      <div className="mt-1.5 space-y-0.5">
        <div className="flex justify-between gap-2">
          <span>Cliente:</span>
          <strong className="truncate">{repair.clientName}</strong>
        </div>
        {repair.clientPhone && (
          <div className="flex justify-between gap-2">
            <span>Tel:</span>
            <strong>{repair.clientPhone}</strong>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span>Equipo:</span>
          <strong className="truncate">
            {repair.brand} {repair.model}
          </strong>
        </div>
        {(repair.color || repair.imei) && (
          <div className="flex justify-between gap-2 text-[9.5px]">
            <span>{repair.color ? `Color: ${repair.color}` : 'IMEI:'}</span>
            <span className="truncate">{repair.imei || repair.capacity || ''}</span>
          </div>
        )}
        <div className="border-y border-dashed border-black py-1 text-[10px]">
          <strong>Falla:</strong> {repair.problem}
        </div>
        <div className="flex justify-between gap-2 text-[9.5px]">
          <strong>{securityText}</strong>
          <span>Acc: {accessoriesText}</span>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between border-t border-black pt-1 text-[9.5px]">
        <span>Ing: {formatDateShort(repair.dateIn)}</span>
        <span>Est: {repair.dateEst ? formatDateShort(repair.dateEst) : 'A conf.'}</span>
        <strong>Saldo: {formatCurrency(pendingBalance)}</strong>
      </div>
    </div>
  );

  return (
    <>
      {printFormat === 'thermal80' && (
        <style>{`@media print { @page { size: 80mm auto; margin: 2mm; } }`}</style>
      )}

      <div className="space-y-4">
        {justCreated && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Check className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold text-emerald-950 dark:text-emerald-200">
                  Orden {repair.code} guardada · Comprobantes listos para imprimir
                </div>
                <div className="text-xs text-emerald-800 dark:text-emerald-300">
                  Se generaron la Boleta del Cliente, la Boleta de Taller y la Etiqueta del Equipo.
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={whatsappPdfHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void handleDownloadClientPdf(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                PDF + WhatsApp
              </a>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={selectedCount === 0}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-700 bg-white px-3.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:bg-slate-900 dark:text-emerald-300"
              >
                <Printer className="h-4 w-4" />
                Imprimir ({selectedCount})
              </button>
            </div>
          </div>
        )}

        {justPaid && !justCreated && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Check className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold text-emerald-950 dark:text-emerald-200">
                  Pago registrado · Boleta con sello PAGO lista para imprimir
                </div>
                <div className="text-xs text-emerald-800 dark:text-emerald-300">
                  Cliente: {repair.clientName}
                  {paymentInfo.methodLabel ? ` · Medio: ${paymentInfo.methodLabel}` : ''} · Total:{' '}
                  {formatCurrency(repair.price)}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={whatsappPdfHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void handleDownloadClientPdf(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                PDF + WhatsApp
              </a>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={selectedCount === 0}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-700 bg-white px-3.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:bg-slate-900 dark:text-emerald-300"
              >
                <Printer className="h-4 w-4" />
                Imprimir boleta
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Formato:
              </span>
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setPrintFormat('a4')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                    printFormat === 'a4'
                      ? 'bg-[#0072BB] text-white'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Hoja A4
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal80')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                    printFormat === 'thermal80'
                      ? 'bg-[#0072BB] text-white'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <ReceiptText className="h-3.5 w-3.5" />
                  Térmico 80mm
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDownloadClientPdf(false)}
                disabled={generatingPdf}
                title="Descargar PDF de la Boleta del Cliente"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
              >
                <FileDown className="h-4 w-4" />
                {generatingPdf ? 'Generando...' : 'PDF Cliente'}
              </button>

              {canNativeSharePdf && (
                <button
                  type="button"
                  onClick={() => void handleNativeShareClientPdf()}
                  disabled={generatingPdf}
                  title="Compartir archivo PDF directo a WhatsApp u otras apps"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Share2 className="h-4 w-4" />
                  Compartir PDF
                </button>
              )}

              <a
                href={whatsappPdfHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void handleDownloadClientPdf(true)}
                title="Descargar PDF de Boleta Cliente y abrir WhatsApp para enviarlo"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp PDF
              </a>

              <button
                type="button"
                onClick={() => window.print()}
                disabled={selectedCount === 0}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                {printFormat === 'thermal80'
                  ? `Imprimir 80mm (${selectedCount})`
                  : `Imprimir seleccionados (${selectedCount})`}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2.5 dark:border-slate-700/60">
            <button
              type="button"
              onClick={selectAll}
              className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition ${
                selectedCount === 3
                  ? 'bg-[#0072BB] text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
              }`}
            >
              Todo (3)
            </button>

            {(
              [
                { key: 'client', label: 'Boleta Cliente', icon: FileText },
                { key: 'workshop', label: 'Boleta Taller', icon: Wrench },
                { key: 'label', label: 'Etiqueta Equipo', icon: Tag },
              ] as const
            ).map(({ key, label, icon: Icon }) => {
              const active = selectedDocs[key];
              return (
                <div key={key} className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => toggleDoc(key)}
                    className={`inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-semibold transition ${
                      active
                        ? 'bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300'
                        : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                    title="Incluir / quitar de la impresión"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[10px] ${
                        active
                          ? 'border-[#0072BB] bg-[#0072BB] text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {active && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectOnly(key)}
                    className="h-8 border-l border-slate-200 px-2 text-[10px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                    title={`Seleccionar solo ${label}`}
                  >
                    Solo
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {selectedCount === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
            Seleccioná al menos un comprobante o etiqueta para previsualizar e imprimir.
          </div>
        ) : (
          <div className="space-y-5">
            {selectedDocs.client && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  1 · Boleta para el cliente {printFormat === 'thermal80' ? '(80mm)' : ''}
                </div>
                {printFormat === 'thermal80'
                  ? renderThermalClientReceipt(false)
                  : renderClientReceipt(false)}
              </div>
            )}

            {selectedDocs.workshop && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  2 · Boleta interna del taller {printFormat === 'thermal80' ? '(80mm)' : ''}
                </div>
                {printFormat === 'thermal80'
                  ? renderThermalWorkshopReceipt(false)
                  : renderWorkshopReceipt(false)}
              </div>
            )}

            {selectedDocs.label && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  3 · Etiqueta adhesiva para el equipo {printFormat === 'thermal80' ? '(80mm)' : ''}
                </div>
                {printFormat === 'thermal80'
                  ? renderThermalDeviceLabel(false)
                  : renderDeviceLabel(false)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Print-only layout rendered cleanly when user triggers window.print() */}
      <div className="print-only hidden text-slate-900">
        {printFormat === 'thermal80' ? (
          <>
            {selectedDocs.client && (
              <div
                className={
                  selectedDocs.workshop || selectedDocs.label ? 'break-after-page' : ''
                }
              >
                {renderThermalClientReceipt(true)}
              </div>
            )}
            {selectedDocs.workshop && (
              <div className={selectedDocs.label ? 'break-after-page' : ''}>
                {renderThermalWorkshopReceipt(true)}
              </div>
            )}
            {selectedDocs.label && <div>{renderThermalDeviceLabel(true)}</div>}
          </>
        ) : (
          <>
            {selectedDocs.client && (
              <div
                className={
                  selectedDocs.workshop || selectedDocs.label ? 'break-after-page' : ''
                }
              >
                {renderClientReceipt(true)}
              </div>
            )}

            {selectedDocs.workshop && (
              <div className="break-inside-avoid">
                {renderWorkshopReceipt(true)}
              </div>
            )}

            {selectedDocs.label && (
              <div className="break-inside-avoid px-7 pb-6 pt-4">
                {selectedDocs.workshop && (
                  <div className="mb-4 flex items-center gap-2 text-[10px] text-slate-400">
                    <Scissors className="h-3.5 w-3.5" />
                    <div className="flex-1 border-b border-dashed border-slate-300" />
                    <span>Recortar etiqueta para pegar en el equipo</span>
                    <div className="flex-1 border-b border-dashed border-slate-300" />
                  </div>
                )}
                {renderDeviceLabel(true)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};
