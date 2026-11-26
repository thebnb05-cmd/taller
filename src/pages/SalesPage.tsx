import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Download,
  Edit3,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { deleteRow, updateRow } from '../lib/db';
import type { ProductRecord, SaleRecord, WorkshopProfile } from '../types/workshop';
import { downloadCsvFile } from '../utils/csvExport';
import { convertFromBaseCurrency } from '../utils/currency';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDateShort,
  todayISO,
} from '../utils/formatters';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../utils/payment';
import {
  dismissRecoveredPayment,
  getUnreconciledPayments,
  retrySaveRecoveredSale,
  useRecoveredPayments,
  type RecoveredPaymentEntry,
} from '../utils/paymentLedger';
import { loadMercadoPagoConfig } from '../utils/mercadoPago';
import { syncSaleToPurchases } from '../utils/mpPurchasesSync';
import { parseSaleDetails, parseSalePaymentInfo, serializeSaleStatus } from '../utils/saleMeta';
import { parseSafePositiveNumber, sanitizeDbErrorMessage, sanitizePlainLine } from '../utils/validation';
import { parseWorkshopMeta } from '../utils/workshopMeta';
import { useI18n } from '../utils/i18n';

interface SalesPageProps {
  ownerId?: string;
  sales: SaleRecord[];
  products?: ProductRecord[];
  profile?: WorkshopProfile | null;
  onNewSale: () => void;
  onEditSale?: (sale: SaleRecord) => void;
  onPrintSale?: (sale: SaleRecord) => void;
}

type StatusFilter = 'all' | 'cobrado' | 'sena' | 'pendiente';
type MethodFilter = 'all' | PaymentMethod;
type DatePreset = 'all' | 'today' | '7d' | 'month';

