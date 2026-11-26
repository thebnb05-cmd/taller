import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CreditCard,
  Download,
  Edit3,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { deleteRow, updateRow } from '../lib/db';
import type {
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
  TaskRecord,
  WorkshopProfile,
} from '../types/workshop';
import {
  appendMovementToOpenCashShift,
  findOpenCashShift,
} from '../utils/cashRegister';
import { downloadCsvFile } from '../utils/csvExport';
import { convertFromBaseCurrency } from '../utils/currency';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDateShort,
  todayISO,
} from '../utils/formatters';
import {
  fetchRecentMercadoPagoPayments,
  loadMercadoPagoConfig,
  resolvePointDisplayName,
  type MpRecentPayment,
} from '../utils/mercadoPago';
import {
  clearMirroredPurchaseDismissed,
  markMirroredPurchaseDismissed,
  syncAllElectronicPaymentsToPurchases,
} from '../utils/mpPurchasesSync';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../utils/payment';
import { useRecoveredPayments } from '../utils/paymentLedger';
import {
  isMirroredIncomePurchase,
  parsePurchaseInfo,
  PURCHASE_CATEGORY_LABELS,
  PURCHASE_ORIGIN_LABELS,
  serializePurchaseStatus,
  type PurchaseCategory,
} from '../utils/purchaseMeta';
import { sanitizeDbErrorMessage } from '../utils/validation';
import { parseWorkshopMeta } from '../utils/workshopMeta';
import { useI18n } from '../utils/i18n';

interface PurchasesPageProps {
  purchases: PurchaseRecord[];
  products?: ProductRecord[];
  tasks?: TaskRecord[];
  sales?: SaleRecord[];
  repairs?: RepairRecord[];
  ownerId?: string;
  profile?: WorkshopProfile | null;
  onNewPurchase: () => void;
  onEditPurchase?: (purchase: PurchaseRecord) => void;
}

type StatusFilter = 'all' | 'pendiente' | 'pagado';
type CategoryFilter = 'all' | PurchaseCategory;
type OriginFilter = 'all' | 'manual' | 'electronic';

