import React, { useMemo, useState } from 'react';
import { Download, Plus, Search, Trash2, X } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { deleteRow, updateRow } from '../lib/db';
import type { PurchaseRecord, WorkshopProfile } from '../types/workshop';
import { downloadCsvFile } from '../utils/csvExport';
import { convertFromBaseCurrency } from '../utils/currency';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDateShort,
  todayISO,
} from '../utils/formatters';
import {
  parsePurchaseInfo,
  PURCHASE_CATEGORY_LABELS,
  serializePurchaseStatus,
  type PurchaseCategory,
} from '../utils/purchaseMeta';
import { sanitizeDbErrorMessage } from '../utils/validation';
import { parseWorkshopMeta } from '../utils/workshopMeta';

interface PurchasesPageProps {
  purchases: PurchaseRecord[];
  profile?: WorkshopProfile | null;
  onNewPurchase: () => void;
}

type StatusFilter = 'all' | 'pendiente' | 'pagado';
type CategoryFilter = 'all' | PurchaseCategory;

export const PurchasesPage: React.FC<PurchasesPageProps> = ({
  purchases,
  profile,
  onNewPurchase,
}) => {
  const { notify } = useToast();
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const total = purchases.reduce((s, x) => s + Number(x.amount || 0), 0);
  const paid = purchases
    .filter((x) => parsePurchaseInfo(x).isPaid)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const pending = Math.max(0, total - paid);

  const filteredPurchases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...purchases]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((p) => {
        const info = parsePurchaseInfo(p);
        if (statusFilter === 'pagado' && !info.isPaid) return false;
        if (statusFilter === 'pendiente' && info.isPaid) return false;
        if (categoryFilter !== 'all' && info.category !== categoryFilter) return false;
        if (q) {
          const hay = [
            p.invoice,
            p.supplierName,
            PURCHASE_CATEGORY_LABELS[info.category],
            info.note,
            ...info.stockItems.map((s) => s.name),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [purchases, query, statusFilter, categoryFilter]);

  const toggleStatus = async (p: PurchaseRecord) => {
    const info = parsePurchaseInfo(p);
    const next = serializePurchaseStatus({
      status: info.isPaid ? 'pendiente' : 'pagado',
      currency: info.currency,
      rate: info.rate,
      category: info.category,
      note: info.note,
      stockItems: info.stockItems,
    });
    setBusyId(p.id);
    try {
      await updateRow('purchases', p.id, { status: next });
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo actualizar la compra.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deletePurchase = async (p: PurchaseRecord) => {
    setBusyId(p.id);
    try {
      await deleteRow('purchases', p.id);
      setConfirmDeleteId(null);
      notify('Compra / gasto eliminado.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar la compra.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleExportCsv = () => {
    if (filteredPurchases.length === 0) {
      notify('No hay compras o gastos para exportar con el filtro actual.', 'error');
      return;
    }
    const headers = [
      'Comprobante',
      'Vencimiento / Fecha',
      'Proveedor',
      'Categoría',
      'Estado',
      `Importe (${baseCurrency})`,
      'Detalle / Stock ingresado',
      'Nota',
    ];
    const rows = filteredPurchases.map((p) => {
      const info = parsePurchaseInfo(p);
      return [
        p.invoice,
        p.dueDate || new Date(p.createdAt || Date.now()).toISOString().slice(0, 10),
        p.supplierName,
        PURCHASE_CATEGORY_LABELS[info.category],
        info.isPaid ? 'Pagado' : 'Pendiente',
        Number(p.amount || 0),
        info.stockItems.map((s) => `${s.name} x${s.qty}`).join(' | '),
        info.note,
      ];
    });
    downloadCsvFile(`compras-gastos-${todayISO()}.csv`, headers, rows);
    notify(`Exportados ${filteredPurchases.length} registros a CSV.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Compras y gastos
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Reposición de repuestos, servicios fijos y pagos a proveedores
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredPurchases.length === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={onNewPurchase}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nueva compra
          </button>
        </div>
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar proveedor, factura, categoría o repuesto..."
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
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          aria-label="Filtrar por categoría"
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="all">Todas las categorías</option>
          {(Object.keys(PURCHASE_CATEGORY_LABELS) as PurchaseCategory[]).map((cat) => (
            <option key={cat} value={cat}>
              {PURCHASE_CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {(
            [
              { id: 'all', label: 'Todas' },
              { id: 'pendiente', label: 'Pendientes' },
              { id: 'pagado', label: 'Pagadas' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`h-9 rounded-xl px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                statusFilter === tab.id
                  ? 'bg-[#0072BB] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {filteredPurchases.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {purchases.length === 0
              ? 'No hay compras registradas.'
              : 'No hay compras o gastos que coincidan con el filtro.'}
          </div>
        ) : (
          filteredPurchases.map((p) => {
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
            const isConfirming = confirmDeleteId === p.id;
            const isBusy = busyId === p.id;

            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                      {p.invoice}
                    </span>
                    <span>·</span>
                    <span>{formatDateShort(p.dueDate)}</span>
                    <span>·</span>
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {PURCHASE_CATEGORY_LABELS[info.category]}
                    </span>
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
                    {p.supplierName}
                  </div>
                  {(info.stockItems.length > 0 || info.note) && (
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {info.stockItems.length > 0 && (
                        <span>
                          Stock ingresado:{' '}
                          {info.stockItems.map((s) => `${s.name} (×${s.qty})`).join(', ')}
                        </span>
                      )}
                      {info.stockItems.length > 0 && info.note ? ' · ' : ''}
                      {info.note && <span className="italic">{info.note}</span>}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {formatCurrency(p.amount)}
                  </span>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void toggleStatus(p)}
                    className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                      info.isPaid
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}
                  >
                    {info.isPaid ? 'Pagado' : 'Pendiente'}
                  </button>
                  {isConfirming ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void deletePurchase(p)}
                        className="h-8 rounded-lg bg-red-600 px-2.5 text-[11px] font-semibold text-white hover:bg-red-700"
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
                      onClick={() => setConfirmDeleteId(p.id)}
                      aria-label="Eliminar compra"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
