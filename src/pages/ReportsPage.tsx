import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  FileDown,
  PackageX,
  QrCode,
  Search,
  ShoppingBag,
  Smartphone,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { RevenueTrendChart } from '../components/RevenueTrendChart';
import { useToast } from '../components/ToastProvider';
import { STATUS_META } from '../data/catalog';
import type {
  ClientRecord,
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  RepairStatus,
  SaleRecord,
  WorkshopProfile,
} from '../types/workshop';
import { downloadCsvFile } from '../utils/csvExport';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDateShort,
  isActiveRepairStatus,
  todayISO,
} from '../utils/formatters';
import {
  loadMercadoPagoConfig,
  resolvePointDisplayName,
} from '../utils/mercadoPago';
import { parsePaymentInfo } from '../utils/payment';
import {
  getUnreconciledPayments,
  toSyntheticSalesFromRecovered,
  useRecoveredPayments,
} from '../utils/paymentLedger';
import {
  isMirroredIncomePurchase,
  parsePurchaseInfo,
  PURCHASE_ORIGIN_LABELS,
} from '../utils/purchaseMeta';
import { parseRepairPaymentLedger } from '../utils/repairMeta';
import { parseSaleDetails, parseSalePaymentInfo } from '../utils/saleMeta';
import { useI18n } from '../utils/i18n';

interface ReportsPageProps {
  ownerId?: string;
  profile?: WorkshopProfile | null;
  repairs: RepairRecord[];
  clients: ClientRecord[];
  products: ProductRecord[];
  sales: SaleRecord[];
  purchases: PurchaseRecord[];
  onSelectProduct: (p: ProductRecord) => void;
}

type RangeId = 'today' | '7' | 'month' | '30' | '90' | 'custom' | 'all';

