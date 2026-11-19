import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Coins, Copy, FileText, MessageCircle, Printer, ReceiptText } from 'lucide-react';
import type { ClientRecord, SaleRecord, WorkshopProfile } from '../types/workshop';
import {
  convertFromBaseCurrency,
  getCurrencyOption,
  getCurrencyRateFromBase,
  sanitizeCurrencyCode,
  type CurrencyCode,
} from '../utils/currency';
import { formatCurrency, formatDateShort } from '../utils/formatters';
import {
  buildTransferQrPayload,
  buildTransferWhatsAppText,
  hydrateTransferConfig,
  loadTransferConfig,
  type TransferConfig,
} from '../utils/payment';
import { parseSaleDetails, parseSalePaymentInfo } from '../utils/saleMeta';
import { BrandMark } from './BrandMark';
import { ModalShell } from './ModalShell';
import type { PrintFormat } from './RepairPrintDocuments';
import { useToast } from './ToastProvider';
import { parseWorkshopMeta } from '../utils/workshopMeta';

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
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency = workshopMeta.currency;
  const baseCurrencyOption = getCurrencyOption(baseCurrency);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('a4');
  const [transferQrDataUrl, setTransferQrDataUrl] = useState('');

  const paymentInfo = useMemo(
    () => (sale ? parseSalePaymentInfo(sale) : null),
    [sale]
  );

  const currencyChoices = useMemo(() => {
    const list: Array<{ code: CurrencyCode; rate: number; isBase: boolean }> = [
      { code: baseCurrency, rate: 1, isBase: true },
    ];
    for (const sec of workshopMeta.secondaryCurrencies) {
      if (sec.code !== baseCurrency && !list.some((item) => item.code === sec.code)) {
        list.push({ code: sec.code, rate: sec.rate, isBase: false });
      }
    }
    if (
      paymentInfo?.currency &&
      paymentInfo.currency !== baseCurrency &&
      !list.some((item) => item.code === paymentInfo.currency) &&
      paymentInfo.rate &&
      paymentInfo.rate > 0
    ) {
      list.push({
        code: paymentInfo.currency,
        rate: paymentInfo.rate,
        isBase: false,
      });
    }
    return list;
  }, [baseCurrency, workshopMeta.secondaryCurrencies, paymentInfo?.currency, paymentInfo?.rate]);

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(baseCurrency);

  useEffect(() => {
    if (!sale) {
      setSelectedCurrency(baseCurrency);
      return;
    }
    const savedCur = paymentInfo?.currency;
    if (savedCur && currencyChoices.some((c) => c.code === savedCur)) {
      setSelectedCurrency(savedCur);
    } else {
      setSelectedCurrency(baseCurrency);
    }
  }, [sale?.id, paymentInfo?.currency, baseCurrency, currencyChoices]);

  const activeRate = useMemo(() => {
    if (selectedCurrency === baseCurrency) return 1;
    const configuredRate = getCurrencyRateFromBase(
      selectedCurrency,
      baseCurrency,
      workshopMeta.secondaryCurrencies
    );
    if (configuredRate) return configuredRate;
    if (paymentInfo?.currency === selectedCurrency && paymentInfo.rate && paymentInfo.rate > 0) {
      return paymentInfo.rate;
    }
    return 1;
  }, [
    selectedCurrency,
    baseCurrency,
    workshopMeta.secondaryCurrencies,
    paymentInfo?.currency,
    paymentInfo?.rate,
  ]);

  const isConvertedCurrency = selectedCurrency !== baseCurrency && activeRate > 0 && activeRate !== 1;
  const selectedCurrencyOption = getCurrencyOption(selectedCurrency);

  const [transferCfg, setTransferCfg] = useState<TransferConfig>(() =>
    sale ? loadTransferConfig(sale.ownerId) : loadTransferConfig('')
  );

  useEffect(() => {
    if (!sale?.ownerId) {
      setTransferCfg(loadTransferConfig(''));
      return;
    }
    setTransferCfg(loadTransferConfig(sale.ownerId));
    let cancelled = false;
    void hydrateTransferConfig(sale.ownerId).then((cfg) => {
      if (!cancelled) setTransferCfg(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [sale]);

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
    const baseChargeAmount = paymentInfo.pending > 0 ? paymentInfo.pending : sale.amount;
    const chargeAmount = isConvertedCurrency
      ? Math.round(convertFromBaseCurrency(baseChargeAmount, activeRate) * 100) / 100
      : baseChargeAmount;
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
  }, [sale, paymentInfo, transferCfg, profile?.brandName, isConvertedCurrency, activeRate]);

  const saleDetails = useMemo(
    () => (sale ? parseSaleDetails(sale) : null),
    [sale]
  );

  if (!sale || !paymentInfo || !saleDetails) return null;

  const roundDisplay = (val: number) => Math.round(val * 100) / 100;
  const toDisplayMoney = (val: number) =>
    isConvertedCurrency
      ? roundDisplay(convertFromBaseCurrency(val, activeRate))
      : roundDisplay(val);

  const displayAmount = toDisplayMoney(Number(sale.amount || 0));
  const displaySubtotal = toDisplayMoney(saleDetails.subtotal);
  const displayDiscount = toDisplayMoney(saleDetails.discountAmount);
  const displaySurcharge = toDisplayMoney(saleDetails.surchargeAmount);
  const displayDeposit = toDisplayMoney(paymentInfo.deposit);
  const displayPending = Math.max(0, roundDisplay(displayAmount - displayDeposit));
  const statusLabel = paymentInfo.isPaid
    ? 'Cobrado'
    : paymentInfo.deposit > 0
      ? 'Señado'
      : 'Pendiente';

  const isTransfer = paymentInfo.method === 'transferencia';
  const transferAmount = displayPending > 0 ? displayPending : displayAmount;
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
    currencyCode: selectedCurrency,
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
          {workshopMeta.subtitle && (
            <div className="text-[11px] font-semibold text-[#0072BB]">
              {workshopMeta.subtitle}
            </div>
          )}
          <div className="flex flex-col gap-0.5 text-xs text-slate-600">
            <span>{profile?.businessAddress || 'Servicio técnico especializado y accesorios'}</span>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              {profile?.businessPhone && <span>Tel: {profile.businessPhone}</span>}
              {workshopMeta.businessEmail && <span>{workshopMeta.businessEmail}</span>}
              {workshopMeta.taxId && <span>{workshopMeta.taxId}</span>}
            </div>
            {(workshopMeta.hours || workshopMeta.social) && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
                {workshopMeta.hours && <span>Horarios: {workshopMeta.hours}</span>}
                {workshopMeta.social && <span>{workshopMeta.social}</span>}
              </div>
            )}
          </div>
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
          {isConvertedCurrency && (
            <div className="mt-0.5 text-[11px] font-medium text-slate-500">
              Divisa: {selectedCurrencyOption.code} (1 {selectedCurrencyOption.symbol} ={' '}
              {formatCurrency(activeRate, baseCurrency)})
            </div>
          )}
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
          <tbody className="divide-y divide-slate-100">
            {saleDetails.items.map((item) => (
              <tr key={item.id} className="text-slate-900">
                <td className="px-3 py-2.5 font-semibold">
                  <div>{item.name}</div>
                  {item.sku && (
                    <div className="font-mono-num text-[10px] font-normal text-slate-500">
                      SKU: {item.sku}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center font-mono-num">{item.quantity}</td>
                <td className="px-3 py-2.5 text-right font-mono-num">
                  {formatCurrency(toDisplayMoney(item.unitPrice), selectedCurrency)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono-num font-bold">
                  {formatCurrency(toDisplayMoney(item.subtotal), selectedCurrency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(displayDiscount > 0 || displaySurcharge > 0 || saleDetails.note) && (
        <div className="mt-3 space-y-1 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-700">
          {(displayDiscount > 0 || displaySurcharge > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Subtotal:{' '}
                <strong className="font-mono-num">
                  {formatCurrency(displaySubtotal, selectedCurrency)}
                </strong>
              </span>
              {displayDiscount > 0 && (
                <span className="text-emerald-700">
                  Descuento: -
                  <strong className="font-mono-num">
                    {formatCurrency(displayDiscount, selectedCurrency)}
                  </strong>
                </span>
              )}
              {displaySurcharge > 0 && (
                <span className="text-amber-700">
                  Recargo: +
                  <strong className="font-mono-num">
                    {formatCurrency(displaySurcharge, selectedCurrency)}
                  </strong>
                </span>
              )}
            </div>
          )}
          {saleDetails.note && (
            <div className="text-[11px] text-slate-600">
              <strong>Observaciones:</strong> {saleDetails.note}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 border-y border-slate-200 py-3">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-slate-500">Total venta</div>
            <div className="font-mono-num text-sm font-bold text-slate-900">
              {formatCurrency(displayAmount, selectedCurrency)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Anticipo / Seña</div>
            <div className="font-mono-num text-sm font-bold text-emerald-700">
              {formatCurrency(displayDeposit, selectedCurrency)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Saldo pendiente</div>
            <div className="font-mono-num text-sm font-bold text-slate-900">
              {formatCurrency(displayPending, selectedCurrency)}
            </div>
          </div>
        </div>
        {isConvertedCurrency && (
          <div className="mt-2 text-center font-mono-num text-[11px] text-slate-500">
            Equivalente en {baseCurrencyOption.code}: {formatCurrency(sale.amount, baseCurrency)} ·
            Tasa aplicada: 1 {selectedCurrencyOption.symbol} = {formatCurrency(activeRate, baseCurrency)}
          </div>
        )}
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
                  {displayPending > 0 ? 'A transferir: ' : 'Monto: '}
                  {formatCurrency(transferAmount, selectedCurrency)}
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
              {formatCurrency(displayAmount, selectedCurrency)}
            </div>
          </div>
        </div>
      )}

      {workshopMeta.footerNote && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-center text-[10.5px] font-semibold text-sky-900">
          {workshopMeta.footerNote}
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
        {workshopMeta.subtitle && (
          <div className="text-[9.5px] font-bold uppercase">{workshopMeta.subtitle}</div>
        )}
        {profile?.businessAddress && (
          <div className="mt-0.5 text-[10px]">{profile.businessAddress}</div>
        )}
        {profile?.businessPhone && (
          <div className="text-[10px]">Tel: {profile.businessPhone}</div>
        )}
        {workshopMeta.businessEmail && (
          <div className="text-[9.5px]">{workshopMeta.businessEmail}</div>
        )}
        {workshopMeta.taxId && <div className="text-[9.5px]">{workshopMeta.taxId}</div>}
        {workshopMeta.hours && <div className="text-[9px]">Horarios: {workshopMeta.hours}</div>}
        {workshopMeta.social && <div className="text-[9px]">{workshopMeta.social}</div>}
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
        {isConvertedCurrency && (
          <div className="flex justify-between text-[9.5px]">
            <span>Divisa:</span>
            <span>
              {selectedCurrencyOption.code} (1 {selectedCurrencyOption.symbol} ={' '}
              {formatCurrency(activeRate, baseCurrency)})
            </span>
          </div>
        )}
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10.5px]">
        <div className="font-bold uppercase">Cliente</div>
        <div className="font-bold">{sale.clientName}</div>
        {matchedClient?.phone && <div>Tel: {matchedClient.phone}</div>}
        {matchedClient?.dni && <div>DNI: {matchedClient.dni}</div>}
      </div>

      <div className="border-b border-dashed border-black py-2 text-[10.5px]">
        <div className="font-bold uppercase">Detalle ({saleDetails.items.length})</div>
        <div className="mt-1 space-y-1.5">
          {saleDetails.items.map((item) => (
            <div key={item.id}>
              <div className="font-bold">{item.name}</div>
              <div className="flex justify-between text-[10px]">
                <span>
                  {item.quantity} × {formatCurrency(toDisplayMoney(item.unitPrice), selectedCurrency)}
                </span>
                <strong>{formatCurrency(toDisplayMoney(item.subtotal), selectedCurrency)}</strong>
              </div>
            </div>
          ))}
        </div>
        {displayDiscount > 0 && (
          <div className="mt-1 flex justify-between text-[10px]">
            <span>Descuento:</span>
            <span>-{formatCurrency(displayDiscount, selectedCurrency)}</span>
          </div>
        )}
        {displaySurcharge > 0 && (
          <div className="mt-0.5 flex justify-between text-[10px]">
            <span>Recargo:</span>
            <span>+{formatCurrency(displaySurcharge, selectedCurrency)}</span>
          </div>
        )}
        {saleDetails.note && (
          <div className="mt-1 border-t border-dotted border-black pt-1 text-[9.5px]">
            Obs: {saleDetails.note}
          </div>
        )}
      </div>

      <div className="border-b border-dashed border-black py-2 text-[11px]">
        <div className="flex justify-between">
          <span>Total venta:</span>
          <strong>{formatCurrency(displayAmount, selectedCurrency)}</strong>
        </div>
        <div className="flex justify-between">
          <span>Anticipo / Seña:</span>
          <strong>{formatCurrency(displayDeposit, selectedCurrency)}</strong>
        </div>
        <div className="mt-0.5 flex justify-between border-t border-dotted border-black pt-1 text-xs font-black">
          <span>SALDO PENDIENTE:</span>
          <span>{formatCurrency(displayPending, selectedCurrency)}</span>
        </div>
        {isConvertedCurrency && (
          <div className="mt-1 flex justify-between text-[9.5px]">
            <span>Equiv. {baseCurrencyOption.code}:</span>
            <span>{formatCurrency(sale.amount, baseCurrency)}</span>
          </div>
        )}
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
            <span>{displayPending > 0 ? 'A transferir:' : 'Monto:'}</span>
            <strong>{formatCurrency(transferAmount, selectedCurrency)}</strong>
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
            Total: {formatCurrency(displayAmount, selectedCurrency)}
          </div>
        </div>
      )}

      <div className="pt-2 text-center text-[9.5px]">
        {workshopMeta.footerNote && (
          <div className="mb-1.5 border-b border-dashed border-black pb-1.5 font-bold">
            {workshopMeta.footerNote}
          </div>
        )}
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
            <div className="flex flex-wrap items-center gap-2.5">
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

              <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900">
                <Coins className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <select
                  aria-label="Divisa de la boleta"
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(sanitizeCurrencyCode(e.target.value))}
                  className="bg-transparent text-xs font-semibold text-slate-800 outline-none dark:text-slate-100"
                >
                  {currencyChoices.map((choice) => {
                    const opt = getCurrencyOption(choice.code);
                    return (
                      <option
                        key={choice.code}
                        value={choice.code}
                        className="bg-white text-slate-900 dark:bg-slate-900 dark:text-white"
                      >
                        {choice.isBase
                          ? `${opt.code} (${opt.symbol}) · Base`
                          : `${opt.code} (${opt.symbol}) · 1 ${opt.symbol} = ${formatCurrency(choice.rate, baseCurrency)}`}
                      </option>
                    );
                  })}
                </select>
              </div>
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
