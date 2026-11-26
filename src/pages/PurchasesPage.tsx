import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Download,
  Edit3,
  Plus,
  RefreshCw,
  Search,
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
  hydrateMercadoPagoConfig,
  loadMercadoPagoConfig,
  resolvePointDisplayName,
  type MercadoPagoConfig,
  type MpRecentPayment,
} from '../utils/mercadoPago';
import {
  clearMirroredPurchaseDismissed,
  markMirroredPurchaseDismissed,
  syncAllElectronicPaymentsToPurchases,
} from '../utils/mpPurchasesSync';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../utils/payment';
import {
  mergeSyncedMpPayments,
  useRecoveredPayments,
} from '../utils/paymentLedger';
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
type PurchaseChannelKey =
  | 'mp_point'
  | 'mp_meli'
  | 'mp_qr'
  | 'transferencia'
  | 'tarjeta'
  | 'efectivo';
type ChannelFilter = 'all' | PurchaseChannelKey;

interface ChannelStyleMeta {
  key: PurchaseChannelKey;
  label: string;
  shortLabel: string;
  swatchClass: string;
  textClass: string;
  activeTileClass: string;
}

const CHANNEL_STYLE_LIST: ChannelStyleMeta[] = [
  {
    key: 'mp_point',
    label: 'Point Smart / MP',
    shortLabel: 'Point Smart',
    swatchClass: 'bg-violet-500',
    textClass: 'text-violet-700 dark:text-violet-300',
    activeTileClass:
      'border-violet-300 bg-violet-50/75 dark:border-violet-700/70 dark:bg-violet-950/35',
  },
  {
    key: 'mp_meli',
    label: 'Mercado Libre',
    shortLabel: 'Mercado Libre',
    swatchClass: 'bg-amber-500',
    textClass: 'text-amber-700 dark:text-amber-300',
    activeTileClass:
      'border-amber-300 bg-amber-50/75 dark:border-amber-700/70 dark:bg-amber-950/35',
  },
  {
    key: 'mp_qr',
    label: 'QR Mercado Pago',
    shortLabel: 'QR MP',
    swatchClass: 'bg-sky-500',
    textClass: 'text-[#0072BB] dark:text-sky-300',
    activeTileClass:
      'border-sky-300 bg-sky-50/75 dark:border-sky-700/70 dark:bg-sky-950/35',
  },
  {
    key: 'transferencia',
    label: 'Transferencia',
    shortLabel: 'Transferencia',
    swatchClass: 'bg-teal-500',
    textClass: 'text-teal-700 dark:text-teal-300',
    activeTileClass:
      'border-teal-300 bg-teal-50/75 dark:border-teal-700/70 dark:bg-teal-950/35',
  },
  {
    key: 'tarjeta',
    label: 'Tarjeta',
    shortLabel: 'Tarjeta',
    swatchClass: 'bg-indigo-500',
    textClass: 'text-indigo-700 dark:text-indigo-300',
    activeTileClass:
      'border-indigo-300 bg-indigo-50/75 dark:border-indigo-700/70 dark:bg-indigo-950/35',
  },
  {
    key: 'efectivo',
    label: 'Efectivo',
    shortLabel: 'Efectivo',
    swatchClass: 'bg-emerald-500',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    activeTileClass:
      'border-emerald-300 bg-emerald-50/75 dark:border-emerald-700/70 dark:bg-emerald-950/35',
  },
];

const CHANNEL_STYLE_MAP: Record<PurchaseChannelKey, ChannelStyleMeta> =
  CHANNEL_STYLE_LIST.reduce(
    (acc, item) => {
      acc[item.key] = item;
      return acc;
    },
    {} as Record<PurchaseChannelKey, ChannelStyleMeta>
  );

