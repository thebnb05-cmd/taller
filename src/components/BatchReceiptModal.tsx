import React, { useMemo, useState } from 'react';
import {
  Check,
  FileDown,
  FileText,
  Layers,
  MessageCircle,
  Printer,
  ReceiptText,
  Scissors,
  Share2,
  Tag,
} from 'lucide-react';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import type { RepairRecord, WorkshopProfile } from '../types/workshop';
import { formatCurrency, formatDateShort } from '../utils/formatters';
import {
  buildBatchRepairReceiptPdf,
  downloadBatchRepairReceiptPdf,
} from '../utils/pdfReport';
import { BrandMark } from './BrandMark';
import { ModalShell } from './ModalShell';
import type { PrintFormat } from './RepairPrintDocuments';
import { useToast } from './ToastProvider';

interface BatchReceiptModalProps {
  open: boolean;
  repairs: RepairRecord[];
  batchRef: string;
  profile?: WorkshopProfile | null;
  onClose: () => void;
  onSelectRepair?: (repair: RepairRecord) => void;
}

function getAccessoriesLabel(r: RepairRecord): string {
  if (r.accessories && r.accessories.length > 0) {
    return r.accessories.join(', ');
  }
  if (r.consoleAccessories && Object.keys(r.consoleAccessories).length > 0) {
    const selected = Object.entries(r.consoleAccessories)
      .filter(([, v]) => v === 'Sí')
      .map(([k]) => k)
      .join(', ');
    return selected || 'Ninguno';
  }
  return 'Ninguno';
}

function getSecurityLabel(r: RepairRecord): string {
  if (r.securityType === 'pattern' && r.securityPattern?.length) {
    return `Patrón: ${r.securityPattern.join(' → ')}`;
  }
  if (r.securityPin?.trim()) {
    return `PIN/Clave: ${r.securityPin}`;
  }
  return 'Sin clave';
}

