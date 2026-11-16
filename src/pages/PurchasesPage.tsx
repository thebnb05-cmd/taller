import React, { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { deleteRow, updateRow } from '../lib/db';
import type { PurchaseRecord, WorkshopProfile } from '../types/workshop';
import { convertFromBaseCurrency } from '../utils/currency';
import { formatCompactCurrency, formatCurrency, formatDateShort } from '../utils/formatters';
import { parsePurchaseInfo, serializePurchaseStatus } from '../utils/purchaseMeta';
import { sanitizeDbErrorMessage } from '../utils/validation';
import { parseWorkshopMeta } from '../utils/workshopMeta';

interface PurchasesPageProps {
  purchases: PurchaseRecord[];
  profile?: WorkshopProfile | null;
  onNewPurchase: () => void;
}

export const PurchasesPage: React.FC<PurchasesPageProps> = ({
  purchases,
  profile,
  onNewPurchase,
}) => {
  const { notify } = useToast();
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);
  const total = purchases.reduce((s, x) => s + Number(x.amount || 0), 0);
  const paid = purchases
    .filter((x) => parsePurchaseInfo(x).isPaid)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const pending = Math.max(0, total - paid);

  const toggleStatus = async (p: PurchaseRecord) => {
    const info = parsePurchaseInfo(p);
    const next = serializePurchaseStatus({
      status: info.isPaid ? 'pendiente' : 'pagado',
      currency: info.currency,
      rate: info.rate,
    });
    try {
      await updateRow('purchases', p.id, { status: next });
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo actualizar la compra.'), 'error');
    }
  };

  const deletePurchase = async (p: PurchaseRecord) => {
    try {
      await deleteRow('purchases', p.id);
      notify('Compra eliminada.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar la compra.'), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Compras y pagos
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Reposición de repuestos y facturas de proveedores
          </p>
        </div>
        <button
          type="button"
          onClick={onNewPurchase}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
        >
          <Plus className="h-4 w-4" />
          Nueva compra
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
            {formatCompactCurrency(total)}
          </div>
          <div className="text-xs text-slate-500">Total compras</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-amber-600 sm:text-2xl dark:text-amber-400">
            {formatCompactCurrency(pending)}
          </div>
          <div className="text-xs text-slate-500">Pendiente</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-emerald-600 sm:text-2xl dark:text-emerald-400">
            {formatCompactCurrency(paid)}
          </div>
          <div className="text-xs text-slate-500">Pagado</div>
        </div>
      </div>

      <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {purchases.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No hay compras registradas.</div>
        ) : (
          [...purchases]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((p) => {
              const info = parsePurchaseInfo(p);
              const hasForeignCurrency = Boolean(
                info.currency &&
                  info.currency !== baseCurrency &&
                  info.rate &&
                  info.rate > 0
              );
              const foreignAmount =
                hasForeignCurrency && info.rate
                  ? convertFromBaseCurrency(Number(p.amount || 0), info.rate)
                  : 0;

              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                        {p.invoice}
                      </span>
                      <span>·</span>
                      <span>{formatDateShort(p.dueDate)}</span>
                      {hasForeignCurrency && info.currency && (
                        <span className="rounded-md bg-sky-50 px-1.5 py-0.5 font-mono-num text-[11px] font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                          {formatCurrency(foreignAmount, info.currency)}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {p.supplierName}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(p.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleStatus(p)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        info.isPaid
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {info.isPaid ? 'Pagado' : 'Pendiente'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePurchase(p)}
                      aria-label="Eliminar compra"
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