function resolvePurchaseChannelKey(
  purchase: Pick<PurchaseRecord, 'supplierName'>,
  info: ReturnType<typeof parsePurchaseInfo>
): PurchaseChannelKey | null {
  const supLower = (purchase.supplierName || '').toLowerCase();
  const ptLower = (info.mpPointName || '').toLowerCase();
  const noteLower = (info.note || '').toLowerCase();

  if (
    info.mpChannel === 'mp_meli' ||
    info.originType === 'mp_meli' ||
    supLower.includes('mercado libre') ||
    supLower.includes('mercadolibre') ||
    ptLower.includes('mercado libre')
  ) {
    return 'mp_meli';
  }
  if (
    info.mpChannel === 'mp_point' ||
    ptLower.includes('point') ||
    supLower.includes('point smart')
  ) {
    return 'mp_point';
  }
  if (info.mpChannel === 'mp_qr') {
    return 'mp_qr';
  }
  if (info.mpChannel === 'mp_transfer' || info.paymentMethod === 'transferencia') {
    return 'transferencia';
  }
  if (info.paymentMethod === 'tarjeta') {
    return 'tarjeta';
  }
  if (info.paymentMethod === 'efectivo') {
    return 'efectivo';
  }
  if (noteLower.includes('point')) return 'mp_point';
  if (noteLower.includes('qr')) return 'mp_qr';
  return null;
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
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency = workshopMeta.currency;
  const openShift = useMemo(() => findOpenCashShift(tasks), [tasks]);
  const recoveredEntries = useRecoveredPayments(ownerId);

  const [hydratedMpConfig, setHydratedMpConfig] = useState<MercadoPagoConfig | null>(() =>
    ownerId ? loadMercadoPagoConfig(ownerId) : null
  );
  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    void hydrateMercadoPagoConfig(ownerId).then((cfg) => {
      if (active) setHydratedMpConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, [ownerId]);

  const mpConfig = useMemo<Partial<MercadoPagoConfig> | null>(() => {
    const profMp = workshopMeta.mercadoPago;
    const token = hydratedMpConfig?.accessToken || profMp?.accessToken || '';
    const posExternalId =
      hydratedMpConfig?.posExternalId || profMp?.posExternalId || '';
    const terminalId = hydratedMpConfig?.terminalId || profMp?.terminalId || '';
    const pointName = hydratedMpConfig?.pointName || profMp?.pointName || '';
    const sellerNickname =
      hydratedMpConfig?.sellerNickname || profMp?.sellerNickname || '';
    if (!token && !posExternalId && !terminalId && !pointName && !sellerNickname) {
      return null;
    }
    return { accessToken: token, posExternalId, terminalId, pointName, sellerNickname };
  }, [hydratedMpConfig, workshopMeta.mercadoPago]);

  const defaultPointName = useMemo(
    () => (mpConfig ? resolvePointDisplayName(mpConfig) : 'Point Smart'),
    [mpConfig]
  );

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [pointFilter, setPointFilter] = useState<string>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [payingPurchaseId, setPayingPurchaseId] = useState<string | null>(null);
  const [payCashMethod, setPayCashMethod] = useState<PaymentMethod>('efectivo');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncingMp, setSyncingMp] = useState(false);

  const lastAutoSyncSigRef = useRef<string>('');
  useEffect(() => {
    if (!ownerId) return;
    const sig = `${ownerId}|${sales.length}|${repairs.length}|${recoveredEntries.length}|${mpConfig?.pointName || ''}`;
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
      const hydrated = await hydrateMercadoPagoConfig(ownerId);
      const liveCfg: Partial<MercadoPagoConfig> = {
        ...workshopMeta.mercadoPago,
        ...hydrated,
        accessToken: hydrated.accessToken || workshopMeta.mercadoPago?.accessToken || '',
      };

      let mpPayments: MpRecentPayment[] = [];
      let mpWarn = '';
      if (liveCfg.accessToken) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const res = await fetchRecentMercadoPagoPayments({
          accessToken: liveCfg.accessToken,
          sinceIso: thirtyDaysAgo.toISOString(),
        });
        if (res.ok && Array.isArray(res.payments)) {
          mpPayments = res.payments;
        } else if (res.error) {
          mpWarn = res.error;
        }
      }

      const updatedLedger =
        mpPayments.length > 0
          ? mergeSyncedMpPayments(ownerId, mpPayments)
          : recoveredEntries;

      const result = await syncAllElectronicPaymentsToPurchases({
        ownerId,
        sales,
        repairs,
        purchases,
        recoveredEntries: updatedLedger,
        mpPayments,
        mpConfig: liveCfg,
        respectDismissed: false,
      });

      const totalSynced = result.created + result.updated;
      if (totalSynced > 0) {
        notify(
          `Sincronizadas ${totalSynced} cuentas de Point Smart, Mercado Libre, QR o Transferencia en Compras.`
        );
      } else if (mpWarn) {
        notify(
          `Cuentas locales revisadas. Mercado Pago devolvió: ${mpWarn}`,
          'info'
        );
      } else {
        notify(
          'Todas las compras de Mercado Libre, Point Smart, QR y Transferencias ya están al día.'
        );
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

  const {
    manualTotal,
    manualPending,
    electronicTotal,
    electronicCount,
    channelStats,
    channelSumTotal,
    availablePointNames,
  } = useMemo(() => {
    let mTotal = 0;
    let mPaid = 0;
    let eTotal = 0;
    let eCount = 0;
    const byChannel: Record<PurchaseChannelKey, { amount: number; count: number }> = {
      mp_point: { amount: 0, count: 0 },
      mp_meli: { amount: 0, count: 0 },
      mp_qr: { amount: 0, count: 0 },
      transferencia: { amount: 0, count: 0 },
      tarjeta: { amount: 0, count: 0 },
      efectivo: { amount: 0, count: 0 },
    };
    const pointSet = new Set<string>();

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

      const chKey = resolvePurchaseChannelKey(x, info);
      if (chKey) {
        byChannel[chKey].amount += amt;
        byChannel[chKey].count += 1;
      }

      const resolvedPt =
        info.mpPointName ||
        (chKey === 'mp_point' || chKey === 'mp_qr'
          ? defaultPointName
          : chKey === 'mp_meli'
            ? 'Mercado Libre'
            : '');
      if (resolvedPt) pointSet.add(resolvedPt);
    }

    const sumAllChannels = Object.values(byChannel).reduce((s, item) => s + item.amount, 0);

    return {
      manualTotal: mTotal,
      manualPending: Math.max(0, mTotal - mPaid),
      electronicTotal: eTotal,
      electronicCount: eCount,
      channelStats: byChannel,
      channelSumTotal: sumAllChannels,
      availablePointNames: Array.from(pointSet).sort((a, b) => a.localeCompare(b, 'es')),
    };
  }, [purchases, defaultPointName]);

  const filteredPurchases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...purchases]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((p) => {
        const info = parsePurchaseInfo(p);
        const mirrored = isMirroredIncomePurchase(info);
        const chKey = resolvePurchaseChannelKey(p, info);
        const resolvedPt =
          info.mpPointName ||
          (chKey === 'mp_point' || chKey === 'mp_qr'
            ? defaultPointName
            : chKey === 'mp_meli'
              ? 'Mercado Libre'
              : '');

        if (originFilter === 'manual' && mirrored) return false;
        if (originFilter === 'electronic' && !mirrored && info.originType !== 'mp_meli') {
          return false;
        }
        if (statusFilter === 'pagado' && !info.isPaid) return false;
        if (statusFilter === 'pendiente' && info.isPaid) return false;
        if (categoryFilter !== 'all' && info.category !== categoryFilter) return false;
        if (channelFilter !== 'all' && chKey !== channelFilter) return false;
        if (pointFilter !== 'all' && resolvedPt !== pointFilter) return false;

        if (q) {
          const chMeta = chKey ? CHANNEL_STYLE_MAP[chKey] : null;
          const hay = [
            p.invoice,
            p.supplierName,
            PURCHASE_CATEGORY_LABELS[info.category],
            PURCHASE_ORIGIN_LABELS[info.originType],
            chMeta?.label || '',
            resolvedPt,
            info.note,
            ...info.stockItems.map((s) => s.name),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [
    purchases,
    query,
    statusFilter,
    categoryFilter,
    originFilter,
    channelFilter,
    pointFilter,
    defaultPointName,
  ]);

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
      isOutflow: info.isOutflow,
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
      isOutflow: info.isOutflow,
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
      if (ownerId && (isMirroredIncomePurchase(info) || info.originType === 'mp_meli')) {
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
      'Tipo',
      'Cuenta / Proveedor',
      'Canal / Medio de pago',
      'Nombre Point / Mercado Libre',
      'Categoría',
      'Estado',
      `Importe (${baseCurrency})`,
      'Detalle / Stock ingresado',
      'Nota',
    ];
    const rows = filteredPurchases.map((p) => {
      const info = parsePurchaseInfo(p);
      const mirrored = isMirroredIncomePurchase(info);
      const chKey = resolvePurchaseChannelKey(p, info);
      const chLabel = chKey ? CHANNEL_STYLE_MAP[chKey].label : 'Sin especificar';
      const pointName =
        info.mpPointName ||
        (chKey === 'mp_point' || chKey === 'mp_qr'
          ? defaultPointName
          : chKey === 'mp_meli'
            ? 'Mercado Libre'
            : '');
      return [
        p.invoice,
        p.dueDate || new Date(p.createdAt || Date.now()).toISOString().slice(0, 10),
        PURCHASE_ORIGIN_LABELS[info.originType],
        mirrored ? 'Cobro sincronizado' : 'Compra / Egreso',
        p.supplierName,
        chLabel,
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

  const hasAnyFilter = Boolean(
    query ||
      statusFilter !== 'all' ||
      categoryFilter !== 'all' ||
      originFilter !== 'all' ||
      channelFilter !== 'all' ||
      pointFilter !== 'all'
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            {tr('Compras y gastos', 'Purchases & expenses', 'Compras e despesas')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Compras en Mercado Libre, reposición y cuentas pagadas o cobradas con Point Smart, QR, Transferencia y Tarjeta
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
              {syncingMp ? 'Sincronizando...' : 'Sincronizar MP / Point'}
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

      {/* Primary KPI Totals */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
            {formatCompactCurrency(manualTotal, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Compras / Mercado Libre / Gastos
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-amber-600 sm:text-2xl dark:text-amber-400">
            {formatCompactCurrency(manualPending, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {tr('Pendiente a proveedores', 'Pending to suppliers', 'Pendente a fornecedores')}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-xl font-bold text-[#0072BB] sm:text-2xl dark:text-sky-400">
            {formatCompactCurrency(electronicTotal, baseCurrency)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Cuentas Point / QR / Transf. ({electronicCount})
          </div>
        </div>
      </div>

      {/* Color-Coded Conteo & Channel Breakdown Strip */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
            Conteo por canal y medio de pago
          </span>
          {channelFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setChannelFilter('all')}
              className="text-[11px] font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
            >
              Ver todos los canales
            </button>
          )}
        </div>

        {channelSumTotal > 0 && (
          <div
            aria-label="Distribución por canal"
            className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            {CHANNEL_STYLE_LIST.map((ch) => {
              const amt = channelStats[ch.key].amount;
              if (amt <= 0) return null;
              const pct = (amt / channelSumTotal) * 100;
              return (
                <div
                  key={ch.key}
                  className={`h-full transition-all ${ch.swatchClass}`}
                  style={{ width: `${pct}%` }}
                  title={`${ch.label}: ${channelStats[ch.key].count} op. · ${formatCurrency(amt, baseCurrency)}`}
                />
              );
            })}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {CHANNEL_STYLE_LIST.map((ch) => {
            const stat = channelStats[ch.key];
            const isActive = channelFilter === ch.key;
            return (
              <button
                key={ch.key}
                type="button"
                onClick={() =>
                  setChannelFilter((prev) => (prev === ch.key ? 'all' : ch.key))
                }
                className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
                  isActive
                    ? ch.activeTileClass
                    : 'border-slate-200/80 bg-slate-50/50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1.5">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-[2px] ${ch.swatchClass}`} />
                    <span className={`truncate text-[11px] font-semibold ${ch.textClass}`}>
                      {ch.shortLabel}
                    </span>
                  </span>
                  <span className="font-mono-num text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    {stat.count}
                  </span>
                </div>
                <div className="mt-1 font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                  {formatCompactCurrency(stat.amount, baseCurrency)}
                </div>
              </button>
            );
          })}
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
              'Buscar proveedor, Point Smart, Mercado Libre, QR o transferencia...',
              'Search supplier, Point Smart, Mercado Libre, QR or transfer...',
              'Buscar fornecedor, Point Smart, Mercado Libre, QR ou transferência...'
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

        {availablePointNames.length > 0 && (
          <select
            value={pointFilter}
            onChange={(e) => setPointFilter(e.target.value)}
            aria-label="Filtrar por Point o cuenta"
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">Todos los Points / Cuentas ({availablePointNames.length})</option>
            {availablePointNames.map((pt) => (
              <option key={pt} value={pt}>
                {pt}
              </option>
            ))}
          </select>
        )}

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
              { id: 'electronic', label: 'MP / Point / QR' },
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
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            <p>
              {purchases.length === 0
                ? 'No hay compras ni cuentas registradas.'
                : 'No hay registros que coincidan con el filtro actual.'}
            </p>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                  setCategoryFilter('all');
                  setOriginFilter('all');
                  setChannelFilter('all');
                  setPointFilter('all');
                }}
                className="mt-3 inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] dark:border-slate-700 dark:text-slate-200"
              >
                Restablecer filtros
              </button>
            )}
          </div>
        ) : (
          filteredPurchases.map((p) => {
            const info = parsePurchaseInfo(p);
            const mirrored = isMirroredIncomePurchase(info);
            const chKey = resolvePurchaseChannelKey(p, info);
            const chMeta = chKey ? CHANNEL_STYLE_MAP[chKey] : null;
            const displayPointName =
              info.mpPointName ||
              (chKey === 'mp_point' || chKey === 'mp_qr'
                ? defaultPointName
                : chKey === 'mp_meli'
                  ? 'Mercado Libre'
                  : '');
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
              <div key={p.id} className="px-4 py-3.5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                        {p.invoice}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">{formatDateShort(p.dueDate)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {PURCHASE_ORIGIN_LABELS[info.originType]}
                      </span>
                      {chMeta && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className={`inline-flex items-center gap-1.5 font-semibold ${chMeta.textClass}`}>
                            <span className={`h-2 w-2 rounded-[2px] ${chMeta.swatchClass}`} />
                            <span>{chMeta.label}</span>
                          </span>
                        </>
                      )}
                      {displayPointName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {displayPointName}
                          </span>
                        </>
                      )}
                      {!mirrored && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {PURCHASE_CATEGORY_LABELS[info.category]}
                          </span>
                        </>
                      )}
                      {hasForeignCurrency && info.currency && (
                        <>
                          <span aria-hidden="true">·</span>
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
                    <div className="mr-0.5 text-right">
                      <div
                        className={`font-mono-num text-sm font-bold ${
                          mirrored
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {mirrored ? '+' : '-'}
                        {formatCurrency(p.amount, baseCurrency)}
                      </div>
                      <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                        {mirrored ? 'Cobro cuenta MP' : 'Compra / Egreso'}
                      </div>
                    </div>
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