export const BatchReceiptModal: React.FC<BatchReceiptModalProps> = ({
  open,
  repairs,
  batchRef,
  profile,
  onClose,
  onSelectRepair,
}) => {
  const { notify } = useToast();
  const [printFormat, setPrintFormat] = useState<PrintFormat>('a4');
  const [includeClientReceipt, setIncludeClientReceipt] = useState(true);
  const [includeLabels, setIncludeLabels] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const first = repairs[0];
  const totalBudget = useMemo(
    () => repairs.reduce((sum, r) => sum + Number(r.price || 0), 0),
    [repairs]
  );
  const totalDeposit = useMemo(
    () => repairs.reduce((sum, r) => sum + Number(r.deposit || 0), 0),
    [repairs]
  );
  const totalPending = Math.max(0, totalBudget - totalDeposit);

  const canNativeSharePdf = useMemo(() => {
    try {
      if (
        typeof navigator === 'undefined' ||
        typeof navigator.share !== 'function' ||
        typeof navigator.canShare !== 'function'
      ) {
        return false;
      }
      const isTouch =
        typeof window !== 'undefined' &&
        (window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0);
      if (!isTouch) return false;
      const testFile = new File([''], 'boleta-lote.pdf', { type: 'application/pdf' });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  }, []);

  const cleanPhoneForWa = (first?.clientPhone || '').replace(/[^\d]/g, '');
  const waMessage = useMemo(() => {
    if (!first) return '';
    const brand = profile?.brandName || 'TH3 BNB Servicio Técnico';
    const orderLines = repairs
      .map(
        (r, i) =>
          `${i + 1}. ${r.code} (${r.deviceType}: ${r.brand} ${r.model}) — ${formatCurrency(r.price)}`
      )
      .join('\n');
    return (
      `Hola ${first.clientName}, te enviamos la boleta múltiple de ${brand}.\n` +
      `Referencia: ${batchRef} · ${repairs.length} equipos:\n` +
      `${orderLines}\n` +
      `Total: ${formatCurrency(totalBudget)}` +
      `${totalDeposit > 0 ? ` · Seña: ${formatCurrency(totalDeposit)}` : ''}` +
      ` · Saldo pendiente: ${formatCurrency(totalPending)}.`
    );
  }, [batchRef, first, profile?.brandName, repairs, totalBudget, totalDeposit, totalPending]);

  const whatsappHref = cleanPhoneForWa
    ? `https://wa.me/${cleanPhoneForWa}?text=${encodeURIComponent(waMessage)}`
    : `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

  if (!open || repairs.length === 0 || !first) return null;

  const handleDownloadPdf = async (forWhatsApp = false) => {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const { fileName } = await downloadBatchRepairReceiptPdf({
        repairs,
        batchRef,
        profile,
      });
      notify(
        forWhatsApp
          ? `PDF del lote descargado (${fileName}). Adjuntalo en el chat de WhatsApp.`
          : `PDF del lote descargado (${fileName}).`
      );
    } catch (err) {
      console.error(err);
      notify('No se pudo generar el PDF del lote.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleNativeSharePdf = async () => {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const { fileName, blob } = await buildBatchRepairReceiptPdf({
        repairs,
        batchRef,
        profile,
      });
      const pdfFile = new File([blob], fileName, { type: 'application/pdf' });
      await navigator.share({
        title: `Boleta Lote ${batchRef}`,
        text: waMessage,
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

  const orderRangeLabel =
    repairs.length > 1
      ? `${repairs[0].code} a ${repairs[repairs.length - 1].code}`
      : repairs[0].code;

  const renderConsolidatedA4 = (isPrintMode: boolean) => (
    <div
      className={`bg-white text-slate-900 ${
        isPrintMode ? 'p-7' : 'rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-col items-start gap-1.5">
          <div className="inline-block rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0072BB]">
            Boleta Cliente · Ingreso Múltiple / Gremio
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
            Ref. {batchRef}
          </div>
          <div className="font-mono-num text-xs font-semibold text-[#0072BB]">
            {repairs.length} equipos · Órdenes {orderRangeLabel}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Ingreso: {formatDateShort(first.dateIn)}
          </div>
          {first.dateEst && (
            <div className="text-xs text-slate-500">
              Entrega est.: {formatDateShort(first.dateEst)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-xs">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Datos del cliente / gremio
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
          <strong className="text-sm text-slate-900">{first.clientName}</strong>
          {first.clientPhone && <span>Tel: {first.clientPhone}</span>}
          {first.clientDni && <span>DNI: {first.clientDni}</span>}
          {first.clientAddress && <span>Dir: {first.clientAddress}</span>}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2">Orden / Seg.</th>
              <th className="px-3 py-2">Equipo</th>
              <th className="px-3 py-2">Falla y accesorios</th>
              <th className="px-3 py-2 text-right">Presup.</th>
              <th className="px-3 py-2 text-right">Seña</th>
              <th className="px-3 py-2 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {repairs.map((r) => {
              const pending = Math.max(0, Number(r.price || 0) - Number(r.deposit || 0));
              const specs = [r.color, r.capacity].filter(Boolean).join(' · ');
              const acc = getAccessoriesLabel(r);
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {!isPrintMode && onSelectRepair ? (
                      <button
                        type="button"
                        onClick={() => onSelectRepair(r)}
                        className="font-mono-num font-bold text-[#0072BB] hover:underline"
                      >
                        {r.code}
                      </button>
                    ) : (
                      <div className="font-mono-num font-bold text-slate-900">{r.code}</div>
                    )}
                    <div className="font-mono-num text-[10px] text-slate-500">
                      {r.trackingCode}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-bold text-slate-900">
                      {r.deviceType} · {r.brand} {r.model}
                    </div>
                    {specs && <div className="text-[11px] text-slate-500">{specs}</div>}
                    {r.imei && (
                      <div className="font-mono-num text-[10px] text-slate-500">
                        IMEI/Serie: {r.imei}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-slate-800">{r.problem}</div>
                    {acc !== 'Ninguno' && (
                      <div className="mt-0.5 text-[10px] text-slate-500">Acc: {acc}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-num font-semibold whitespace-nowrap">
                    {formatCurrency(r.price)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-num font-semibold text-emerald-700 whitespace-nowrap">
                    {formatCurrency(r.deposit)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-num font-bold text-slate-900 whitespace-nowrap">
                    {formatCurrency(pending)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-200 py-3 text-center text-xs">
        <div>
          <div className="text-slate-500">Total Presupuesto</div>
          <div className="font-mono-num text-sm font-bold text-slate-900">
            {formatCurrency(totalBudget)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Total Seña / Anticipo</div>
          <div className="font-mono-num text-sm font-bold text-emerald-700">
            {formatCurrency(totalDeposit)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Saldo Pendiente Total</div>
          <div className="font-mono-num text-sm font-bold text-slate-900">
            {formatCurrency(totalPending)}
          </div>
        </div>
      </div>

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
        <div>
          <div className="font-semibold text-slate-800">Referencia de lote: {batchRef}</div>
          <div className="text-[10px] text-slate-500">
            Conservar este comprobante para retirar los {repairs.length} equipos.
          </div>
        </div>
        <div className="text-right">
          <div className="mt-4 w-52 border-b border-slate-400" />
          <div className="mt-1 text-[10px] text-slate-500">Firma y aclaración del cliente</div>
        </div>
      </div>
    </div>
  );

  const renderConsolidatedThermal = (isPrintMode: boolean) => (
    <div
      className={`bg-white font-mono-num text-[11px] leading-snug text-black ${
        isPrintMode
          ? 'mx-auto w-[74mm] p-2'
          : 'mx-auto w-full max-w-[310px] rounded-xl border border-slate-300 p-4 shadow-xs'
      }`}
    >
      <div className="border-b border-dashed border-black pb-2 text-center">
        <div className="text-[10px] font-bold uppercase tracking-wider">
          Boleta Cliente · Lote Múltiple
        </div>
        <div className="mt-0.5 text-sm font-black uppercase">
          {profile?.brandName || 'TH3 BNB Servicio Técnico'}
        </div>
        {profile?.businessAddress && <div className="text-[10px]">{profile.businessAddress}</div>}
        {profile?.businessPhone && <div className="text-[10px]">Tel: {profile.businessPhone}</div>}
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10px]">
        <div className="flex justify-between font-bold">
          <span>Ref. Lote: {batchRef}</span>
          <span>{repairs.length} equipos</span>
        </div>
        <div className="flex justify-between">
          <span>Órdenes: {orderRangeLabel}</span>
          <span>{formatDateShort(first.dateIn)}</span>
        </div>
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10px]">
        <div className="font-bold uppercase">{first.clientName}</div>
        {first.clientPhone && <div>Tel: {first.clientPhone}</div>}
        {first.clientDni && <div>DNI: {first.clientDni}</div>}
      </div>

      <div className="divide-y divide-dashed divide-black border-b border-dashed border-black">
        {repairs.map((r, idx) => {
          const pending = Math.max(0, Number(r.price || 0) - Number(r.deposit || 0));
          return (
            <div key={r.id} className="py-2 text-[10px]">
              <div className="flex justify-between font-bold">
                <span>
                  #{idx + 1} · {r.code}
                </span>
                <span>{formatCurrency(r.price)}</span>
              </div>
              <div className="font-bold">
                {r.deviceType} · {r.brand} {r.model}
              </div>
              {r.imei && <div>IMEI/Serie: {r.imei}</div>}
              <div>Falla: {r.problem}</div>
              <div className="flex justify-between text-[9.5px]">
                <span>Seg: {r.trackingCode}</span>
                <span>Saldo: {formatCurrency(pending)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10px]">
        <div className="flex justify-between">
          <span>Total Presupuesto:</span>
          <strong>{formatCurrency(totalBudget)}</strong>
        </div>
        <div className="flex justify-between">
          <span>Total Seña:</span>
          <strong>{formatCurrency(totalDeposit)}</strong>
        </div>
        <div className="flex justify-between text-xs font-black">
          <span>SALDO PENDIENTE:</span>
          <span>{formatCurrency(totalPending)}</span>
        </div>
      </div>

      <div className="pt-4 text-center text-[9.5px]">
        <div className="mx-auto mb-1 w-44 border-b border-black" />
        <div>Firma y aclaración</div>
      </div>
    </div>
  );

  const renderDeviceLabels = (isPrintMode: boolean) => (
    <div
      className={
        printFormat === 'thermal80'
          ? 'space-y-3'
          : 'grid gap-3 sm:grid-cols-2'
      }
    >
      {repairs.map((r) => {
        const pending = Math.max(0, Number(r.price || 0) - Number(r.deposit || 0));
        return (
          <div
            key={r.id}
            className={`break-inside-avoid rounded-xl border-2 border-dashed border-slate-400 bg-white p-3 text-[11px] text-slate-900 ${
              isPrintMode && printFormat === 'thermal80' ? 'mx-auto w-[74mm]' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1.5">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wide text-[#0072BB]">
                  {batchRef} · Etiqueta Equipo
                </div>
                <div className="font-mono-num text-sm font-black text-slate-900">
                  {r.code}
                </div>
              </div>
              <div className="text-right font-mono-num text-[10px] text-slate-500">
                <div>{r.trackingCode}</div>
                <div>{formatDateShort(r.dateIn)}</div>
              </div>
            </div>
            <div className="mt-1.5 space-y-0.5 text-[10.5px]">
              <div>
                <strong>Cliente:</strong> {r.clientName}
              </div>
              <div>
                <strong>Equipo:</strong> {r.deviceType} · {r.brand} {r.model}
              </div>
              {r.imei && (
                <div className="font-mono-num">
                  <strong>IMEI/Serie:</strong> {r.imei}
                </div>
              )}
              <div>
                <strong>Falla:</strong> {r.problem}
              </div>
              <div className="flex justify-between gap-2 pt-0.5 text-[10px]">
                <strong>{getSecurityLabel(r)}</strong>
                <span className="font-mono-num font-bold">
                  Saldo: {formatCurrency(pending)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const selectedCount = (includeClientReceipt ? 1 : 0) + (includeLabels ? 1 : 0);

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        title={`Boleta múltiple · ${batchRef}`}
        subtitle={`${repairs.length} equipos cargados para ${first.clientName}`}
        maxWidth="3xl"
      >
        {printFormat === 'thermal80' && (
          <style>{`@media print { @page { size: 80mm auto; margin: 2mm; } }`}</style>
        )}

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Layers className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold text-emerald-950 dark:text-emerald-200">
                  Lote {batchRef} guardado · {repairs.length} órdenes generadas ({orderRangeLabel})
                </div>
                <div className="text-xs text-emerald-800 dark:text-emerald-300">
                  Tenés una sola boleta consolidada con todas las órdenes y el total general ({formatCurrency(totalBudget)}).
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void handleDownloadPdf(true)}
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
                Imprimir
              </button>
            </div>
          </div>

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
                  onClick={() => void handleDownloadPdf(false)}
                  disabled={generatingPdf}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
                >
                  <FileDown className="h-4 w-4" />
                  {generatingPdf ? 'Generando...' : 'PDF Lote'}
                </button>

                {canNativeSharePdf && (
                  <button
                    type="button"
                    onClick={() => void handleNativeSharePdf()}
                    disabled={generatingPdf}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Share2 className="h-4 w-4" />
                    Compartir PDF
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={selectedCount === 0}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  Imprimir seleccionados
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2.5 dark:border-slate-700/60">
              <button
                type="button"
                onClick={() => setIncludeClientReceipt((v) => !v)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                  includeClientReceipt
                    ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-300'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                }`}
              >
                <Check className={`h-3.5 w-3.5 ${includeClientReceipt ? 'opacity-100' : 'opacity-25'}`} />
                <FileText className="h-3.5 w-3.5" />
                Boleta Cliente Consolidada (1 hoja)
              </button>

              <button
                type="button"
                onClick={() => setIncludeLabels((v) => !v)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                  includeLabels
                    ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-300'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                }`}
              >
                <Check className={`h-3.5 w-3.5 ${includeLabels ? 'opacity-100' : 'opacity-25'}`} />
                <Tag className="h-3.5 w-3.5" />
                Etiquetas para cada equipo ({repairs.length})
              </button>
            </div>
          </div>

          {selectedCount === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
              Seleccioná al menos un comprobante o etiqueta para previsualizar e imprimir.
            </div>
          ) : (
            <div className="space-y-5">
              {includeClientReceipt && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    1 · Boleta consolidada ({batchRef})
                  </div>
                  {printFormat === 'thermal80'
                    ? renderConsolidatedThermal(false)
                    : renderConsolidatedA4(false)}
                </div>
              )}

              {includeLabels && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    2 · Etiquetas adhesivas por equipo ({repairs.length})
                  </div>
                  {renderDeviceLabels(false)}
                </div>
              )}
            </div>
          )}
        </div>
      </ModalShell>

      {/* Print-only view */}
      <div className="print-only hidden text-slate-900">
        {includeClientReceipt && (
          <div className={includeLabels ? 'break-after-page' : ''}>
            {printFormat === 'thermal80'
              ? renderConsolidatedThermal(true)
              : renderConsolidatedA4(true)}
          </div>
        )}
        {includeLabels && (
          <div className={printFormat === 'thermal80' ? 'p-2' : 'p-7'}>
            <div className="mb-3 flex items-center gap-2 text-[10px] text-slate-400">
              <Scissors className="h-3.5 w-3.5" />
              <div className="flex-1 border-b border-dashed border-slate-300" />
              <span>Etiquetas · {batchRef}</span>
              <div className="flex-1 border-b border-dashed border-slate-300" />
            </div>
            {renderDeviceLabels(true)}
          </div>
        )}
      </div>
    </>
  );
};
