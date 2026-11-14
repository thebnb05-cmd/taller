import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Copy, FileText, MessageCircle, Printer, ReceiptText } from 'lucide-react';
import type { ClientRecord, SaleRecord, WorkshopProfile } from '../types/workshop';
import { formatCurrency, formatDateShort } from '../utils/formatters';
import {
  buildTransferQrPayload,
  buildTransferWhatsAppText,
  loadTransferConfig,
} from '../utils/payment';
import { parseSalePaymentInfo } from '../utils/saleMeta';
import { BrandMark } from './BrandMark';
import { ModalShell } from './ModalShell';
import type { PrintFormat } from './RepairPrintDocuments';
import { useToast } from './ToastProvider';

interface SalePrintModalProps {
  sale: SaleRecord | null;
  onClose: () => void;
  profile?: WorkshopProfile | null;
  clients?: ClientRecord[];
}

export const SalePrintModal: React.FC<SalePrintModalProps> = ({
  sale,
  onClose,
  profile,
  clients = [],
}) => {
  const { notify } = useToast();
  const [printFormat, setPrintFormat] = useState<PrintFormat>('a4');
  const [transferQrDataUrl, setTransferQrDataUrl] = useState('');

  const paymentInfo = useMemo(
    () => (sale ? parseSalePaymentInfo(sale) : null),
    [sale]
  );

  const transferCfg = useMemo(
    () => (sale ? loadTransferConfig(sale.ownerId) : loadTransferConfig('')),
    [sale]
  );

  const matchedClient = useMemo(() => {
    if (!sale) return undefined;
    return clients.find(
      (c) =>
        (sale.clientId && c.id === sale.clientId) ||
        c.name.trim().toLowerCase() === sale.clientName.trim().toLowerCase()
    );
  }, [sale, clients]);

  useEffect(() => {
    if (!sale || !paymentInfo || paymentInfo.method !== 'transferencia') {
      setTransferQrDataUrl('');
      return;
    }
    if (transferCfg.qrImageDataUrl) {
      setTransferQrDataUrl(transferCfg.qrImageDataUrl);
      return;
    }
    const chargeAmount = paymentInfo.pending > 0 ? paymentInfo.pending : sale.amount;
    const payload = buildTransferQrPayload(
      transferCfg,
      profile?.brandName || 'TH3 BNB Servicio Técnico',
      sale.invoice || 'VENTA',
      sale.clientName,
      chargeAmount
    );
    if (!payload) {
      setTransferQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setTransferQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTransferQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [sale, paymentInfo, transferCfg, profile?.brandName]);

  if (!sale || !paymentInfo) return null;

  const qty = Math.max(1, Number(sale.quantity || 1));
  const unitPrice = qty > 0 ? Number(sale.amount || 0) / qty : Number(sale.amount || 0);
  const statusLabel = paymentInfo.isPaid
    ? 'Cobrado'
    : paymentInfo.deposit > 0
      ? 'Señado'
      : 'Pendiente';

  const isTransfer = paymentInfo.method === 'transferencia';
  const transferAmount = paymentInfo.pending > 0 ? paymentInfo.pending : sale.amount;
  const hasTransferDetails = Boolean(
    transferCfg.alias.trim() ||
      transferCfg.cbu.trim() ||
      transferCfg.holder.trim() ||
      transferCfg.paymentLink.trim() ||
      transferQrDataUrl
  );

  const handleCopyText = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify(`${label} copiado.`);
    } catch {
      notify('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const transferWaText = buildTransferWhatsAppText(transferCfg, {
    brandName: profile?.brandName || 'TH3 BNB Servicio Técnico',
    code: sale.invoice || 'Venta',
    clientName: sale.clientName,
    amount: transferAmount,
  });
  const cleanPhone = (matchedClient?.phone || '').replace(/[^\d]/g, '');
  const transferWaHref = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(transferWaText)}`
    : `https://wa.me/?text=${encodeURIComponent(transferWaText)}`;

  const renderA4Boleta = (isPrintMode: boolean) => (
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
            Boleta de Venta · Comprobante
          </div>
          <div>
            <BrandMark profile={profile} size="lg" forceLight />
          </div>
          <p className="flex flex-col gap-0.5 text-xs text-slate-600">
            <span>{profile?.businessAddress || 'Servicio técnico especializado y accesorios'}</span>
            {profile?.businessPhone && <span>Tel: {profile.businessPhone}</span>}
          </p>
        </div>

        <div className="text-right">
          <div className="font-mono-num text-lg font-extrabold text-slate-900">
            {sale.invoice || 'Boleta de venta'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Fecha: {formatDateShort(sale.dueDate)}
          </div>
          <div className="mt-1 inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
            Estado: {statusLabel}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Datos del cliente
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">{sale.clientName}</div>
          {matchedClient?.phone && <div>Tel: {matchedClient.phone}</div>}
          {matchedClient?.dni && <div>DNI: {matchedClient.dni}</div>}
          {matchedClient?.address && <div>Dir: {matchedClient.address}</div>}
        </div>

        <div className="rounded-xl border border-slate-200/80 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Condición y medio de pago
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">
            {paymentInfo.methodLabel || 'A confirmar'}
          </div>
          <div className="mt-0.5 text-slate-600">
            Comprobante: <span className="font-mono-num font-semibold">{sale.invoice}</span>
          </div>
          <div className="text-slate-600">Estado de cobro: {statusLabel}</div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Detalle / Producto</th>
              <th className="px-3 py-2 text-center">Cant.</th>
              <th className="px-3 py-2 text-right">Unitario</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-slate-900">
              <td className="px-3 py-2.5 font-semibold">
                {sale.productName || 'Venta de mostrador / servicio'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono-num">{qty}</td>
              <td className="px-3 py-2.5 text-right font-mono-num">
                {formatCurrency(unitPrice)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono-num font-bold">
                {formatCurrency(sale.amount)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-200 py-3 text-center text-xs">
        <div>
          <div className="text-slate-500">Total venta</div>
          <div className="font-mono-num text-sm font-bold text-slate-900">
            {formatCurrency(sale.amount)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Anticipo / Seña</div>
          <div className="font-mono-num text-sm font-bold text-emerald-700">
            {formatCurrency(paymentInfo.deposit)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Saldo pendiente</div>
          <div className="font-mono-num text-sm font-bold text-slate-900">
            {formatCurrency(paymentInfo.pending)}
          </div>
        </div>
      </div>

      {isTransfer && (hasTransferDetails || !isPrintMode) && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-3.5 text-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            {transferQrDataUrl && (
              <div className="flex shrink-0 flex-col items-center rounded-xl border border-slate-200 bg-white p-2">
                <img
                  src={transferQrDataUrl}
                  alt="QR para transferir"
                  className="h-28 w-28 object-contain"
                />
                <span className="mt-1 text-[10px] font-semibold text-slate-500">
                  {transferCfg.qrImageDataUrl ? 'QR oficial MP / Banco' : 'Escaneá para pagar'}
                </span>
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#0072BB]">
                  Datos para transferencia
                </span>
                <span className="font-mono-num text-sm font-extrabold text-slate-900">
                  {paymentInfo.pending > 0 ? 'A transferir: ' : 'Monto: '}
                  {formatCurrency(transferAmount)}
                </span>
              </div>

              {transferCfg.alias.trim() && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5">
                  <span className="truncate text-slate-700">
                    <strong>Alias:</strong>{' '}
                    <span className="font-mono-num font-bold text-slate-900">
                      {transferCfg.alias}
                    </span>
                  </span>
                  {!isPrintMode && (
                    <button
                      type="button"
                      onClick={() => void handleCopyText(transferCfg.alias.trim(), 'Alias')}
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#0072BB] hover:underline"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </button>
                  )}
                </div>
              )}

              {transferCfg.cbu.trim() && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5">
                  <span className="truncate text-slate-700">
                    <strong>CBU / CVU:</strong>{' '}
                    <span className="font-mono-num font-bold text-slate-900">
                      {transferCfg.cbu}
                    </span>
                  </span>
                  {!isPrintMode && (
                    <button
                      type="button"
                      onClick={() => void handleCopyText(transferCfg.cbu.trim(), 'CBU/CVU')}
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#0072BB] hover:underline"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </button>
                  )}
                </div>
              )}

              {transferCfg.holder.trim() && (
                <div className="text-slate-700">
                  <strong>Titular:</strong> {transferCfg.holder}
                </div>
              )}

              {transferCfg.paymentLink.trim() && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5">
                  <span className="truncate text-slate-700">
                    <strong>Link de pago:</strong> {transferCfg.paymentLink.trim()}
                  </span>
                  {!isPrintMode && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopyText(transferCfg.paymentLink.trim(), 'Link de pago')
                      }
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#0072BB] hover:underline"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </button>
                  )}
                </div>
              )}

              {!hasTransferDetails && !isPrintMode && (
                <p className="text-[11px] text-slate-600">
                  No hay Alias ni CBU cargados todavía. Podés cargarlos desde &quot;Nueva venta&quot; al elegir Transferencia.
                </p>
              )}

              {hasTransferDetails && !isPrintMode && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyText(transferWaText, 'Datos de transferencia')
                    }
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Copy className="h-3 w-3" />
                    Copiar datos + monto
                  </button>
                  <a
                    href={transferWaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                  >
                    <MessageCircle className="h-3 w-3" />
                    Enviar por WhatsApp
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {paymentInfo.isPaid && (
        <div className="mt-3 flex justify-end">
          <div className="inline-block -rotate-2 rounded-lg border-2 border-emerald-700 bg-emerald-50/90 px-4 py-2 text-center text-emerald-900 ring-1 ring-emerald-700/40 ring-offset-2">
            <div className="text-base font-black uppercase tracking-[0.22em] text-emerald-800">
              PAGO
            </div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-900">
              {sale.clientName}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-emerald-800">
              {paymentInfo.methodLabel ? `${paymentInfo.methodLabel} · ` : ''}
              {formatCurrency(sale.amount)}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-dashed border-slate-300 pt-4 text-[11px] text-slate-500">
        <div>Gracias por su compra · Conserve este comprobante</div>
        <div className="w-56 border-t border-slate-400 pt-1 text-center text-[10px] text-slate-600">
          Firma y aclaración del cliente
        </div>
      </div>
    </div>
  );

  const renderThermalBoleta = (isPrintMode: boolean) => (
    <div
      className={`mx-auto bg-white font-mono text-black ${
        isPrintMode
          ? 'w-[74mm] px-1 py-2 text-[11px] leading-tight'
          : 'w-full max-w-[78mm] rounded-xl border border-slate-300 p-4 text-[11px] leading-tight shadow-xs'
      }`}
    >
      <div className="border-b border-dashed border-black pb-2 text-center">
        <div className="text-sm font-black uppercase tracking-tight">
          {profile?.brandName || 'TH3 BNB Servicio Técnico'}
        </div>
        {profile?.businessAddress && (
          <div className="mt-0.5 text-[10px]">{profile.businessAddress}</div>
        )}
        {profile?.businessPhone && (
          <div className="text-[10px]">Tel: {profile.businessPhone}</div>
        )}
        <div className="mt-1.5 border border-black px-1.5 py-0.5 text-[10px] font-bold uppercase">
          Boleta de Venta
        </div>
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10.5px]">
        <div className="flex justify-between">
          <span className="font-bold">Comprobante:</span>
          <span className="font-bold">{sale.invoice}</span>
        </div>
        <div className="flex justify-between">
          <span>Fecha:</span>
          <span>{formatDateShort(sale.dueDate)}</span>
        </div>
        <div className="flex justify-between">
          <span>Pago:</span>
          <span className="font-bold">{paymentInfo.methodLabel || 'A confirmar'}</span>
        </div>
        <div className="flex justify-between">
          <span>Estado:</span>
          <span className="font-bold uppercase">{statusLabel}</span>
        </div>
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10.5px]">
        <div className="font-bold uppercase">Cliente</div>
        <div className="font-bold">{sale.clientName}</div>
        {matchedClient?.phone && <div>Tel: {matchedClient.phone}</div>}
        {matchedClient?.dni && <div>DNI: {matchedClient.dni}</div>}
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10.5px]">
        <div className="font-bold uppercase">Detalle</div>
        <div className="mt-0.5 font-bold">
          {sale.productName || 'Venta de mostrador / servicio'}
        </div>
        <div className="mt-0.5 flex justify-between text-[10px]">
          <span>
            {qty} × {formatCurrency(unitPrice)}
          </span>
          <strong>{formatCurrency(sale.amount)}</strong>
        </div>
      </div>

      <div className="border-b border-dashed border-black py-2 text-[11px]">
        <div className="flex justify-between">
          <span>Total venta:</span>
          <strong>{formatCurrency(sale.amount)}</strong>
        </div>
        <div className="flex justify-between">
          <span>Anticipo / Seña:</span>
          <strong>{formatCurrency(paymentInfo.deposit)}</strong>
        </div>
        <div className="mt-0.5 flex justify-between border-t border-dotted border-black pt-1 text-xs font-black">
          <span>SALDO PENDIENTE:</span>
          <span>{formatCurrency(paymentInfo.pending)}</span>
        </div>
      </div>

      {isTransfer && (hasTransferDetails || !isPrintMode) && (
        <div className="border-b border-dashed border-black py-2 text-[10.5px]">
          <div className="font-bold uppercase">Datos para transferencia</div>
          {transferCfg.alias.trim() && (
            <div className="mt-0.5 flex items-center justify-between gap-1">
              <span className="break-all">
                Alias: <strong>{transferCfg.alias}</strong>
              </span>
              {!isPrintMode && (
                <button
                  type="button"
                  onClick={() => void handleCopyText(transferCfg.alias.trim(), 'Alias')}
                  className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#0072BB]"
                >
                  Copiar
                </button>
              )}
            </div>
          )}
          {transferCfg.cbu.trim() && (
            <div className="mt-0.5 flex items-center justify-between gap-1">
              <span className="break-all">
                CBU/CVU: <strong>{transferCfg.cbu}</strong>
              </span>
              {!isPrintMode && (
                <button
                  type="button"
                  onClick={() => void handleCopyText(transferCfg.cbu.trim(), 'CBU/CVU')}
                  className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#0072BB]"
                >
                  Copiar
                </button>
              )}
            </div>
          )}
          {transferCfg.holder.trim() && (
            <div className="mt-0.5">Titular: {transferCfg.holder}</div>
          )}
          {transferCfg.paymentLink.trim() && (
            <div className="mt-0.5 flex items-center justify-between gap-1">
              <span className="truncate">Link: {transferCfg.paymentLink.trim()}</span>
              {!isPrintMode && (
                <button
                  type="button"
                  onClick={() =>
                    void handleCopyText(transferCfg.paymentLink.trim(), 'Link de pago')
                  }
                  className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#0072BB]"
                >
                  Copiar
                </button>
              )}
            </div>
          )}
          <div className="mt-0.5 flex justify-between">
            <span>{paymentInfo.pending > 0 ? 'A transferir:' : 'Monto:'}</span>
            <strong>{formatCurrency(transferAmount)}</strong>
          </div>
          {transferQrDataUrl && (
            <div className="mt-2 flex flex-col items-center">
              <img
                src={transferQrDataUrl}
                alt="QR de transferencia"
                className="h-28 w-28 border border-black bg-white object-contain p-1"
              />
              <div className="mt-0.5 text-[9px] uppercase">Escaneá para transferir</div>
            </div>
          )}
          {!hasTransferDetails && !isPrintMode && (
            <div className="mt-1 font-sans text-[10px] text-slate-600">
              Cargá tu Alias o CBU desde &quot;Nueva venta&quot; para mostrarlo aquí.
            </div>
          )}
          {hasTransferDetails && !isPrintMode && (
            <div className="mt-2 flex flex-wrap gap-1.5 font-sans">
              <button
                type="button"
                onClick={() =>
                  void handleCopyText(transferWaText, 'Datos de transferencia')
                }
                className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700"
              >
                <Copy className="h-3 w-3" />
                Copiar todo
              </button>
              <a
                href={transferWaHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white"
              >
                <MessageCircle className="h-3 w-3" />
                WhatsApp
              </a>
            </div>
          )}
        </div>
      )}

      {paymentInfo.isPaid && (
        <div className="my-2 border-2 border-black px-2 py-1.5 text-center">
          <div className="text-sm font-black uppercase tracking-[0.2em]">★ PAGO ★</div>
          <div className="text-[11px] font-extrabold uppercase">{sale.clientName}</div>
          <div className="text-[9.5px] font-bold">
            {paymentInfo.methodLabel ? `${paymentInfo.methodLabel} · ` : ''}
            Total: {formatCurrency(sale.amount)}
          </div>
        </div>
      )}

      <div className="pt-2 text-center text-[9.5px]">
        <div>¡Gracias por su compra!</div>
        <div className="mt-6 border-t border-black pt-1">Firma y aclaración del cliente</div>
        <div className="mt-2 text-[9px] tracking-widest">--------------------------------</div>
      </div>
    </div>
  );

  return (
    <>
      <ModalShell
        open={Boolean(sale)}
        onClose={onClose}
        title={`Boleta de venta · ${sale.invoice}`}
        maxWidth="3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setPrintFormat('a4')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  printFormat === 'a4'
                    ? 'bg-[#0072BB] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Hoja A4
              </button>
              <button
                type="button"
                onClick={() => setPrintFormat('thermal80')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  printFormat === 'thermal80'
                    ? 'bg-[#0072BB] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                <ReceiptText className="h-3.5 w-3.5" />
                Térmico 80mm
              </button>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
            >
              <Printer className="h-4 w-4" />
              Imprimir boleta
            </button>
          </div>

          <div className="max-h-[66vh] overflow-y-auto rounded-2xl bg-slate-100/70 p-2 sm:p-4 dark:bg-slate-950/50">
            {printFormat === 'a4' ? renderA4Boleta(false) : renderThermalBoleta(false)}
          </div>
        </div>
      </ModalShell>

      {typeof document !== 'undefined' &&
        createPortal(
          <div className="print-only hidden bg-white text-slate-900">
            {printFormat === 'thermal80' && (
              <style>{`@media print { @page { size: 80mm auto; margin: 2mm; } }`}</style>
            )}
            {printFormat === 'a4' ? renderA4Boleta(true) : renderThermalBoleta(true)}
          </div>,
          document.body
        )}
    </>
  );
};