export const SalesPage: React.FC<SalesPageProps> = ({
  ownerId = '',
  sales,
  products = [],
  profile,
  onNewSale,
  onEditSale,
  onPrintSale,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);

  const recoveredEntries = useRecoveredPayments(ownerId);
  const unreconciledSales = useMemo(
    () =>
      getUnreconciledPayments(recoveredEntries, sales, []).filter(
        (entry) => entry.source !== 'reparacion'
      ),
    [recoveredEntries, sales]
  );

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');

  const [payingSaleId, setPayingSaleId] = useState<string | null>(null);
  const [partialAmount, setPartialAmount] = useState('');
  const [partialMethod, setPartialMethod] = useState<PaymentMethod>('efectivo');
  const [partialNote, setPartialNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [retryingRecoveredId, setRetryingRecoveredId] = useState<string | null>(null);

  const recoveredTotal = unreconciledSales.reduce((s, x) => s + Number(x.amount || 0), 0);
  const total = sales.reduce((s, x) => s + Number(x.amount || 0), 0) + recoveredTotal;
  const collected =
    sales.reduce((s, x) => s + parseSalePaymentInfo(x).deposit, 0) + recoveredTotal;
  const pending = Math.max(0, total - collected);

  const handleRetryRecovered = async (entry: RecoveredPaymentEntry) => {
    setRetryingRecoveredId(entry.id);
    try {
      const res = await retrySaveRecoveredSale(entry, products);
      if (res.ok) {
        notify('Venta guardada definitivamente en la nube.');
      } else {
        notify(res.error || 'No se pudo guardar en la nube todavía.', 'error');
      }
    } finally {
      setRetryingRecoveredId(null);
    }
  };

  const filteredSales = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const todayStr = todayISO();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    return [...sales]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((s) => {
        const info = parseSalePaymentInfo(s);
        const details = parseSaleDetails(s);

        if (statusFilter === 'cobrado' && !info.isPaid) return false;
        if (statusFilter === 'sena' && (info.isPaid || info.deposit <= 0)) return false;
        if (statusFilter === 'pendiente' && (info.isPaid || info.deposit > 0)) return false;

        if (methodFilter !== 'all' && info.method !== methodFilter) return false;

        if (datePreset !== 'all') {
          const refDate = s.dueDate
            ? new Date(s.dueDate.includes('T') ? s.dueDate : `${s.dueDate}T12:00:00`)
            : new Date(s.createdAt || 0);
          const refMs = refDate.getTime();
          if (datePreset === 'today') {
            const iso = (s.dueDate || new Date(s.createdAt).toISOString()).slice(0, 10);
            if (iso !== todayStr) return false;
          } else if (datePreset === '7d') {
            if (refMs < sevenDaysAgo) return false;
          } else if (datePreset === 'month') {
            if (refDate.getFullYear() !== currentYear || refDate.getMonth() !== currentMonth) {
              return false;
            }
          }
        }

        if (q) {
          const hay = [
            s.invoice,
            s.clientName,
            s.productName || '',
            details.note,
            ...details.items.map((i) => i.name),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }

        return true;
      });
  }, [sales, query, statusFilter, methodFilter, datePreset]);

  const serializePreservingMeta = (
    s: SaleRecord,
    overrides: {
      status: 'cobrado' | 'pendiente';
      method: PaymentMethod;
      deposit: number;
      clearPayments?: boolean;
      appendPayment?: { amount: number; method: PaymentMethod; note?: string };
    }
  ) => {
    const info = parseSalePaymentInfo(s);
    const details = parseSaleDetails(s);
    const payments = overrides.clearPayments ? [] : [...details.payments];
    if (!overrides.clearPayments && overrides.appendPayment && overrides.appendPayment.amount > 0) {
      payments.push({
        id: `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        amount: Math.round(overrides.appendPayment.amount * 100) / 100,
        method: overrides.appendPayment.method,
        date: new Date().toISOString(),
        ...(overrides.appendPayment.note ? { note: overrides.appendPayment.note } : {}),
      });
    }
    return serializeSaleStatus({
      status: overrides.status,
      method: overrides.method,
      deposit: overrides.deposit,
      amount: Number(s.amount || 0),
      currency: info.currency,
      rate: info.rate,
      meta: details.hasStructuredMeta
        ? {
            items: details.items,
            subtotal: details.subtotal,
            discountType: details.discountType,
            discountValue: details.discountValue,
            discountAmount: details.discountAmount,
            surchargeType: details.surchargeType,
            surchargeValue: details.surchargeValue,
            surchargeAmount: details.surchargeAmount,
            ...(details.transferQrIvaAmount > 0
              ? {
                  transferQrIvaPct: details.transferQrIvaPct,
                  transferQrIvaAmount: details.transferQrIvaAmount,
                }
              : {}),
            payments,
            note: details.note,
            ...(details.mpChannel ? { mpChannel: details.mpChannel } : {}),
            ...(details.mpOrderId ? { mpOrderId: details.mpOrderId } : {}),
            ...(details.mpExternalReference ? { mpExternalReference: details.mpExternalReference } : {}),
            ...(details.mpPaymentId ? { mpPaymentId: details.mpPaymentId } : {}),
            ...(details.mpPointName ? { mpPointName: details.mpPointName } : {}),
          }
        : payments.length > 0 || details.mpChannel || details.mpOrderId
          ? {
              items: details.items,
              subtotal: details.subtotal,
              payments,
              ...(details.mpChannel ? { mpChannel: details.mpChannel } : {}),
              ...(details.mpOrderId ? { mpOrderId: details.mpOrderId } : {}),
              ...(details.mpExternalReference ? { mpExternalReference: details.mpExternalReference } : {}),
              ...(details.mpPaymentId ? { mpPaymentId: details.mpPaymentId } : {}),
              ...(details.mpPointName ? { mpPointName: details.mpPointName } : {}),
            }
          : undefined,
    });
  };

  const openPartialPay = (s: SaleRecord) => {
    const info = parseSalePaymentInfo(s);
    setPayingSaleId(s.id);
    setPartialAmount(String(Math.round(info.pending * 100) / 100));
    setPartialMethod(info.method || 'efectivo');
    setPartialNote('');
  };

  const handleConfirmPartialPay = async (s: SaleRecord) => {
    const info = parseSalePaymentInfo(s);
    const addAmt = parseSafePositiveNumber(partialAmount, 0);
    if (addAmt <= 0) {
      notify('Ingresá un monto mayor a 0 para registrar el abono.', 'error');
      return;
    }
    const totalSale = Math.max(0, Number(s.amount || 0));
    const cappedAdd = Math.min(info.pending > 0 ? info.pending : totalSale, addAmt);
    const nextDeposit = Math.min(totalSale, Math.round((info.deposit + cappedAdd) * 100) / 100);
    const nextPaid = totalSale > 0 && nextDeposit >= totalSale;

    const nextStatus = serializePreservingMeta(s, {
      status: nextPaid ? 'cobrado' : 'pendiente',
      method: partialMethod,
      deposit: nextDeposit,
      appendPayment: {
        amount: cappedAdd,
        method: partialMethod,
        note: sanitizePlainLine(partialNote, 100) || (nextPaid ? 'Cancelación de saldo' : 'Abono parcial'),
      },
    });

    setBusyId(s.id);
    try {
      await updateRow('sales', s.id, { status: nextStatus });
      if (ownerId && (partialMethod === 'transferencia' || partialMethod === 'tarjeta')) {
        void syncSaleToPurchases(ownerId, { ...s, status: nextStatus }, loadMercadoPagoConfig(ownerId));
      }
      setPayingSaleId(null);
      notify(nextPaid ? 'Saldo cancelado en su totalidad.' : 'Abono parcial registrado.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo registrar el abono.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const settleBalance = async (s: SaleRecord) => {
    const info = parseSalePaymentInfo(s);
    const totalSale = Math.max(0, Number(s.amount || 0));
    const diff = Math.max(0, totalSale - info.deposit);
    const resolvedMethod = info.method || 'efectivo';
    const next = serializePreservingMeta(s, {
      status: 'cobrado',
      method: resolvedMethod,
      deposit: totalSale,
      appendPayment:
        diff > 0
          ? {
              amount: diff,
              method: resolvedMethod,
              note: 'Cobro de saldo',
            }
          : undefined,
    });
    setBusyId(s.id);
    try {
      await updateRow('sales', s.id, { status: next });
      if (ownerId && (resolvedMethod === 'transferencia' || resolvedMethod === 'tarjeta')) {
        void syncSaleToPurchases(ownerId, { ...s, status: next }, loadMercadoPagoConfig(ownerId));
      }
      notify('Saldo cobrado en su totalidad.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo cobrar el saldo.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleStatus = async (s: SaleRecord) => {
    const info = parseSalePaymentInfo(s);
    const totalSale = Math.max(0, Number(s.amount || 0));
    const diff = !info.isPaid ? Math.max(0, totalSale - info.deposit) : 0;
    const resolvedMethod = info.method || 'efectivo';
    const next = serializePreservingMeta(s, {
      status: info.isPaid ? 'pendiente' : 'cobrado',
      method: resolvedMethod,
      deposit: info.isPaid ? 0 : totalSale,
      clearPayments: info.isPaid,
      appendPayment:
        !info.isPaid && diff > 0
          ? {
              amount: diff,
              method: resolvedMethod,
              note: 'Cobro total',
            }
          : undefined,
    });
    setBusyId(s.id);
    try {
      await updateRow('sales', s.id, { status: next });
      if (!info.isPaid && ownerId && (resolvedMethod === 'transferencia' || resolvedMethod === 'tarjeta')) {
        void syncSaleToPurchases(ownerId, { ...s, status: next }, loadMercadoPagoConfig(ownerId));
      }
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo actualizar la venta.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteSale = async (s: SaleRecord) => {
    setBusyId(s.id);
    try {
      const details = parseSaleDetails(s);
      await deleteRow('sales', s.id);

      // Restore stock for ALL inventory items in this sale
      const qtyByProduct = new Map<string, number>();
      if (details.hasStructuredMeta) {
        for (const item of details.items) {
          if (item.productId && item.quantity > 0) {
            qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) || 0) + item.quantity);
          }
        }
      } else if (s.productId && s.quantity && s.quantity > 0) {
        qtyByProduct.set(s.productId, Number(s.quantity));
      }

      for (const [productId, restoreQty] of qtyByProduct.entries()) {
        const matched = products.find((p) => p.id === productId);
        if (matched && matched.trackStock) {
          await updateRow('products', matched.id, {
            stock: Math.max(0, Number(matched.stock || 0) + restoreQty),
          });
        }
      }
      setConfirmDeleteId(null);
      notify('Venta eliminada y stock restaurado.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar la venta.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleExportCsv = () => {
    if (filteredSales.length === 0) {
      notify('No hay ventas para exportar con el filtro actual.', 'error');
      return;
    }
    const headers = [
      'Comprobante',
      'Fecha',
      'Cliente',
      'Detalle de ítems',
      'Cantidad total',
      'Estado',
      'Medio de pago',
      `Moneda base (${baseCurrency}) - Subtotal`,
      `Moneda base (${baseCurrency}) - Descuento`,
      `Moneda base (${baseCurrency}) - Recargo`,
      `Moneda base (${baseCurrency}) - Total`,
      `Moneda base (${baseCurrency}) - Cobrado / Seña`,
      `Moneda base (${baseCurrency}) - Saldo pendiente`,
      'Nota',
    ];
    const rows = filteredSales.map((s) => {
      const info = parseSalePaymentInfo(s);
      const details = parseSaleDetails(s);
      const badgeLabel = info.isPaid
        ? 'Cobrado'
        : info.deposit > 0
          ? 'Señado'
          : 'Pendiente';
      const itemsText = details.items
        .map((it) => `${it.name} x${it.quantity}`)
        .join(' | ');
      const totalQty = details.items.reduce((sum, it) => sum + it.quantity, 0);
      return [
        s.invoice,
        s.dueDate || new Date(s.createdAt || Date.now()).toISOString().slice(0, 10),
        s.clientName,
        itemsText || s.productName || '',
        totalQty || Number(s.quantity || 1),
        badgeLabel,
        info.methodLabel || '',
        details.subtotal,
        details.discountAmount,
        details.surchargeAmount,
        Number(s.amount || 0),
        info.deposit,
        info.pending,
        details.note,
      ];
    });
    downloadCsvFile(`ventas-${todayISO()}.csv`, headers, rows);
    notify(`Exportadas ${filteredSales.length} ventas a CSV.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            {tr('Ventas y cobranzas', 'Sales & collections', 'Vendas e cobranças')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'Mostrador multicarrito, cobros parciales y control de saldos',
              'POS multi-cart, partial payments and balance tracking',
              'Balcão multicarrinho, recebimentos parciais e controle de saldos'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredSales.length === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
          >
            <Download className="h-4 w-4" />
            {tr('Exportar CSV', 'Export CSV', 'Exportar CSV')}
          </button>
          <button
            type="button"
            onClick={onNewSale}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            {tr('Nueva venta', 'New sale', 'Nova venda')}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
            {formatCompactCurrency(total, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500">
            {tr('Total ventas', 'Total sales', 'Total de vendas')}
            {recoveredTotal > 0 && (
              <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
                (+{formatCompactCurrency(recoveredTotal, baseCurrency)} recup.)
              </span>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-amber-600 sm:text-2xl dark:text-amber-400">
            {formatCompactCurrency(pending, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500">{tr('Pendiente', 'Pending', 'Pendente')}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-emerald-600 sm:text-2xl dark:text-emerald-400">
            {formatCompactCurrency(collected, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500">{tr('Cobrado', 'Collected', 'Recebido')}</div>
        </div>
      </div>

      {/* Recovered & MP Point/QR Pending Sales Panel */}
      {unreconciledSales.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/75 p-4 dark:border-amber-900/60 dark:bg-amber-950/25">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {unreconciledSales.length}{' '}
                {unreconciledSales.length === 1
                  ? 'cobro pagado pendiente de guardar en Ventas'
                  : 'cobros pagados pendientes de guardar en Ventas'}
              </span>
            </div>
            <span className="font-mono-num text-xs font-extrabold text-amber-800 dark:text-amber-300">
              {formatCurrency(recoveredTotal, baseCurrency)}
            </span>
          </div>
          <div className="mt-2.5 space-y-2">
            {unreconciledSales.slice(0, 6).map((rec) => (
              <div
                key={rec.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-white/95 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-slate-900/90"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {rec.clientName} · {rec.title}
                    </span>
                    {rec.mpChannel === 'mp_point' && (
                      <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                        <Smartphone className="h-2.5 w-2.5" /> Point MP
                      </span>
                    )}
                    {rec.mpChannel === 'mp_qr' && (
                      <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                        <QrCode className="h-2.5 w-2.5" /> QR MP
                      </span>
                    )}
                    {rec.saveFailed && (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                        Error al guardar
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {formatDateShort(rec.at.slice(0, 10))} · {PAYMENT_METHOD_LABELS[rec.method]}
                    {rec.saveError ? ` · ${rec.saveError}` : rec.subtitle ? ` · ${rec.subtitle}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(rec.amount, baseCurrency)}
                  </span>
                  {rec.draftSalePayload && (
                    <button
                      type="button"
                      disabled={retryingRecoveredId === rec.id}
                      onClick={() => void handleRetryRecovered(rec)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#0072BB] px-2.5 text-[11px] font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {retryingRecoveredId === rec.id ? 'Guardando...' : 'Guardar en Ventas'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissRecoveredPayment(ownerId, rec.id)}
                    aria-label="Descartar cobro recuperado"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr(
                'Buscar cliente, comprobante o producto...',
                'Search client, receipt or product...',
                'Buscar cliente, comprovante ou produto...'
              )}
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-8 text-xs text-slate-900 outline-none focus:border-[#0072BB] focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as MethodFilter)}
            aria-label={tr('Filtrar por medio de pago', 'Filter by payment method', 'Filtrar por forma de pagamento')}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">{tr('Todos los medios', 'All methods', 'Todos os meios')}</option>
            <option value="efectivo">{tr('Efectivo', 'Cash', 'Dinheiro')}</option>
            <option value="transferencia">{tr('Transferencia', 'Transfer', 'Transferência')}</option>
            <option value="tarjeta">{tr('Tarjeta', 'Card', 'Cartão')}</option>
          </select>

          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            aria-label={tr('Filtrar por período', 'Filter by period', 'Filtrar por período')}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">{tr('Todas las fechas', 'All dates', 'Todas as datas')}</option>
            <option value="today">{tr('Hoy', 'Today', 'Hoje')}</option>
            <option value="7d">{tr('Últimos 7 días', 'Last 7 days', 'Últimos 7 dias')}</option>
            <option value="month">{tr('Este mes', 'This month', 'Este mês')}</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: tr('Todas', 'All', 'Todas') },
              { id: 'cobrado', label: tr('Cobradas', 'Paid', 'Pagas') },
              { id: 'sena', label: tr('Señadas', 'Deposit', 'Com sinal') },
              { id: 'pendiente', label: 'Pendientes' },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`h-8 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#0072BB] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sales Ledger List */}
      <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {filteredSales.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {sales.length === 0
              ? 'No hay ventas registradas.'
              : 'No hay ventas que coincidan con el filtro seleccionado.'}
          </div>
        ) : (
          filteredSales.map((s) => {
            const info = parseSalePaymentInfo(s);
            const details = parseSaleDetails(s);
            const badgeLabel = info.isPaid
              ? 'Cobrado'
              : info.deposit > 0
                ? 'Señado'
                : 'Pendiente';
            const hasForeignCurrency = Boolean(
              info.currency &&
                info.currency !== baseCurrency &&
                info.rate &&
                info.rate > 0
            );
            const foreignAmount =
              hasForeignCurrency && info.rate
                ? convertFromBaseCurrency(Number(s.amount || 0), info.rate)
                : 0;
            const isPaying = payingSaleId === s.id;
            const isConfirmingDelete = confirmDeleteId === s.id;
            const isBusy = busyId === s.id;

            return (
              <div key={s.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                        {s.invoice}
                      </span>
                      <span>·</span>
                      <span>{formatDateShort(s.dueDate)}</span>
                      {info.methodLabel && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {info.methodLabel}
                          </span>
                        </>
                      )}
                      {details.mpChannel === 'mp_point' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                          <Smartphone className="h-2.5 w-2.5" /> Point MP
                        </span>
                      )}
                      {details.mpChannel === 'mp_qr' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                          <QrCode className="h-2.5 w-2.5" /> QR MP
                        </span>
                      )}
                      {hasForeignCurrency && info.currency && (
                        <>
                          <span>·</span>
                          <span className="font-mono-num font-semibold text-[#0072BB] dark:text-sky-300">
                            {formatCurrency(foreignAmount, info.currency)}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                      {s.clientName}
                    </div>

                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {details.hasStructuredMeta
                        ? details.items
                            .map((it) => `${it.name} × ${it.quantity}`)
                            .join(' · ')
                        : `${s.productName || 'Venta de mostrador'}${s.quantity ? ` × ${s.quantity}` : ''}`}
                    </div>

                    {(details.discountAmount > 0 || details.surchargeAmount > 0 || details.note) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {details.discountAmount > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            Desc: -{formatCurrency(details.discountAmount, baseCurrency)}
                          </span>
                        )}
                        {details.surchargeAmount > 0 && (
                          <span className="text-amber-600 dark:text-amber-400">
                            Recargo: +{formatCurrency(details.surchargeAmount, baseCurrency)}
                          </span>
                        )}
                        {details.note && <span className="italic">{details.note}</span>}
                      </div>
                    )}

                    {!info.isPaid && info.deposit > 0 && (
                      <div className="mt-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                        Abonado:{' '}
                        <span className="font-mono-num font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(info.deposit, baseCurrency)}
                        </span>{' '}
                        · Saldo:{' '}
                        <span className="font-mono-num font-semibold text-amber-600 dark:text-amber-400">
                          {formatCurrency(info.pending, baseCurrency)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(s.amount, baseCurrency)}
                    </span>

                    {!info.isPaid && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => (isPaying ? setPayingSaleId(null) : openPartialPay(s))}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 whitespace-nowrap shrink-0 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        <Coins className="h-3 w-3" />
                        Abonar
                      </button>
                    )}

                    {!info.isPaid && info.deposit > 0 && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void settleBalance(s)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Saldar
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void toggleStatus(s)}
                      className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                        info.isPaid
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {badgeLabel}
                    </button>

                    {onEditSale && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEditSale(s)}
                        title="Editar venta"
                        aria-label="Editar venta"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#0072BB] hover:text-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {onPrintSale && (
                      <button
                        type="button"
                        onClick={() => onPrintSale(s)}
                        title="Imprimir boleta A4 o 80mm"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span>Boleta</span>
                      </button>
                    )}

                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void deleteSale(s)}
                          className="h-8 rounded-lg bg-red-600 px-2.5 text-[11px] font-semibold text-white hover:bg-red-700 whitespace-nowrap"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-8 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(s.id)}
                        aria-label="Eliminar venta"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Partial Payment Form */}
                {isPaying && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                    <div className="w-32">
                      <label className="mb-1 block text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                        Monto a abonar
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={partialAmount}
                        onChange={(e) => setPartialAmount(e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono-num text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div className="w-36">
                      <label className="mb-1 block text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                        Medio de pago
                      </label>
                      <select
                        value={partialMethod}
                        onChange={(e) => setPartialMethod(e.target.value as PaymentMethod)}
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-[160px] flex-1">
                      <label className="mb-1 block text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                        Nota (opcional)
                      </label>
                      <input
                        type="text"
                        value={partialNote}
                        onChange={(e) => setPartialNote(e.target.value)}
                        placeholder="Cuota / entrega parcial"
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleConfirmPartialPay(s)}
                        className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Registrar abono
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayingSaleId(null)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