function getPurchaseChannelBadge(
  info: ReturnType<typeof parsePurchaseInfo>
): { label: string; className: string; kind: 'point' | 'qr' | 'transfer' | 'card' | 'cash' | null } {
  if (info.mpChannel === 'mp_point') {
    return {
      label: 'Point MP',
      kind: 'point',
      className:
        'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
    };
  }
  if (info.mpChannel === 'mp_qr') {
    return {
      label: 'QR Mercado Pago',
      kind: 'qr',
      className: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
    };
  }
  if (info.paymentMethod === 'transferencia') {
    return {
      label: 'Transferencia',
      kind: 'transfer',
      className: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300',
    };
  }
  if (info.paymentMethod === 'tarjeta') {
    return {
      label: 'Tarjeta',
      kind: 'card',
      className:
        'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
    };
  }
  if (info.paymentMethod === 'efectivo') {
    return {
      label: 'Efectivo',
      kind: 'cash',
      className:
        'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    };
  }
  return { label: '', kind: null, className: '' };
}

export const PurchasesPage: React.FC<PurchasesPageProps> = ({
  purchases,
  products = [],
  tasks = [],
  sales = [],
  repairs = [],
  ownerId = '',
  profile,
  onNewPurchase,
  onEditPurchase,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);
  const openShift = useMemo(() => findOpenCashShift(tasks), [tasks]);
  const recoveredEntries = useRecoveredPayments(ownerId);
  const mpConfig = useMemo(
    () => (ownerId ? loadMercadoPagoConfig(ownerId) : null),
    [ownerId]
  );
  const defaultPointName = useMemo(
    () => resolvePointDisplayName(mpConfig),
    [mpConfig]
  );

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [payingPurchaseId, setPayingPurchaseId] = useState<string | null>(null);
  const [payCashMethod, setPayCashMethod] = useState<PaymentMethod>('efectivo');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncingMp, setSyncingMp] = useState(false);

  const lastAutoSyncSigRef = useRef<string>('');
  useEffect(() => {
    if (!ownerId) return;
    const sig = `${ownerId}|${sales.length}|${repairs.length}|${recoveredEntries.length}`;
    if (lastAutoSyncSigRef.current === sig) return;
    lastAutoSyncSigRef.current = sig;

    void syncAllElectronicPaymentsToPurchases({
      ownerId,
      sales,
      repairs,
      purchases,
      recoveredEntries,
      mpConfig,
      respectDismissed: true,
    });
  }, [ownerId, sales, repairs, purchases, recoveredEntries, mpConfig]);

  const handleSyncElectronicAccounts = async () => {
    if (!ownerId || syncingMp) return;
    setSyncingMp(true);
    try {
      clearMirroredPurchaseDismissed(ownerId);
      const liveCfg = loadMercadoPagoConfig(ownerId);
      let mpPayments: MpRecentPayment[] = [];
      let mpWarn = '';
      if (liveCfg.accessToken) {
        const res = await fetchRecentMercadoPagoPayments({
          accessToken: liveCfg.accessToken,
        });
        if (res.ok && Array.isArray(res.payments)) {
          mpPayments = res.payments;
        } else if (res.error) {
          mpWarn = res.error;
        }
      }

      const result = await syncAllElectronicPaymentsToPurchases({
        ownerId,
        sales,
        repairs,
        purchases,
        recoveredEntries,
        mpPayments,
        mpConfig: liveCfg,
        respectDismissed: false,
      });

      const totalSynced = result.created + result.updated;
      if (totalSynced > 0) {
        notify(
          `Sincronizadas ${totalSynced} cuentas de Point, QR o Transferencia en Compras.`
        );
      } else if (mpWarn) {
        notify(
          `Cuentas locales revisadas. Mercado Pago devolvió: ${mpWarn}`,
          'info'
        );
      } else {
        notify('Todas las cuentas de Point, QR y Transferencia ya están al día en Compras.');
      }
    } catch (err) {
      notify(
        sanitizeDbErrorMessage(err, 'No se pudieron sincronizar las cuentas electrónicas.'),
        'error'
      );
    } finally {
      setSyncingMp(false);
    }
  };

  const { manualTotal, manualPending, electronicTotal, electronicCount } = useMemo(() => {
    let mTotal = 0;
    let mPaid = 0;
    let eTotal = 0;
    let eCount = 0;
    for (const x of purchases) {
      const info = parsePurchaseInfo(x);
      const amt = Number(x.amount || 0);
      if (isMirroredIncomePurchase(info)) {
        eTotal += amt;
        eCount += 1;
      } else {
        mTotal += amt;
        if (info.isPaid) mPaid += amt;
      }
    }
    return {
      manualTotal: mTotal,
      manualPending: Math.max(0, mTotal - mPaid),
      electronicTotal: eTotal,
      electronicCount: eCount,
    };
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...purchases]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((p) => {
        const info = parsePurchaseInfo(p);
        const mirrored = isMirroredIncomePurchase(info);
        if (originFilter === 'manual' && mirrored) return false;
        if (originFilter === 'electronic' && !mirrored) return false;
        if (statusFilter === 'pagado' && !info.isPaid) return false;
        if (statusFilter === 'pendiente' && info.isPaid) return false;
        if (categoryFilter !== 'all' && info.category !== categoryFilter) return false;
        if (q) {
          const badge = getPurchaseChannelBadge(info);
          const hay = [
            p.invoice,
            p.supplierName,
            PURCHASE_CATEGORY_LABELS[info.category],
            PURCHASE_ORIGIN_LABELS[info.originType],
            badge.label,
            info.mpPointName || '',
            info.note,
            ...info.stockItems.map((s) => s.name),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [purchases, query, statusFilter, categoryFilter, originFilter]);

  const commitPaidStatus = async (p: PurchaseRecord, withCashEgreso: boolean) => {
    const info = parsePurchaseInfo(p);
    const next = serializePurchaseStatus({
      status: 'pagado',
      currency: info.currency,
      rate: info.rate,
      category: info.category,
      note: info.note,
      stockItems: info.stockItems,
      paymentMethod: info.paymentMethod,
      mpChannel: info.mpChannel,
      mpPointName: info.mpPointName,
      mpOrderId: info.mpOrderId,
      mpPaymentId: info.mpPaymentId,
      mpExternalReference: info.mpExternalReference,
      originType: info.originType,
      originRecordId: info.originRecordId,
    });
    setBusyId(p.id);
    try {
      await updateRow('purchases', p.id, { status: next });
      let deducted = false;
      if (withCashEgreso && openShift && ownerId && Number(p.amount || 0) > 0) {
        const res = await appendMovementToOpenCashShift({
          ownerId,
          tasks,
          movement: {
            type: 'egreso',
            amount: Number(p.amount || 0),
            method: payCashMethod,
            concept: `Compra: ${p.supplierName}${p.invoice ? ` (${p.invoice})` : ''}`,
          },
        });
        deducted = res.ok;
      }
      setPayingPurchaseId(null);
      notify(
        deducted
          ? `Compra marcada como pagada y egreso registrado en caja abierta (${PAYMENT_METHOD_LABELS[payCashMethod]}).`
          : 'Compra marcada como pagada.'
      );
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo actualizar la compra.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleStatus = async (p: PurchaseRecord) => {
    const info = parsePurchaseInfo(p);
    if (!info.isPaid && openShift && ownerId && !isMirroredIncomePurchase(info)) {
      setConfirmDeleteId(null);
      setPayCashMethod(info.paymentMethod || 'efectivo');
      setPayingPurchaseId((prev) => (prev === p.id ? null : p.id));
      return;
    }
    const next = serializePurchaseStatus({
      status: info.isPaid ? 'pendiente' : 'pagado',
      currency: info.currency,
      rate: info.rate,
      category: info.category,
      note: info.note,
      stockItems: info.stockItems,
      paymentMethod: info.paymentMethod,
      mpChannel: info.mpChannel,
      mpPointName: info.mpPointName,
      mpOrderId: info.mpOrderId,
      mpPaymentId: info.mpPaymentId,
      mpExternalReference: info.mpExternalReference,
      originType: info.originType,
      originRecordId: info.originRecordId,
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
      const info = parsePurchaseInfo(p);
      if (ownerId && isMirroredIncomePurchase(info)) {
        markMirroredPurchaseDismissed(ownerId, p);
      }
      await deleteRow('purchases', p.id);

      let revertedStock = false;
      for (const line of info.stockItems) {
        if (!line.productId || line.qty <= 0) continue;
        const matched = products.find((prod) => prod.id === line.productId);
        if (matched && matched.trackStock) {
          revertedStock = true;
          await updateRow('products', matched.id, {
            stock: Math.max(0, Number(matched.stock || 0) - line.qty),
          });
        }
      }

      setConfirmDeleteId(null);
      notify(
        revertedStock
          ? 'Compra eliminada y stock ingresado revertido en inventario.'
          : 'Registro eliminado de Compras.'
      );
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
      'Fecha',
      'Origen',
      'Cuenta / Proveedor',
      'Canal / Medio de pago',
      'Nombre Point Mercado Pago',
      'Categoría',
      'Estado',
      `Importe (${baseCurrency})`,
      'Detalle / Stock ingresado',
      'Nota',
    ];
    const rows = filteredPurchases.map((p) => {
      const info = parsePurchaseInfo(p);
      const channel = getPurchaseChannelBadge(info);
      const pointName =
        info.mpPointName || (info.mpChannel ? defaultPointName : '');
      return [
        p.invoice,
        p.dueDate || new Date(p.createdAt || Date.now()).toISOString().slice(0, 10),
        PURCHASE_ORIGIN_LABELS[info.originType],
        p.supplierName,
        channel.label || 'Sin especificar',
        pointName,
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
            {tr('Compras y gastos', 'Purchases & expenses', 'Compras e despesas')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'Reposición, gastos y cuentas cobradas por Point, QR y Transferencia',
              'Restock, expenses and accounts paid via Point, QR and Transfer',
              'Reposição, despesas e contas pagas via Point, QR e Transferência'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ownerId && (
            <button
              type="button"
              disabled={syncingMp}
              onClick={() => void handleSyncElectronicAccounts()}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3.5 text-xs font-semibold text-[#0072BB] hover:bg-sky-100 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-300"
            >
              <RefreshCw className={`h-4 w-4 ${syncingMp ? 'animate-spin' : ''}`} />
              {syncingMp ? 'Sincronizando...' : 'Sincronizar Point / QR'}
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredPurchases.length === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            {tr('Exportar CSV', 'Export CSV', 'Exportar CSV')}
          </button>
          <button
            type="button"
            onClick={onNewPurchase}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            {tr('Nueva compra', 'New purchase', 'Nova compra')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
            {formatCompactCurrency(manualTotal, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500">
            {tr('Compras / Gastos', 'Purchases / Expenses', 'Compras / Despesas')}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-amber-600 sm:text-2xl dark:text-amber-400">
            {formatCompactCurrency(manualPending, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500">
            {tr('Pendiente a proveedores', 'Pending to suppliers', 'Pendente a fornecedores')}
          </div>
        </div>
        <div className="rounded-2xl border border-sky-200/80 bg-sky-50/40 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
          <div className="font-mono-num text-xl font-bold text-[#0072BB] sm:text-2xl dark:text-sky-400">
            {formatCompactCurrency(electronicTotal, baseCurrency)}
          </div>
          <div className="text-xs text-sky-900/80 dark:text-sky-300/80">
            Cuentas Point / QR / Transf. ({electronicCount})
          </div>
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
            placeholder={tr(
              'Buscar proveedor, Point, factura, QR o transferencia...',
              'Search supplier, Point, invoice, QR or transfer...',
              'Buscar fornecedor, Point, fatura, QR ou transferência...'
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
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          aria-label={tr('Filtrar por categoría', 'Filter by category', 'Filtrar por categoria')}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="all">{tr('Todas las categorías', 'All categories', 'Todas as categorias')}</option>
          {(Object.keys(PURCHASE_CATEGORY_LABELS) as PurchaseCategory[]).map((cat) => (
            <option key={cat} value={cat}>
              {PURCHASE_CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {(
            [
              { id: 'all', label: 'Todo' },
              { id: 'manual', label: 'Compras / Gastos' },
              { id: 'electronic', label: 'Point / QR / Transf.' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setOriginFilter(tab.id)}
              className={`h-9 rounded-xl px-2.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                originFilter === tab.id
                  ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {(
            [
              { id: 'all', label: tr('Todas', 'All', 'Todas') },
              { id: 'pendiente', label: tr('Pendientes', 'Pending', 'Pendentes') },
              { id: 'pagado', label: tr('Pagadas', 'Paid', 'Pagas') },
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
              ? 'No hay compras ni cuentas registradas.'
              : 'No hay registros que coincidan con el filtro.'}
          </div>
        ) : (
          filteredPurchases.map((p) => {
            const info = parsePurchaseInfo(p);
            const mirrored = isMirroredIncomePurchase(info);
            const channelBadge = getPurchaseChannelBadge(info);
            const displayPointName =
              info.mpPointName || (info.mpChannel ? defaultPointName : '');
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
            const isPayingPrompt = payingPurchaseId === p.id;
            const isBusy = busyId === p.id;

            return (
              <div key={p.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                        {p.invoice}
                      </span>
                      <span>·</span>
                      <span>{formatDateShort(p.dueDate)}</span>
                      <span>·</span>
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          mirrored
                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {PURCHASE_ORIGIN_LABELS[info.originType]}
                      </span>
                      {channelBadge.label && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${channelBadge.className}`}
                        >
                          {channelBadge.kind === 'qr' ? (
                            <QrCode className="h-3 w-3" />
                          ) : channelBadge.kind === 'point' ? (
                            <Smartphone className="h-3 w-3" />
                          ) : channelBadge.kind === 'card' ? (
                            <CreditCard className="h-3 w-3" />
                          ) : null}
                          {channelBadge.label}
                        </span>
                      )}
                      {displayPointName && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                          Point: {displayPointName}
                        </span>
                      )}
                      {!mirrored && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-slate-600 dark:text-slate-300">
                            {PURCHASE_CATEGORY_LABELS[info.category]}
                          </span>
                        </>
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

                  <div className="flex items-center gap-1.5">
                    <span className="mr-0.5 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(p.amount, baseCurrency)}
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
                    {onEditPurchase && !isConfirming && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setPayingPurchaseId(null);
                          onEditPurchase(p);
                        }}
                        aria-label="Editar compra"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0072BB] dark:hover:bg-slate-800 dark:hover:text-sky-400"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    )}
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
                        onClick={() => {
                          setPayingPurchaseId(null);
                          setConfirmDeleteId(p.id);
                        }}
                        aria-label="Eliminar compra"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {isPayingPrompt && openShift && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs dark:border-sky-900/60 dark:bg-sky-950/30">
                    <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                      <Banknote className="h-4 w-4 shrink-0 text-[#0072BB] dark:text-sky-400" />
                      <span>
                        ¿Descontar{' '}
                        <strong className="font-mono-num">
                          {formatCurrency(p.amount, baseCurrency)}
                        </strong>{' '}
                        de la caja diaria abierta ({openShift.shiftDate})?
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={payCashMethod}
                        onChange={(e) => setPayCashMethod(e.target.value as PaymentMethod)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      >
                        {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void commitPaidStatus(p, true)}
                        className="h-8 rounded-lg bg-[#0072BB] px-2.5 text-[11px] font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
                      >
                        Pagar y descontar de caja
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void commitPaidStatus(p, false)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        Solo marcar pagada
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setPayingPurchaseId(null)}
                        className="h-8 rounded-lg px-2 text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400"
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