const RANGE_OPTIONS: Array<{ id: RangeId; label: string; pdfLabel: string }> = [
  { id: 'today', label: 'Hoy', pdfLabel: 'Hoy' },
  { id: '7', label: '7 días', pdfLabel: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes', pdfLabel: 'Mes actual' },
  { id: '30', label: '30 días', pdfLabel: 'Últimos 30 días' },
  { id: '90', label: '90 días', pdfLabel: 'Últimos 90 días' },
  { id: 'custom', label: 'Personalizado', pdfLabel: 'Período personalizado' },
  { id: 'all', label: 'Histórico', pdfLabel: 'Histórico total' },
];

const FUNNEL_ORDER: RepairStatus[] = [
  'recibido',
  'diagnostico',
  'espera_repuesto',
  'en_progreso',
  'listo',
  'entregado',
];

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function parseLocalDateInput(iso: string, fallbackMs: number): number {
  if (!iso) return fallbackMs;
  const parsed = new Date(`${iso}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallbackMs : parsed.getTime();
}

function computeDelta(current: number, previous: number): {
  pct: number;
  direction: 'up' | 'down' | 'flat';
} | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0 && current === 0) return { pct: 0, direction: 'flat' };
  if (previous === 0) return { pct: 100, direction: current > 0 ? 'up' : 'down' };
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return {
    pct: Math.abs(pct),
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  };
}

function getMetricNumberClass(
  rawText: string,
  variant: 'primary' | 'compact' = 'primary'
): string {
  const len = rawText.length;
  if (variant === 'primary') {
    if (len >= 12) return 'text-base sm:text-lg xl:text-xl';
    if (len >= 9) return 'text-lg sm:text-xl xl:text-[22px]';
    return 'text-xl xl:text-2xl';
  }
  if (len >= 11) return 'text-sm sm:text-base xl:text-lg';
  if (len >= 8) return 'text-base sm:text-lg xl:text-xl';
  return 'text-lg sm:text-xl';
}

interface TimelineBucket {
  key: string;
  label: string;
  fullLabel: string;
  repairsRevenue: number;
  salesRevenue: number;
  purchasesExpense: number;
  ordersCount: number;
}

type ElectronicChannelType = 'mp_point' | 'mp_qr' | 'transferencia' | 'tarjeta';
type ElectronicChannelFilter = 'all' | ElectronicChannelType;

interface ElectronicHistoryItem {
  id: string;
  createdAt: number;
  dateLabel: string;
  originLabel: string;
  counterparty: string;
  concept: string;
  channel: ElectronicChannelType;
  channelLabel: string;
  mpPointName: string;
  reference: string;
  amount: number;
  isOutflow: boolean;
}

const ELECTRONIC_CHANNEL_LABELS: Record<ElectronicChannelType, string> = {
  mp_point: 'Point Mercado Pago',
  mp_qr: 'QR Mercado Pago',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
};

function normalizeMpRef(ref?: string | null): string {
  return String(ref || '')
    .trim()
    .replace(/-PT$/i, '')
    .toUpperCase();
}

function toMsSafe(val: number | string | undefined, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  ownerId = '',
  profile,
  repairs,
  clients,
  products,
  sales,
  purchases,
  onSelectProduct,
}) => {
  const { notify } = useToast();
  const { locale, tr } = useI18n();

  const recoveredEntries = useRecoveredPayments(ownerId);
  const unreconciledRecovered = useMemo(
    () => getUnreconciledPayments(recoveredEntries, sales, repairs),
    [recoveredEntries, sales, repairs]
  );
  const effectiveSales = useMemo(
    () => [...sales, ...toSyntheticSalesFromRecovered(unreconciledRecovered)],
    [sales, unreconciledRecovered]
  );
  const defaultMpPointName = useMemo(
    () => resolvePointDisplayName(ownerId ? loadMercadoPagoConfig(ownerId) : null),
    [ownerId]
  );
  const [range, setRange] = useState<RangeId>('30');
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  });
  const [customTo, setCustomTo] = useState<string>(() => todayISO());
  const [activeBucketIndex, setActiveBucketIndex] = useState<number | null>(null);
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const [electronicFilter, setElectronicFilter] = useState<ElectronicChannelFilter>('all');
  const [electronicQuery, setElectronicQuery] = useState('');
  const pdfMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pdfMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target as Node)) {
        setPdfMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [pdfMenuOpen]);

  useEffect(() => {
    setActiveBucketIndex(null);
  }, [range, customFrom, customTo]);

  const windowBounds = useMemo(() => {
    const now = Date.now();
    const todayStart = startOfLocalDay(now);

    if (range === 'all') {
      return {
        startMs: 0,
        endMs: now,
        prevStartMs: null as number | null,
        prevEndMs: null as number | null,
        compareLabel: '',
        pdfLabel: 'Histórico total',
      };
    }

    if (range === 'today') {
      const prevStart = todayStart - 24 * 60 * 60 * 1000;
      return {
        startMs: todayStart,
        endMs: now,
        prevStartMs: prevStart,
        prevEndMs: todayStart - 1,
        compareLabel: 'vs. ayer',
        pdfLabel: 'Hoy',
      };
    }

    if (range === 'month') {
      const nowDate = new Date(now);
      const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1, 0, 0, 0, 0).getTime();
      const prevMonthStart = new Date(
        nowDate.getFullYear(),
        nowDate.getMonth() - 1,
        1,
        0,
        0,
        0,
        0
      ).getTime();
      const prevMonthEnd = monthStart - 1;
      return {
        startMs: monthStart,
        endMs: now,
        prevStartMs: prevMonthStart,
        prevEndMs: prevMonthEnd,
        compareLabel: 'vs. mes ant.',
        pdfLabel: 'Mes actual',
      };
    }

    if (range === 'custom') {
      const rawA = parseLocalDateInput(customFrom, todayStart - 14 * 24 * 60 * 60 * 1000);
      const rawB = parseLocalDateInput(customTo, now);
      const startMs = startOfLocalDay(Math.min(rawA, rawB));
      const endMs = endOfLocalDay(Math.max(rawA, rawB));
      const span = Math.max(24 * 60 * 60 * 1000, endMs - startMs + 1);
      return {
        startMs,
        endMs,
        prevStartMs: startMs - span,
        prevEndMs: startMs - 1,
        compareLabel: 'vs. período ant.',
        pdfLabel: `Del ${customFrom} al ${customTo}`,
      };
    }

    const days = Number(range);
    const spanMs = days * 24 * 60 * 60 * 1000;
    const startMs = now - spanMs;
    return {
      startMs,
      endMs: now,
      prevStartMs: startMs - spanMs,
      prevEndMs: startMs - 1,
      compareLabel: `vs. ${days}d ant.`,
      pdfLabel: `Últimos ${days} días`,
    };
  }, [range, customFrom, customTo]);

  const report = useMemo(() => {
    const { startMs, endMs, prevStartMs, prevEndMs } = windowBounds;
    const inCurrent = (ts: number) => ts >= startMs && ts <= endMs;
    const inPrevious = (ts: number) =>
      prevStartMs !== null && prevEndMs !== null && ts >= prevStartMs && ts <= prevEndMs;

    const unreconciledRepairs = unreconciledRecovered.filter((r) => r.source === 'reparacion');
    const realPurchases = purchases.filter(
      (p) => !isMirroredIncomePurchase(parsePurchaseInfo(p))
    );

    const rFiltered = repairs.filter((r) => inCurrent(r.createdAt));
    const sFiltered = effectiveSales.filter((s) => inCurrent(s.createdAt));
    const pFiltered = realPurchases.filter((p) => inCurrent(p.createdAt));
    const recRepFiltered = unreconciledRepairs.filter((r) => inCurrent(r.createdAt));

    const rPrev = repairs.filter((r) => inPrevious(r.createdAt));
    const sPrev = effectiveSales.filter((s) => inPrevious(s.createdAt));
    const pPrev = realPurchases.filter((p) => inPrevious(p.createdAt));
    const recRepPrev = unreconciledRepairs.filter((r) => inPrevious(r.createdAt));

    // Financial aggregates
    const recRepairAmount = recRepFiltered.reduce((s, r) => s + r.amount, 0);
    const repairIncome = rFiltered.reduce((s, r) => s + Number(r.price || 0), 0) + recRepairAmount;
    const repairPaid =
      rFiltered.reduce(
        (s, r) => s + Math.min(Number(r.price || 0) || Number(r.deposit || 0), Number(r.deposit || 0)),
        0
      ) + recRepairAmount;
    const salesIncome = sFiltered.reduce((s, x) => s + Number(x.amount || 0), 0);
    const salesPaid = sFiltered.reduce((s, x) => s + parseSalePaymentInfo(x).deposit, 0);

    const totalRevenue = repairIncome + salesIncome;
    const totalCollected = repairPaid + salesPaid;
    const totalPending = Math.max(0, totalRevenue - totalCollected);
    const collectionRate = totalRevenue > 0 ? Math.round((totalCollected / totalRevenue) * 100) : 0;
    const totalPurchases = pFiltered.reduce((s, p) => s + Number(p.amount || 0), 0);
    const netResult = totalRevenue - totalPurchases;
    const marginPct = totalRevenue > 0 ? Math.round((netResult / totalRevenue) * 100) : 0;
    const avgTicket = rFiltered.length > 0 ? repairIncome / rFiltered.length : 0;

    // Previous period comparison
    const prevRepairIncome =
      rPrev.reduce((s, r) => s + Number(r.price || 0), 0) +
      recRepPrev.reduce((s, r) => s + r.amount, 0);
    const prevSalesIncome = sPrev.reduce((s, x) => s + Number(x.amount || 0), 0);
    const prevRevenue = prevRepairIncome + prevSalesIncome;
    const prevPurchases = pPrev.reduce((s, p) => s + Number(p.amount || 0), 0);
    const prevNet = prevRevenue - prevPurchases;

    const revenueDelta = prevStartMs !== null ? computeDelta(totalRevenue, prevRevenue) : null;
    const netDelta = prevStartMs !== null ? computeDelta(netResult, prevNet) : null;
    const ordersDelta = prevStartMs !== null ? computeDelta(rFiltered.length, rPrev.length) : null;

    // Workshop operation counts
    const active = rFiltered.filter((r) => isActiveRepairStatus(r.status)).length;
    const ready = rFiltered.filter((r) => r.status === 'listo').length;
    const delivered = rFiltered.filter((r) => r.status === 'entregado').length;
    const completionRate =
      rFiltered.length > 0 ? Math.round(((delivered + ready) / rFiltered.length) * 100) : 0;

    // Status funnel counts
    const funnelCounts = FUNNEL_ORDER.map((status) => {
      const count = rFiltered.filter((r) => (r.status || 'recibido') === status).length;
      const meta = STATUS_META[status];
      return {
        status,
        label: meta.label,
        barClass: meta.barClass,
        count,
        pct: rFiltered.length > 0 ? Math.round((count / rFiltered.length) * 100) : 0,
      };
    });

    // Payment methods breakdown (collected money from repairs + sales)
    const payTotals: Record<'efectivo' | 'transferencia' | 'tarjeta' | 'sin_metodo', number> = {
      efectivo: 0,
      transferencia: 0,
      tarjeta: 0,
      sin_metodo: 0,
    };
    let mpPointTotal = 0;
    let mpQrTotal = 0;
    rFiltered.forEach((r) => {
      const collected = Math.min(Number(r.price || 0) || Number(r.deposit || 0), Number(r.deposit || 0));
      if (collected <= 0) return;
      const ledger = parseRepairPaymentLedger(r.checkoutState);
      if (ledger.length > 0) {
        let allocated = 0;
        for (const entry of ledger) {
          if (allocated >= collected) break;
          const take = Math.min(collected - allocated, Math.max(0, Number(entry.amount || 0)));
          if (take > 0) {
            payTotals[entry.method] += take;
            if (entry.mpChannel === 'mp_point') mpPointTotal += take;
            else if (entry.mpChannel === 'mp_qr') mpQrTotal += take;
            allocated += take;
          }
        }
        const remainder = Math.round((collected - allocated) * 100) / 100;
        if (remainder > 0.01) {
          const fallbackMethod = parsePaymentInfo(r).method;
          if (fallbackMethod) payTotals[fallbackMethod] += remainder;
          else payTotals.sin_metodo += remainder;
        }
      } else {
        const method = parsePaymentInfo(r).method;
        if (method) payTotals[method] += collected;
        else payTotals.sin_metodo += collected;
      }
    });
    recRepFiltered.forEach((rec) => {
      payTotals[rec.method] += rec.amount;
      if (rec.mpChannel === 'mp_point') mpPointTotal += rec.amount;
      else if (rec.mpChannel === 'mp_qr') mpQrTotal += rec.amount;
    });
    sFiltered.forEach((s) => {
      const info = parseSalePaymentInfo(s);
      if (info.deposit <= 0) return;
      const details = parseSaleDetails(s);
      if (details.mpChannel === 'mp_point') mpPointTotal += info.deposit;
      else if (details.mpChannel === 'mp_qr') mpQrTotal += info.deposit;
      if (details.payments.length > 0) {
        let allocated = 0;
        for (const entry of details.payments) {
          if (allocated >= info.deposit) break;
          const take = Math.min(info.deposit - allocated, Math.max(0, Number(entry.amount || 0)));
          if (take > 0) {
            payTotals[entry.method] += take;
            allocated += take;
          }
        }
        const remainder = Math.round((info.deposit - allocated) * 100) / 100;
        if (remainder > 0.01) {
          if (info.method) payTotals[info.method] += remainder;
          else payTotals.sin_metodo += remainder;
        }
      } else {
        if (info.method) payTotals[info.method] += info.deposit;
        else payTotals.sin_metodo += info.deposit;
      }
    });

    const paymentBreakdown = [
      {
        id: 'efectivo',
        label: 'Efectivo',
        amount: payTotals.efectivo,
        barClass: 'bg-emerald-500 dark:bg-emerald-400',
        dotClass: 'bg-emerald-500',
        subLabel: '',
      },
      {
        id: 'transferencia',
        label: 'Transferencia / QR',
        amount: payTotals.transferencia,
        barClass: 'bg-sky-500 dark:bg-sky-400',
        dotClass: 'bg-sky-500',
        subLabel: mpQrTotal > 0 ? `MP QR: ${formatCurrency(mpQrTotal)}` : '',
      },
      {
        id: 'tarjeta',
        label: 'Tarjeta / Point',
        amount: payTotals.tarjeta,
        barClass: 'bg-violet-500 dark:bg-violet-400',
        dotClass: 'bg-violet-500',
        subLabel: mpPointTotal > 0 ? `MP Point: ${formatCurrency(mpPointTotal)}` : '',
      },
      {
        id: 'sin_metodo',
        label: 'Seña / otro',
        amount: payTotals.sin_metodo,
        barClass: 'bg-slate-400 dark:bg-slate-500',
        dotClass: 'bg-slate-400',
        subLabel: '',
      },
    ].filter((item) => item.amount > 0 || totalCollected === 0);

    // Device types & top brands
    const deviceMap = new Map<string, { label: string; count: number; total: number }>();
    const brandMap = new Map<string, { label: string; count: number; total: number }>();
    rFiltered.forEach((r) => {
      const dName = (r.deviceType || 'Otros').trim();
      const dPrev = deviceMap.get(dName.toLowerCase()) || { label: dName, count: 0, total: 0 };
      dPrev.count += 1;
      dPrev.total += Number(r.price || 0);
      deviceMap.set(dName.toLowerCase(), dPrev);

      const bName = (r.brand || 'Sin marca').trim();
      const bPrev = brandMap.get(bName.toLowerCase()) || { label: bName, count: 0, total: 0 };
      bPrev.count += 1;
      bPrev.total += Number(r.price || 0);
      brandMap.set(bName.toLowerCase(), bPrev);
    });
    const topDevices = Array.from(deviceMap.values())
      .sort((a, b) => b.count - a.count || b.total - a.total)
      .slice(0, 5);
    const topBrands = Array.from(brandMap.values())
      .sort((a, b) => b.count - a.count || b.total - a.total)
      .slice(0, 5);

    // Top clients & active period clients
    const byClient = new Map<string, { name: string; total: number; count: number }>();
    rFiltered.forEach((r) => {
      const key = r.clientName.trim().toLowerCase();
      if (!key) return;
      const prev = byClient.get(key) || { name: r.clientName, total: 0, count: 0 };
      prev.total += Number(r.price || 0);
      prev.count += 1;
      byClient.set(key, prev);
    });
    sFiltered.forEach((s) => {
      const key = s.clientName.trim().toLowerCase();
      if (!key) return;
      const prev = byClient.get(key) || { name: s.clientName, total: 0, count: 0 };
      prev.total += Number(s.amount || 0);
      prev.count += 1;
      byClient.set(key, prev);
    });
    const activeClientsCount = byClient.size;
    const topClients = Array.from(byClient.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Inventory valuation & critical stock (out-of-stock first)
    const outOfStock = products.filter((p) => p.trackStock && p.stock <= 0);
    const lowStockOnly = products.filter((p) => p.trackStock && p.stock > 0 && p.stock <= p.minStock);
    const criticalStock = [...outOfStock, ...lowStockOnly].sort((a, b) => a.stock - b.stock);
    const stockCostValue = products.reduce(
      (s, p) => s + Math.max(0, Number(p.stock || 0)) * Math.max(0, Number(p.cost || 0)),
      0
    );
    const stockRetailValue = products.reduce(
      (s, p) => s + Math.max(0, Number(p.stock || 0)) * Math.max(0, Number(p.price || 0)),
      0
    );

    // Technician leaderboard
    const techMap = new Map<
      string,
      { name: string; count: number; delivered: number; total: number }
    >();
    rFiltered.forEach((r) => {
      const tech = parsePaymentInfo(r).technician;
      if (!tech) return;
      const key = tech.toLowerCase();
      const prev = techMap.get(key) || { name: tech, count: 0, delivered: 0, total: 0 };
      prev.count += 1;
      if (r.status === 'entregado') prev.delivered += 1;
      prev.total += Number(r.price || 0);
      techMap.set(key, prev);
    });
    const byTechnician = Array.from(techMap.values()).sort((a, b) => b.total - a.total);

    // Temporal chart buckets
    const allCurrentTimestamps = [
      ...rFiltered.map((r) => r.createdAt),
      ...sFiltered.map((s) => s.createdAt),
      ...pFiltered.map((p) => p.createdAt),
    ];
    const effectiveStart =
      range === 'all'
        ? allCurrentTimestamps.length > 0
          ? startOfLocalDay(Math.min(...allCurrentTimestamps))
          : startOfLocalDay(endMs - 29 * 24 * 60 * 60 * 1000)
        : startMs;
    const spanDays = Math.max(1, Math.ceil((endMs - effectiveStart) / (24 * 60 * 60 * 1000)));

    const bucketsMap = new Map<string, TimelineBucket>();
    const orderedKeys: string[] = [];

    const ensureBucket = (key: string, label: string, fullLabel: string) => {
      let existing = bucketsMap.get(key);
      if (!existing) {
        existing = {
          key,
          label,
          fullLabel,
          repairsRevenue: 0,
          salesRevenue: 0,
          purchasesExpense: 0,
          ordersCount: 0,
        };
        bucketsMap.set(key, existing);
        orderedKeys.push(key);
      }
      return existing;
    };

    const getBucketMeta = (ts: number): { key: string; label: string; fullLabel: string } => {
      const d = new Date(ts);
      if (range === 'today') {
        const block = Math.floor(d.getHours() / 3) * 3;
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${block}`;
        const label = `${String(block).padStart(2, '0')}h`;
        const fullLabel = `${String(block).padStart(2, '0')}:00 – ${String(block + 2).padStart(
          2,
          '0'
        )}:59`;
        return { key, label, fullLabel };
      }
      if (spanDays <= 35) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate()
        ).padStart(2, '0')}`;
        const label = `${d.getDate()}/${d.getMonth() + 1}`;
        const fullLabel = new Intl.DateTimeFormat(locale, {
          day: '2-digit',
          month: 'short',
        }).format(d);
        return { key, label, fullLabel };
      }
      if (spanDays <= 150) {
        const dayStart = new Date(d);
        dayStart.setHours(0, 0, 0, 0);
        const dayOfWeek = (dayStart.getDay() + 6) % 7;
        dayStart.setDate(dayStart.getDate() - dayOfWeek);
        const key = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(
          2,
          '0'
        )}-${String(dayStart.getDate()).padStart(2, '0')}`;
        const label = `S ${dayStart.getDate()}/${dayStart.getMonth() + 1}`;
        const fullLabel = `${tr('Semana del', 'Week of', 'Semana de')} ${dayStart.getDate()}/${dayStart.getMonth() + 1}`;
        return { key, label, fullLabel };
      }
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = new Intl.DateTimeFormat(locale, { month: 'short' })
        .format(d)
        .replace('.', '');
      const fullLabel = new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(d);
      return { key, label, fullLabel };
    };

    // Pre-seed timeline slots so empty days/weeks show cleanly in time series
    if (range === 'today') {
      const nowHour = new Date(endMs).getHours();
      for (let h = 0; h <= Math.max(nowHour, 18); h += 3) {
        const probe = new Date(effectiveStart);
        probe.setHours(h, 0, 0, 0);
        const meta = getBucketMeta(probe.getTime());
        ensureBucket(meta.key, meta.label, meta.fullLabel);
      }
    } else if (spanDays <= 35) {
      for (let t = startOfLocalDay(effectiveStart); t <= endMs; t += 24 * 60 * 60 * 1000) {
        const meta = getBucketMeta(t);
        ensureBucket(meta.key, meta.label, meta.fullLabel);
      }
    } else if (spanDays <= 150) {
      for (let t = startOfLocalDay(effectiveStart); t <= endMs; t += 7 * 24 * 60 * 60 * 1000) {
        const meta = getBucketMeta(t);
        ensureBucket(meta.key, meta.label, meta.fullLabel);
      }
    }

    rFiltered.forEach((r) => {
      const meta = getBucketMeta(r.createdAt);
      const b = ensureBucket(meta.key, meta.label, meta.fullLabel);
      b.repairsRevenue += Number(r.price || 0);
      b.ordersCount += 1;
    });
    sFiltered.forEach((s) => {
      const meta = getBucketMeta(s.createdAt);
      const b = ensureBucket(meta.key, meta.label, meta.fullLabel);
      b.salesRevenue += Number(s.amount || 0);
    });
    pFiltered.forEach((p) => {
      const meta = getBucketMeta(p.createdAt);
      const b = ensureBucket(meta.key, meta.label, meta.fullLabel);
      b.purchasesExpense += Number(p.amount || 0);
    });

    const timeline = orderedKeys
      .map((k) => bucketsMap.get(k)!)
      .slice(-24);

    const maxTimelineValue = Math.max(
      1,
      ...timeline.map((b) => Math.max(b.repairsRevenue + b.salesRevenue, b.purchasesExpense))
    );

    // Detailed history of paid Transferencia, Tarjeta, Point MP & QR (including Mercado Pago Point name)
    const electronicHistory: ElectronicHistoryItem[] = [];
    const seenOriginRecordIds = new Set<string>();
    const seenMpPaymentIds = new Set<string>();
    const seenMpOrderIds = new Set<string>();
    const seenExtRefs = new Set<string>();

    const registerDedupeIds = (opts: {
      originRecordId?: string;
      mpPaymentId?: string;
      mpOrderId?: string;
      mpExternalReference?: string;
    }) => {
      if (opts.originRecordId) seenOriginRecordIds.add(opts.originRecordId);
      if (opts.mpPaymentId) seenMpPaymentIds.add(opts.mpPaymentId);
      if (opts.mpOrderId) seenMpOrderIds.add(opts.mpOrderId);
      const norm = normalizeMpRef(opts.mpExternalReference);
      if (norm) seenExtRefs.add(norm);
    };

    repairs.forEach((r) => {
      const ledger = parseRepairPaymentLedger(r.checkoutState);
      const repairInfo = parsePaymentInfo(r);
      const deviceDesc = `${r.brand || ''} ${r.model || ''}`.trim() || r.deviceType;
      if (ledger.length > 0) {
        ledger.forEach((entry, idx) => {
          const isElec =
            entry.method === 'transferencia' ||
            entry.method === 'tarjeta' ||
            Boolean(entry.mpChannel);
          if (!isElec || Number(entry.amount || 0) <= 0) return;
          const entryTs = toMsSafe(entry.date, r.createdAt);
          const originRecordId = `rep_${r.id}_${entry.id || idx}`;
          registerDedupeIds({
            originRecordId,
            mpOrderId: entry.mpOrderId,
            mpExternalReference: entry.mpExternalReference,
          });
          if (!inCurrent(entryTs)) return;
          const ch: ElectronicChannelType =
            entry.mpChannel === 'mp_point'
              ? 'mp_point'
              : entry.mpChannel === 'mp_qr'
                ? 'mp_qr'
                : entry.note?.toLowerCase().includes('point')
                  ? 'mp_point'
                  : entry.note?.toLowerCase().includes('qr')
                    ? 'mp_qr'
                    : entry.method === 'tarjeta'
                      ? 'tarjeta'
                      : 'transferencia';
          const pointName =
            entry.mpPointName ||
            (ch === 'mp_point' || ch === 'mp_qr' ? defaultMpPointName : '');
          electronicHistory.push({
            id: originRecordId,
            createdAt: entryTs,
            dateLabel: formatDateShort(new Date(entryTs).toISOString().slice(0, 10)),
            originLabel: 'Reparación',
            counterparty: r.clientName || 'Cliente',
            concept: [deviceDesc, entry.note].filter(Boolean).join(' · ') || 'Reparación',
            channel: ch,
            channelLabel: ELECTRONIC_CHANNEL_LABELS[ch],
            mpPointName: pointName,
            reference: entry.mpExternalReference || r.code || '—',
            amount: Number(entry.amount || 0),
            isOutflow: false,
          });
        });
      } else {
        const collected = Math.min(
          Number(r.price || 0) || Number(r.deposit || 0),
          Number(r.deposit || 0)
        );
        if (
          collected > 0 &&
          (repairInfo.method === 'transferencia' || repairInfo.method === 'tarjeta')
        ) {
          const originRecordId = `rep_${r.id}_main`;
          registerDedupeIds({ originRecordId });
          if (inCurrent(r.createdAt)) {
            const ch: ElectronicChannelType =
              repairInfo.method === 'tarjeta' ? 'tarjeta' : 'transferencia';
            electronicHistory.push({
              id: originRecordId,
              createdAt: r.createdAt,
              dateLabel: formatDateShort(r.dateIn),
              originLabel: 'Reparación',
              counterparty: r.clientName || 'Cliente',
              concept: `${deviceDesc} · Cobro reparación`,
              channel: ch,
              channelLabel: ELECTRONIC_CHANNEL_LABELS[ch],
              mpPointName: '',
              reference: r.code || '—',
              amount: collected,
              isOutflow: false,
            });
          }
        }
      }
    });

    effectiveSales.forEach((s) => {
      const info = parseSalePaymentInfo(s);
      const details = parseSaleDetails(s);
      registerDedupeIds({
        mpOrderId: details.mpOrderId,
        mpPaymentId: details.mpPaymentId,
        mpExternalReference: details.mpExternalReference,
      });
      if (details.payments.length > 0) {
        details.payments.forEach((pay, idx) => {
          const isElec =
            pay.method === 'transferencia' ||
            pay.method === 'tarjeta' ||
            Boolean(details.mpChannel);
          if (!isElec || Number(pay.amount || 0) <= 0) return;
          const payTs = toMsSafe(pay.date, s.createdAt);
          const originRecordId = `sale_${s.id}_${pay.id || idx}`;
          registerDedupeIds({ originRecordId });
          if (!inCurrent(payTs)) return;
          const ch: ElectronicChannelType =
            details.mpChannel === 'mp_point'
              ? 'mp_point'
              : details.mpChannel === 'mp_qr'
                ? 'mp_qr'
                : pay.note?.toLowerCase().includes('point')
                  ? 'mp_point'
                  : pay.note?.toLowerCase().includes('qr')
                    ? 'mp_qr'
                    : pay.method === 'tarjeta'
                      ? 'tarjeta'
                      : 'transferencia';
          const pointName =
            details.mpPointName ||
            (ch === 'mp_point' || ch === 'mp_qr' ? defaultMpPointName : '');
          electronicHistory.push({
            id: originRecordId,
            createdAt: payTs,
            dateLabel: formatDateShort(s.dueDate),
            originLabel: s.id.startsWith('rec_') ? 'Mercado Pago' : 'Venta',
            counterparty: s.clientName || 'Mostrador',
            concept: [s.productName, pay.note].filter(Boolean).join(' · ') || 'Venta mostrador',
            channel: ch,
            channelLabel: ELECTRONIC_CHANNEL_LABELS[ch],
            mpPointName: pointName,
            reference: details.mpExternalReference || s.invoice || '—',
            amount: Number(pay.amount || 0),
            isOutflow: false,
          });
        });
      } else if (
        info.deposit > 0 &&
        (info.method === 'transferencia' ||
          info.method === 'tarjeta' ||
          Boolean(details.mpChannel))
      ) {
        const originRecordId = `sale_${s.id}_main`;
        registerDedupeIds({ originRecordId });
        if (inCurrent(s.createdAt)) {
          const ch: ElectronicChannelType =
            details.mpChannel === 'mp_point'
              ? 'mp_point'
              : details.mpChannel === 'mp_qr'
                ? 'mp_qr'
                : info.method === 'tarjeta'
                  ? 'tarjeta'
                  : 'transferencia';
          const pointName =
            details.mpPointName ||
            (ch === 'mp_point' || ch === 'mp_qr' ? defaultMpPointName : '');
          electronicHistory.push({
            id: originRecordId,
            createdAt: s.createdAt,
            dateLabel: formatDateShort(s.dueDate),
            originLabel: s.id.startsWith('rec_') ? 'Mercado Pago' : 'Venta',
            counterparty: s.clientName || 'Mostrador',
            concept: s.productName || 'Venta de mostrador',
            channel: ch,
            channelLabel: ELECTRONIC_CHANNEL_LABELS[ch],
            mpPointName: pointName,
            reference: details.mpExternalReference || s.invoice || '—',
            amount: info.deposit,
            isOutflow: false,
          });
        }
      }
    });

    unreconciledRepairs.forEach((rec) => {
      const isElec =
        rec.method === 'transferencia' ||
        rec.method === 'tarjeta' ||
        Boolean(rec.mpChannel);
      if (!isElec || rec.amount <= 0) return;
      registerDedupeIds({
        mpOrderId: rec.mpOrderId,
        mpPaymentId: rec.mpPaymentId,
        mpExternalReference: rec.mpExternalReference,
      });
      if (!inCurrent(rec.createdAt)) return;
      const ch: ElectronicChannelType =
        rec.mpChannel === 'mp_point'
          ? 'mp_point'
          : rec.mpChannel === 'mp_qr'
            ? 'mp_qr'
            : rec.method === 'tarjeta'
              ? 'tarjeta'
              : 'transferencia';
      electronicHistory.push({
        id: `rec_${rec.id}`,
        createdAt: rec.createdAt,
        dateLabel: formatDateShort(rec.at.slice(0, 10)),
        originLabel: 'Reparación',
        counterparty: rec.clientName || 'Cliente',
        concept: [rec.title, rec.subtitle].filter(Boolean).join(' · ') || 'Cobro MP',
        channel: ch,
        channelLabel: ELECTRONIC_CHANNEL_LABELS[ch],
        mpPointName:
          rec.mpPointName ||
          (ch === 'mp_point' || ch === 'mp_qr' ? defaultMpPointName : ''),
        reference: rec.mpExternalReference || rec.invoice || '—',
        amount: rec.amount,
        isOutflow: false,
      });
    });

    purchases.forEach((p) => {
      const info = parsePurchaseInfo(p);
      if (!info.isPaid || Number(p.amount || 0) <= 0) return;
      const isElec =
        info.mpChannel === 'mp_point' ||
        info.mpChannel === 'mp_qr' ||
        info.paymentMethod === 'transferencia' ||
        info.paymentMethod === 'tarjeta';
      if (!isElec) return;
      const mirrored = isMirroredIncomePurchase(info);
      if (mirrored) {
        const normExt = normalizeMpRef(info.mpExternalReference);
        if (
          (info.originRecordId && seenOriginRecordIds.has(info.originRecordId)) ||
          (info.mpPaymentId && seenMpPaymentIds.has(info.mpPaymentId)) ||
          (info.mpOrderId && seenMpOrderIds.has(info.mpOrderId)) ||
          (normExt && seenExtRefs.has(normExt))
        ) {
          return;
        }
      }
      if (!inCurrent(p.createdAt)) return;
      const ch: ElectronicChannelType =
        info.mpChannel === 'mp_point'
          ? 'mp_point'
          : info.mpChannel === 'mp_qr'
            ? 'mp_qr'
            : info.paymentMethod === 'tarjeta'
              ? 'tarjeta'
              : 'transferencia';
      const pointName =
        info.mpPointName ||
        (ch === 'mp_point' || ch === 'mp_qr' ? defaultMpPointName : '');
      electronicHistory.push({
        id: `pur_${p.id}`,
        createdAt: p.createdAt,
        dateLabel: formatDateShort(p.dueDate),
        originLabel: PURCHASE_ORIGIN_LABELS[info.originType],
        counterparty: p.supplierName || 'Cuenta',
        concept: info.note || p.invoice || 'Operación',
        channel: ch,
        channelLabel: ELECTRONIC_CHANNEL_LABELS[ch],
        mpPointName: pointName,
        reference: info.mpExternalReference || p.invoice || '—',
        amount: Number(p.amount || 0),
        isOutflow: !mirrored,
      });
    });

    electronicHistory.sort((a, b) => b.createdAt - a.createdAt);

    return {
      rFiltered,
      sFiltered,
      pFiltered,
      total: rFiltered.length,
      active,
      ready,
      delivered,
      completionRate,
      repairIncome,
      salesIncome,
      totalRevenue,
      totalCollected,
      collectionRate,
      totalPending,
      avgTicket,
      totalPurchases,
      netResult,
      marginPct,
      revenueDelta,
      netDelta,
      ordersDelta,
      funnelCounts,
      paymentBreakdown,
      topDevices,
      topBrands,
      activeClientsCount,
      topClients,
      outOfStockCount: outOfStock.length,
      lowStockOnlyCount: lowStockOnly.length,
      criticalStock,
      stockCostValue,
      stockRetailValue,
      byTechnician,
      timeline,
      maxTimelineValue,
      electronicHistory,
    };
  }, [
    products,
    purchases,
    range,
    repairs,
    effectiveSales,
    unreconciledRecovered,
    windowBounds,
    locale,
    tr,
    defaultMpPointName,
  ]);

  const selectedBucket =
    activeBucketIndex !== null
      ? report.timeline[activeBucketIndex] ?? null
      : report.timeline[report.timeline.length - 1] ?? null;

  const handleExportSalesPdf = async () => {
    setPdfMenuOpen(false);
    try {
      const { downloadSalesSummaryPdf } = await import('../utils/pdfReport');
      downloadSalesSummaryPdf({
        profile,
        rangeLabel: windowBounds.pdfLabel,
        repairs: report.rFiltered,
        sales: report.sFiltered,
        purchases: report.pFiltered,
      });
      notify('Resumen de ventas descargado en PDF.');
    } catch {
      notify('No se pudo generar el PDF de ventas.', 'error');
    }
  };

  const handleExportInventoryPdf = async () => {
    setPdfMenuOpen(false);
    try {
      const { downloadInventorySummaryPdf } = await import('../utils/pdfReport');
      downloadInventorySummaryPdf({
        profile,
        products,
      });
      notify('Resumen de inventario descargado en PDF.');
    } catch {
      notify('No se pudo generar el PDF de inventario.', 'error');
    }
  };

  const renderDeltaText = (
    delta: { pct: number; direction: 'up' | 'down' | 'flat' } | null,
    invertColors = false
  ) => {
    if (!delta || !windowBounds.compareLabel) return null;
    if (delta.direction === 'flat') {
      return (
        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
          Sin cambios {windowBounds.compareLabel}
        </span>
      );
    }
    const isPositiveColor = invertColors ? delta.direction === 'down' : delta.direction === 'up';
    const Icon = delta.direction === 'up' ? ArrowUpRight : ArrowDownRight;
    return (
      <span
        className={`inline-flex max-w-full flex-wrap items-center gap-0.5 font-mono-num text-[11px] font-semibold leading-snug ${
          isPositiveColor
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span className="break-words">
          {delta.direction === 'up' ? '+' : '-'}
          {delta.pct}% {windowBounds.compareLabel}
        </span>
      </span>
    );
  };

  const filteredElectronicHistory = useMemo(() => {
    const q = electronicQuery.trim().toLowerCase();
    return report.electronicHistory.filter((item) => {
      if (electronicFilter !== 'all' && item.channel !== electronicFilter) return false;
      if (q) {
        const hay = [
          item.counterparty,
          item.concept,
          item.originLabel,
          item.channelLabel,
          item.mpPointName,
          item.reference,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [report.electronicHistory, electronicFilter, electronicQuery]);

  const electronicChannelTotals = useMemo(() => {
    const totals: Record<ElectronicChannelType, number> = {
      mp_point: 0,
      mp_qr: 0,
      transferencia: 0,
      tarjeta: 0,
    };
    for (const item of report.electronicHistory) {
      totals[item.channel] += item.amount;
    }
    return totals;
  }, [report.electronicHistory]);

  const handleExportElectronicCsv = () => {
    if (filteredElectronicHistory.length === 0) {
      notify('No hay movimientos electrónicos para exportar con el filtro actual.', 'error');
      return;
    }
    const headers = [
      'Fecha',
      'Origen',
      'Cliente / Proveedor',
      'Canal / Medio',
      'Nombre Point Mercado Pago',
      'Comprobante / Ref.',
      'Detalle',
      'Tipo',
      'Monto',
    ];
    const rows = filteredElectronicHistory.map((item) => [
      item.dateLabel,
      item.originLabel,
      item.counterparty,
      item.channelLabel,
      item.mpPointName || '—',
      item.reference,
      item.concept,
      item.isOutflow ? 'Compra / Gasto' : 'Cobro',
      item.amount,
    ]);
    downloadCsvFile(`historial-transferencias-point-qr-${todayISO()}.csv`, headers, rows);
    notify(`Exportados ${filteredElectronicHistory.length} pagos electrónicos a CSV.`);
  };

  const maxClientTotal = Math.max(1, ...report.topClients.map((c) => c.total));
  const maxTechTotal = Math.max(1, ...report.byTechnician.map((t) => t.total));
  const maxDeviceCount = Math.max(1, ...report.topDevices.map((d) => d.count));
  const maxBrandCount = Math.max(1, ...report.topBrands.map((b) => b.count));

  return (
    <div className="space-y-6">
      {/* Header & Temporal Range Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            {tr('Reportes y Analítica', 'Reports & Analytics', 'Relatórios e Análises')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'Evolución temporal, rentabilidad financiera, rendimiento operativo y estado del stock',
              'Time evolution, profitability, operational performance and inventory status',
              'Evolução temporal, lucratividade, desempenho operacional e status do estoque'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/90 p-1 dark:border-slate-800 dark:bg-slate-900">
            {RANGE_OPTIONS.map((btn) => {
              const translatedRangeLabel =
                btn.id === 'today'
                  ? tr('Hoy', 'Today', 'Hoje')
                  : btn.id === '7'
                    ? tr('7 días', '7 days', '7 dias')
                    : btn.id === 'month'
                      ? tr('Este mes', 'This month', 'Este mês')
                      : btn.id === '30'
                        ? tr('30 días', '30 days', '30 dias')
                        : btn.id === '90'
                          ? tr('90 días', '90 days', '90 dias')
                          : btn.id === 'custom'
                            ? tr('Personalizado', 'Custom', 'Personalizado')
                            : tr('Histórico', 'All time', 'Histórico');
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setRange(btn.id)}
                  className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                    range === btn.id
                      ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {translatedRangeLabel}
                </button>
              );
            })}
          </div>

          <div ref={pdfMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setPdfMenuOpen((prev) => !prev)}
              aria-expanded={pdfMenuOpen}
              aria-haspopup="menu"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c] whitespace-nowrap shrink-0"
            >
              <FileDown className="h-4 w-4" />
              <span>{tr('Exportar PDF', 'Export PDF', 'Exportar PDF')}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-80" />
            </button>

            {pdfMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportSalesPdf}
                  className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-[#0072BB] dark:text-sky-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      {tr('Resumen de ventas (PDF)', 'Sales summary (PDF)', 'Resumo de vendas (PDF)')}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr(
                        'Ingresos, órdenes y ventas del período',
                        'Income, orders and sales for the period',
                        'Receitas, ordens e vendas do período'
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportInventoryPdf}
                  className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Resumen de inventario (PDF)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Stock actual, alertas y valorización
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {range === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200/80 bg-sky-50/50 px-4 py-3 dark:border-sky-900/50 dark:bg-sky-950/20">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-900 dark:text-sky-200">
            <CalendarRange className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
            <span>Rango personalizado:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="text-slate-600 dark:text-slate-300" htmlFor="rep-from-date">
              Desde
            </label>
            <input
              id="rep-from-date"
              type="date"
              value={customFrom}
              max={todayISO()}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <label className="text-slate-600 dark:text-slate-300" htmlFor="rep-to-date">
              Hasta
            </label>
            <input
              id="rep-to-date"
              type="date"
              value={customTo}
              max={todayISO()}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
        </div>
      )}

      {/* Block 1: Finanzas y Rentabilidad */}
      <section aria-label="Finanzas y rentabilidad" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            <DollarSign className="h-3.5 w-3.5" />
            <span>Finanzas y rentabilidad</span>
          </h2>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {windowBounds.pdfLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {/* Ingreso Bruto */}
          {(() => {
            const val = formatCompactCurrency(report.totalRevenue);
            return (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  <span className="truncate">Ingreso bruto</span>
                  <TrendingUp className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div
                  title={val}
                  className={`mt-2 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                    val,
                    'primary'
                  )}`}
                >
                  {val}
                </div>
                <div className="mt-1.5 flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-mono-num text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                    Taller {formatCompactCurrency(report.repairIncome)} · Ventas{' '}
                    {formatCompactCurrency(report.salesIncome)}
                  </span>
                  {renderDeltaText(report.revenueDelta)}
                </div>
              </div>
            );
          })()}

          {/* Cobrado Real */}
          {(() => {
            const val = formatCompactCurrency(report.totalCollected);
            return (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-teal-200/80 bg-teal-50/40 p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-teal-800 dark:text-teal-300">
                  <span className="truncate">Cobrado real</span>
                  <Wallet className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                </div>
                <div
                  title={val}
                  className={`mt-2 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                    val,
                    'primary'
                  )}`}
                >
                  {val}
                </div>
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-teal-200/70 dark:bg-teal-950">
                    <div
                      className="h-full rounded-full bg-teal-600 transition-all dark:bg-teal-400"
                      style={{ width: `${Math.min(100, report.collectionRate)}%` }}
                    />
                  </div>
                  <div className="truncate font-mono-num text-[11px] text-teal-700 dark:text-teal-300">
                    {report.collectionRate}% recaudado del total
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Por Cobrar */}
          {(() => {
            const val = formatCompactCurrency(report.totalPending);
            return (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <span className="truncate">Saldo por cobrar</span>
                  <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                </div>
                <div
                  title={val}
                  className={`mt-2 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                    val,
                    'primary'
                  )}`}
                >
                  {val}
                </div>
                <div className="mt-1.5 text-[11px] leading-snug text-amber-800/80 dark:text-amber-300/80">
                  {report.totalPending > 0
                    ? 'Pendiente entre señas y ventas'
                    : 'Todo el período está saldado'}
                </div>
              </div>
            );
          })()}

          {/* Compras / Egresos */}
          {(() => {
            const val = formatCompactCurrency(report.totalPurchases);
            return (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-rose-800 dark:text-rose-300">
                  <span className="truncate">Compras / Egresos</span>
                  <CreditCard className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                </div>
                <div
                  title={val}
                  className={`mt-2 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                    val,
                    'primary'
                  )}`}
                >
                  {val}
                </div>
                <div className="mt-1.5 truncate font-mono-num text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                  {report.pFiltered.length}{' '}
                  {report.pFiltered.length === 1 ? 'compra a proveedor' : 'compras a proveedores'}
                </div>
              </div>
            );
          })()}

          {/* Resultado Neto */}
          {(() => {
            const val = formatCompactCurrency(report.netResult);
            return (
              <div
                className={`min-w-0 overflow-hidden rounded-2xl border p-4 md:col-span-2 xl:col-span-1 ${
                  report.netResult >= 0
                    ? 'border-emerald-300/80 bg-white dark:border-emerald-800/70 dark:bg-slate-900'
                    : 'border-rose-300/80 bg-white dark:border-rose-800/70 dark:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span className="truncate">Resultado neto</span>
                  <span
                    className={`shrink-0 font-mono-num text-[11px] font-bold ${
                      report.netResult >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    Margen {report.marginPct}%
                  </span>
                </div>
                <div
                  title={val}
                  className={`mt-2 max-w-full truncate font-mono-num font-bold tracking-tight ${getMetricNumberClass(
                    val,
                    'primary'
                  )} ${
                    report.netResult >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {val}
                </div>
                <div className="mt-1.5 min-w-0">{renderDeltaText(report.netDelta)}</div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* Block 2: Operación del Taller + Clientes y Stock */}
      <div className="space-y-6">
        <section aria-label="Operación del taller" className="space-y-2.5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0072BB] dark:text-sky-400">
            <Wrench className="h-3.5 w-3.5" />
            <span>Operación del taller</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {(() => {
              const val = String(report.total);
              return (
                <div className="min-w-0 overflow-hidden rounded-2xl border border-sky-200/80 bg-sky-50/40 p-3.5 sm:p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
                  <div className="truncate text-xs font-semibold text-sky-800 dark:text-sky-300">
                    Órdenes
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 min-w-0 leading-snug">{renderDeltaText(report.ordersDelta)}</div>
                </div>
              );
            })()}

            {(() => {
              const val = String(report.active);
              return (
                <div className="min-w-0 overflow-hidden rounded-2xl border border-indigo-200/80 bg-indigo-50/40 p-3.5 sm:p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                  <div className="truncate text-xs font-semibold text-indigo-800 dark:text-indigo-300">
                    En curso
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    En banco
                  </div>
                </div>
              );
            })()}

            {(() => {
              const val = String(report.ready);
              return (
                <div className="min-w-0 overflow-hidden rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-3.5 sm:p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <div className="truncate text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    Listas
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    Para retirar
                  </div>
                </div>
              );
            })()}

            {(() => {
              const val = String(report.delivered);
              return (
                <div className="min-w-0 overflow-hidden rounded-2xl border border-teal-200/80 bg-teal-50/40 p-3.5 sm:p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
                  <div className="truncate text-xs font-semibold text-teal-800 dark:text-teal-300">
                    Entregadas
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 truncate font-mono-num text-[11px] leading-snug text-teal-700 dark:text-teal-300">
                    {report.completionRate}% listas/ent.
                  </div>
                </div>
              );
            })()}

            {(() => {
              const val = formatCompactCurrency(report.avgTicket);
              return (
                <div className="col-span-2 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 sm:col-span-2 sm:p-4 xl:col-span-1 dark:border-slate-800 dark:bg-slate-900">
                  <div className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Ticket prom.
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    Por orden
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        <section aria-label="Clientes y stock" className="space-y-2.5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400">
            <Users className="h-3.5 w-3.5" />
            <span>Clientes y capital en stock</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(() => {
              const val = String(report.activeClientsCount);
              return (
                <div className="min-w-0 overflow-hidden rounded-2xl border border-violet-200/80 bg-violet-50/40 p-3.5 sm:p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-violet-800 dark:text-violet-300">
                    <span className="truncate">Clientes</span>
                    <UserCheck className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 truncate font-mono-num text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    de {clients.length} totales
                  </div>
                </div>
              );
            })()}

            {(() => {
              const val = formatCompactCurrency(report.stockRetailValue);
              return (
                <div className="min-w-0 overflow-hidden rounded-2xl border border-cyan-200/80 bg-cyan-50/40 p-3.5 sm:p-4 dark:border-cyan-900/50 dark:bg-cyan-950/20">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-cyan-800 dark:text-cyan-300">
                    <span className="truncate">Capital stock</span>
                    <Boxes className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 truncate font-mono-num text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    Costo {formatCompactCurrency(report.stockCostValue)}
                  </div>
                </div>
              );
            })()}

            {(() => {
              const val = String(report.criticalStock.length);
              return (
                <div className="min-w-0 overflow-hidden rounded-2xl border border-rose-200/80 bg-rose-50/40 p-3.5 sm:p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-rose-800 dark:text-rose-300">
                    <span className="truncate">Alertas</span>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div
                    title={val}
                    className={`mt-1.5 max-w-full truncate font-mono-num font-bold tracking-tight text-slate-900 dark:text-white ${getMetricNumberClass(
                      val,
                      'compact'
                    )}`}
                  >
                    {val}
                  </div>
                  <div className="mt-1 truncate font-mono-num text-[11px] leading-snug text-rose-700 dark:text-rose-300">
                    {report.outOfStockCount} sin stock · {report.lowStockOnlyCount} bajo
                  </div>
                </div>
              );
            })()}
          </div>
        </section>
      </div>

      {/* 30-Day Repairs & Sales Revenue Trend (Recharts) */}
      <RevenueTrendChart repairs={repairs} sales={effectiveSales} />

      {/* Block 3: Evolución Temporal */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white font-display">
              <BarChart3 className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              <span>Evolución temporal de ingresos y egresos</span>
            </h2>
            {selectedBucket ? (
              <p className="mt-1 font-mono-num text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {selectedBucket.fullLabel}
                </span>
                {' · '}
                <span className="text-[#0072BB] dark:text-sky-400">
                  Reparaciones {formatCurrency(selectedBucket.repairsRevenue)}
                </span>
                {' · '}
                <span className="text-violet-600 dark:text-violet-400">
                  Ventas {formatCurrency(selectedBucket.salesRevenue)}
                </span>
                {' · '}
                <span className="text-rose-600 dark:text-rose-400">
                  Compras {formatCurrency(selectedBucket.purchasesExpense)}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Tocá o pasá el cursor sobre una barra para ver el detalle del período
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#0072BB] dark:bg-sky-500" />
              <span>Reparaciones</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-violet-500 dark:bg-violet-400" />
              <span>Ventas</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-rose-500 dark:bg-rose-400" />
              <span>Compras</span>
            </span>
          </div>
        </div>

        {report.timeline.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            No hay movimientos registrados en este rango temporal.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto pb-1">
            <div className="flex h-52 min-w-[480px] items-end gap-2 border-b border-slate-100 px-1 pb-2 dark:border-slate-800">
              {report.timeline.map((bucket, idx) => {
                const incomeTotal = bucket.repairsRevenue + bucket.salesRevenue;
                const incomeHeightPct = Math.round((incomeTotal / report.maxTimelineValue) * 100);
                const expenseHeightPct = Math.round(
                  (bucket.purchasesExpense / report.maxTimelineValue) * 100
                );
                const repairSharePct =
                  incomeTotal > 0 ? (bucket.repairsRevenue / incomeTotal) * 100 : 0;
                const salesSharePct =
                  incomeTotal > 0 ? (bucket.salesRevenue / incomeTotal) * 100 : 0;
                const isSelected =
                  activeBucketIndex === idx ||
                  (activeBucketIndex === null && idx === report.timeline.length - 1);

                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onMouseEnter={() => setActiveBucketIndex(idx)}
                    onFocus={() => setActiveBucketIndex(idx)}
                    onClick={() => setActiveBucketIndex(idx)}
                    aria-label={`${bucket.fullLabel}: ingresos ${formatCurrency(
                      incomeTotal
                    )}, compras ${formatCurrency(bucket.purchasesExpense)}`}
                    className={`group flex h-full flex-1 min-w-[26px] flex-col items-center justify-end gap-1.5 rounded-xl px-1 pt-2 transition ${
                      isSelected
                        ? 'bg-slate-100/80 dark:bg-slate-800/70'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex h-36 w-full items-end justify-center gap-1">
                      {/* Stacked Revenue Bar (Repairs + Sales) */}
                      <div
                        className="flex w-3.5 flex-col-reverse overflow-hidden rounded-t-md bg-slate-100 transition-all sm:w-4 dark:bg-slate-800"
                        style={{
                          height: `${incomeTotal > 0 ? Math.max(6, incomeHeightPct) : 2}%`,
                        }}
                      >
                        {bucket.repairsRevenue > 0 && (
                          <div
                            className="w-full bg-[#0072BB] dark:bg-sky-500"
                            style={{ height: `${repairSharePct}%` }}
                          />
                        )}
                        {bucket.salesRevenue > 0 && (
                          <div
                            className="w-full bg-violet-500 dark:bg-violet-400"
                            style={{ height: `${salesSharePct}%` }}
                          />
                        )}
                      </div>

                      {/* Expense Bar (Purchases) */}
                      <div
                        className="w-2 rounded-t-md bg-rose-500/85 transition-all sm:w-2.5 dark:bg-rose-400/85"
                        style={{
                          height: `${
                            bucket.purchasesExpense > 0 ? Math.max(6, expenseHeightPct) : 0
                          }%`,
                        }}
                      />
                    </div>

                    <span
                      className={`truncate font-mono-num text-[10px] ${
                        isSelected
                          ? 'font-bold text-slate-900 dark:text-white'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {bucket.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Block 4: Payment Methods & Workshop Status Funnel */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payment Methods */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Ingresos por medio de pago
            </h2>
            <span className="font-mono-num text-xs font-semibold text-slate-500 dark:text-slate-400">
              Total cobrado {formatCurrency(report.totalCollected)}
            </span>
          </div>

          {report.totalCollected <= 0 ? (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Todavía no hay cobros registrados en este período.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                {report.paymentBreakdown.map((item) => {
                  const pct = (item.amount / report.totalCollected) * 100;
                  return (
                    <div
                      key={item.id}
                      className={`h-full transition-all ${item.barClass}`}
                      style={{ width: `${pct}%` }}
                      title={`${item.label}: ${formatCurrency(item.amount)}`}
                    />
                  );
                })}
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.paymentBreakdown.map((item) => {
                  const pct = Math.round((item.amount / report.totalCollected) * 100);
                  return (
                    <div key={item.id} className="flex items-center justify-between py-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-xs ${item.dotClass}`} />
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {item.label}
                        </span>
                        {item.subLabel && (
                          <span className="rounded bg-sky-50 px-1.5 py-0.5 font-mono-num text-[10px] font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                            {item.subLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 font-mono-num">
                        <span className="text-slate-400 dark:text-slate-500">{pct}%</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {formatCurrency(item.amount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Workshop Status Funnel */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Embudo de estados del taller
            </h2>
            <span className="font-mono-num text-xs font-semibold text-slate-500 dark:text-slate-400">
              {report.total} {report.total === 1 ? 'orden' : 'órdenes'}
            </span>
          </div>

          {report.total === 0 ? (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              No ingresaron órdenes de reparación en este período.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {report.funnelCounts.map((step) => (
                <div key={step.status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {step.label}
                    </span>
                    <span className="font-mono-num text-slate-600 dark:text-slate-300">
                      <strong className="text-slate-900 dark:text-white">{step.count}</strong> ·{' '}
                      {step.pct}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${step.barClass}`}
                      style={{ width: `${step.count > 0 ? Math.max(4, step.pct) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Block 4B: Historial de Transferencias, Tarjeta y QR pagados */}
      <section
        aria-label="Historial de Transferencias, Tarjeta y QR pagados"
        className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white font-display">
              <QrCode className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              <span>Historial de Transferencias, Tarjeta y QR pagados</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Cobros y compras pagadas con detalle del nombre del Point Mercado Pago ·{' '}
              <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                {filteredElectronicHistory.length} registros
              </span>
            </p>
          </div>
          <button
            type="button"
            disabled={filteredElectronicHistory.length === 0}
            onClick={handleExportElectronicCsv}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </button>
        </div>

        {/* Channel subtotals */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-xl border border-violet-200/80 bg-violet-50/40 p-3 dark:border-violet-900/50 dark:bg-violet-950/20">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-800 dark:text-violet-300">
              <Smartphone className="h-3.5 w-3.5" />
              <span>Point Mercado Pago</span>
            </div>
            <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
              {formatCurrency(electronicChannelTotals.mp_point)}
            </div>
          </div>
          <div className="rounded-xl border border-sky-200/80 bg-sky-50/40 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-800 dark:text-sky-300">
              <QrCode className="h-3.5 w-3.5" />
              <span>QR Mercado Pago</span>
            </div>
            <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
              {formatCurrency(electronicChannelTotals.mp_qr)}
            </div>
          </div>
          <div className="rounded-xl border border-cyan-200/80 bg-cyan-50/40 p-3 dark:border-cyan-900/50 dark:bg-cyan-950/20">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-800 dark:text-cyan-300">
              <Wallet className="h-3.5 w-3.5" />
              <span>Transferencias</span>
            </div>
            <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
              {formatCurrency(electronicChannelTotals.transferencia)}
            </div>
          </div>
          <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">
              <CreditCard className="h-3.5 w-3.5" />
              <span>Tarjeta</span>
            </div>
            <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
              {formatCurrency(electronicChannelTotals.tarjeta)}
            </div>
          </div>
        </div>

        {/* Channel Filter + Search */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'mp_point', label: 'Point MP' },
                { id: 'mp_qr', label: 'QR MP' },
                { id: 'transferencia', label: 'Transferencia' },
                { id: 'tarjeta', label: 'Tarjeta' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setElectronicFilter(tab.id)}
                className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  electronicFilter === tab.id
                    ? 'bg-[#0072BB] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={electronicQuery}
              onChange={(e) => setElectronicQuery(e.target.value)}
              placeholder="Buscar cliente, comprobante o nombre del Point MP..."
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-8 pr-7 text-xs text-slate-900 outline-none focus:border-[#0072BB] focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            {electronicQuery && (
              <button
                type="button"
                onClick={() => setElectronicQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {filteredElectronicHistory.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
            No hay transferencias, pagos con tarjeta, Point MP ni QR en este período o filtro.
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 dark:border-slate-800">
                    <th className="py-2 pr-3 font-semibold">Fecha</th>
                    <th className="py-2 pr-3 font-semibold">Origen</th>
                    <th className="py-2 pr-3 font-semibold">Cliente / Cuenta</th>
                    <th className="py-2 pr-3 font-semibold">Medio / Canal</th>
                    <th className="py-2 pr-3 font-semibold">Nombre Point MP</th>
                    <th className="py-2 pr-3 font-semibold">Ref.</th>
                    <th className="py-2 text-right font-semibold">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredElectronicHistory.slice(0, 60).map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3 font-mono-num text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {item.dateLabel}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {item.originLabel}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {item.counterparty}
                        </div>
                        <div className="max-w-[260px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {item.concept}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            item.channel === 'mp_point'
                              ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300'
                              : item.channel === 'mp_qr'
                                ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                                : item.channel === 'tarjeta'
                                  ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                  : 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300'
                          }`}
                        >
                          {item.channelLabel}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.mpPointName ? (
                          <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                            {item.mpPointName}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                        {item.reference}
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono-num font-bold whitespace-nowrap ${
                          item.isOutflow
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {item.isOutflow ? '-' : ''}
                        {formatCurrency(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="mt-3 divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {filteredElectronicHistory.slice(0, 60).map((item) => (
                <div key={item.id} className="space-y-1 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {item.counterparty}
                    </span>
                    <span
                      className={`font-mono-num font-bold ${
                        item.isOutflow
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {item.isOutflow ? '-' : ''}
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono-num">{item.dateLabel}</span>
                    <span>·</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {item.channelLabel}
                    </span>
                    {item.mpPointName && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                        Point: {item.mpPointName}
                      </span>
                    )}
                    <span>·</span>
                    <span>{item.originLabel}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {item.concept} ({item.reference})
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Block 5: Devices & Brands Breakdown */}
      {(report.topDevices.length > 0 || report.topBrands.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white font-display">
              <Smartphone className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              <span>Equipos más ingresados</span>
            </h2>
            <div className="space-y-3">
              {report.topDevices.map((d) => (
                <div key={d.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {d.label}
                    </span>
                    <span className="font-mono-num text-slate-600 dark:text-slate-300">
                      {d.count} {d.count === 1 ? 'equipo' : 'equipos'} ·{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {formatCurrency(d.total)}
                      </strong>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-[#0072BB] dark:bg-sky-500"
                      style={{ width: `${Math.round((d.count / maxDeviceCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white font-display">
              <Wrench className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span>Marcas frecuentes</span>
            </h2>
            <div className="space-y-3">
              {report.topBrands.map((b) => (
                <div key={b.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {b.label}
                    </span>
                    <span className="font-mono-num text-slate-600 dark:text-slate-300">
                      {b.count} {b.count === 1 ? 'orden' : 'órdenes'} ·{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {formatCurrency(b.total)}
                      </strong>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400"
                      style={{ width: `${Math.round((b.count / maxBrandCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Block 6: Top Clients & Critical Stock */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white font-display">
            Top clientes del período
          </h2>
          {report.topClients.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sin operaciones de clientes en el período seleccionado.
            </p>
          ) : (
            <div className="space-y-3">
              {report.topClients.map((c, idx) => (
                <div key={c.name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono-num text-[11px] font-bold text-violet-600 dark:text-violet-400">
                        0{idx + 1}.
                      </span>
                      <span className="truncate font-semibold text-slate-900 dark:text-white">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-slate-400 dark:text-slate-500">
                        · {c.count} op.
                      </span>
                    </div>
                    <span className="shrink-0 font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatCurrency(c.total)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-violet-500 dark:bg-violet-400"
                      style={{ width: `${Math.round((c.total / maxClientTotal) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Alertas de inventario
            </h2>
            {report.criticalStock.length > 0 && (
              <span className="font-mono-num text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                {report.outOfStockCount} sin stock · {report.lowStockOnlyCount} bajo mínimo
              </span>
            )}
          </div>
          {report.criticalStock.length === 0 ? (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Todo el inventario está por encima del stock mínimo.</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.criticalStock.map((p) => {
                const isOut = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectProduct(p)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2.5 text-left text-xs transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isOut ? (
                        <PackageX className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                      <span className="truncate font-semibold text-slate-900 dark:text-white">
                        {p.name}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 font-mono-num font-bold ${
                        isOut
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {isOut ? 'Sin stock (0)' : `${p.stock} / mín ${p.minStock}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Block 7: Technician Performance */}
      {report.byTechnician.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white font-display">
            Rendimiento por técnico asignado
          </h2>
          <div className="space-y-3">
            {report.byTechnician.map((tech) => {
              const deliveredPct =
                tech.count > 0 ? Math.round((tech.delivered / tech.count) * 100) : 0;
              return (
                <div key={tech.name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {tech.name}
                      </span>
                      <span className="ml-2 font-mono-num text-slate-500 dark:text-slate-400">
                        {tech.count} {tech.count === 1 ? 'orden' : 'órdenes'} · {tech.delivered}{' '}
                        {tech.delivered === 1 ? 'entregada' : 'entregadas'} ({deliveredPct}%)
                      </span>
                    </div>
                    <span className="shrink-0 font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatCurrency(tech.total)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-teal-500 dark:bg-teal-400"
                      style={{ width: `${Math.round((tech.total / maxTechTotal) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
