import React, { useMemo } from 'react';
import { CheckCircle2, Plus, Printer, Trash2 } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { deleteRow, updateRow } from '../lib/db';
import type { ProductRecord, SaleRecord, WorkshopProfile } from '../types/workshop';
import { convertFromBaseCurrency } from '../utils/currency';
import { formatCompactCurrency, formatCurrency, formatDateShort } from '../utils/formatters';
import { parseSalePaymentInfo, serializeSaleStatus } from '../utils/saleMeta';
import { sanitizeDbErrorMessage } from '../utils/validation';
import { parseWorkshopMeta } from '../utils/workshopMeta';

interface SalesPageProps {
  sales: SaleRecord[];
  products?: ProductRecord[];
  profile?: WorkshopProfile | null;
  onNewSale: () => void;
  onPrintSale?: (sale: SaleRecord) => void;
}

export const SalesPage: React.FC<SalesPageProps> = ({
  sales,
  products = [],
  profile,
  onNewSale,
  onPrintSale,
}) => {
  const { notify } = useToast();
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);
  const total = sales.reduce((s, x) => s + Number(x.amount || 0), 0);
  const collected = sales.reduce((s, x) => s + parseSalePaymentInfo(x).deposit, 0);
  const pending = Math.max(0, total - collected);

  const toggleStatus = async (s: SaleRecord) => {
    const info = parseSalePaymentInfo(s);
    const next = serializeSaleStatus({
      status: info.isPaid ? 'pendiente' : 'cobrado',
      method: info.method || 'efectivo',
      deposit: info.isPaid ? 0 : Number(s.amount || 0),
      amount: Number(s.amount || 0),
      currency: info.currency,
      rate: info.rate,
    });
    try {
      await updateRow('sales', s.id, { status: next });
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo actualizar la venta.'), 'error');
    }
  };

  const settleBalance = async (s: SaleRecord) => {
    const info = parseSalePaymentInfo(s);
    const next = serializeSaleStatus({
      status: 'cobrado',
      method: info.method || 'efectivo',
      deposit: Number(s.amount || 0),
      amount: Number(s.amount || 0),
      currency: info.currency,
      rate: info.rate,
    });
    try {
      await updateRow('sales', s.id, { status: next });
      notify('Saldo cobrado en su totalidad.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo cobrar el saldo.'), 'error');
    }
  };

  const deleteSale = async (s: SaleRecord) => {
    try {
      await deleteRow('sales', s.id);
      if (s.productId && s.quantity && s.quantity > 0) {
        const matched = products.find((p) => p.id === s.productId);
        if (matched && matched.trackStock) {
          await updateRow('products', matched.id, {
            stock: Math.max(0, Number(matched.stock || 0) + Number(s.quantity || 0)),
          });
        }
      }
      notify('Venta eliminada.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar la venta.'), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Ventas y cobranzas
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mostrador, accesorios y seguimiento de cobros
          </p>
        </div>
        <button
          type="button"
          onClick={onNewSale}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
        >
          <Plus className="h-4 w-4" />
          Nueva venta
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
            {formatCompactCurrency(total)}
          </div>
          <div className="text-xs text-slate-500">Total ventas</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-amber-600 sm:text-2xl dark:text-amber-400">
            {formatCompactCurrency(pending)}
          </div>
          <div className="text-xs text-slate-500">Pendiente</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-emerald-600 sm:text-2xl dark:text-emerald-400">
            {formatCompactCurrency(collected)}
          </div>
          <div className="text-xs text-slate-500">Cobrado</div>
        </div>
      </div>

      <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {sales.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No hay ventas registradas.</div>
        ) : (
          [...sales]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((s) => {
              const info = parseSalePaymentInfo(s);
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

              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                        {s.invoice}
                      </span>
                      <span>·</span>
                      <span>{formatDateShort(s.dueDate)}</span>
                      {info.methodLabel && (
                        <>
                          <span>·</span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {info.methodLabel}
                          </span>
                        </>
                      )}
                      {hasForeignCurrency && info.currency && (
                        <span className="rounded-md bg-sky-50 px-1.5 py-0.5 font-mono-num text-[11px] font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                          {formatCurrency(foreignAmount, info.currency)}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {s.clientName}
                    </div>
                    {s.productName && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {s.productName} {s.quantity ? `× ${s.quantity}` : ''}
                      </div>
                    )}
                    {!info.isPaid && info.deposit > 0 && (
                      <div className="mt-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                        Seña:{' '}
                        <span className="font-mono-num font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(info.deposit)}
                        </span>{' '}
                        · Pendiente:{' '}
                        <span className="font-mono-num font-semibold text-amber-600 dark:text-amber-400">
                          {formatCurrency(info.pending)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(s.amount)}
                    </span>
                    {!info.isPaid && info.deposit > 0 && (
                      <button
                        type="button"
                        onClick={() => void settleBalance(s)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Cobrar saldo
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleStatus(s)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        info.isPaid
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {badgeLabel}
                    </button>
                    {onPrintSale && (
                      <button
                        type="button"
                        onClick={() => onPrintSale(s)}
                        title="Imprimir boleta A4 o 80mm"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span>Boleta</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteSale(s)}
                      aria-label="Eliminar venta"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
};
