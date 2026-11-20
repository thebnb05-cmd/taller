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
  FileDown,
  PackageX,
  ShoppingBag,
  Smartphone,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
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
import {
  formatCompactCurrency,
  formatCurrency,
  isActiveRepairStatus,
  todayISO,
} from '../utils/formatters';
import { parsePaymentInfo } from '../utils/payment';
import { downloadInventorySummaryPdf, downloadSalesSummaryPdf } from '../utils/pdfReport';
import { parseRepairPaymentLedger } from '../utils/repairMeta';
import { parseSaleDetails, parseSalePaymentInfo } from '../utils/saleMeta';
import { useI18n } from '../utils/i18n';

interface ReportsPageProps {
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

interface TimelineBucket {
  key: string;
  label: string;
  fullLabel: string;
  repairsRevenue: number;
  salesRevenue: number;
  purchasesExpense: number;
  ordersCount: number;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
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

    const rFiltered = repairs.filter((r) => inCurrent(r.createdAt));
    const sFiltered = sales.filter((s) => inCurrent(s.createdAt));
    const pFiltered = purchases.filter((p) => inCurrent(p.createdAt));

    const rPrev = repairs.filter((r) => inPrevious(r.createdAt));
    const sPrev = sales.filter((s) => inPrevious(s.createdAt));
    const pPrev = purchases.filter((p) => inPrevious(p.createdAt));

    // Financial aggregates
    const repairIncome = rFiltered.reduce((s, r) => s + Number(r.price || 0), 0);
    const repairPaid = rFiltered.reduce(
      (s, r) => s + Math.min(Number(r.price || 0) || Number(r.deposit || 0), Number(r.deposit || 0)),
      0
    );
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
    const prevRepairIncome = rPrev.reduce((s, r) => s + Number(r.price || 0), 0);
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
    sFiltered.forEach((s) => {
      const info = parseSalePaymentInfo(s);
      if (info.deposit <= 0) return;
      const details = parseSaleDetails(s);
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
      },
      {
        id: 'transferencia',
        label: 'Transferencia',
        amount: payTotals.transferencia,
        barClass: 'bg-sky-500 dark:bg-sky-400',
        dotClass: 'bg-sky-500',
      },
      {
        id: 'tarjeta',
        label: 'Tarjeta',
        amount: payTotals.tarjeta,
        barClass: 'bg-violet-500 dark:bg-violet-400',
        dotClass: 'bg-violet-500',
      },
      {
        id: 'sin_metodo',
        label: 'Seña / otro',
        amount: payTotals.sin_metodo,
        barClass: 'bg-slate-400 dark:bg-slate-500',
        dotClass: 'bg-slate-400',
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
    };
  }, [products, purchases, range, repairs, sales, windowBounds]);

  const selectedBucket =
    activeBucketIndex !== null
      ? report.timeline[activeBucketIndex] ?? null
      : report.timeline[report.timeline.length - 1] ?? null;

  const handleExportSalesPdf = () => {
    setPdfMenuOpen(false);
    try {
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

  const handleExportInventoryPdf = () => {
    setPdfMenuOpen(false);
    try {
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
        className={`inline-flex items-center gap-0.5 font-mono-num text-[11px] font-semibold ${
          isPositiveColor
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span>
          {delta.direction === 'up' ? '+' : '-'}
          {delta.pct}% {windowBounds.compareLabel}
        </span>
      </span>
    );
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Ingreso Bruto */}
          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <span>Ingreso bruto</span>
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
              {formatCompactCurrency(report.totalRevenue)}
            </div>
            <div className="mt-1.5 flex flex-col gap-0.5">
              <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-400">
                Taller {formatCompactCurrency(report.repairIncome)} · Ventas{' '}
                {formatCompactCurrency(report.salesIncome)}
              </span>
              {renderDeltaText(report.revenueDelta)}
            </div>
          </div>

          {/* Cobrado Real */}
          <div className="rounded-2xl border border-teal-200/80 bg-teal-50/40 p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
            <div className="flex items-center justify-between text-xs font-semibold text-teal-800 dark:text-teal-300">
              <span>Cobrado real</span>
              <Wallet className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            </div>
            <div className="mt-2 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
              {formatCompactCurrency(report.totalCollected)}
            </div>
            <div className="mt-2 space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-teal-200/70 dark:bg-teal-950">
                <div
                  className="h-full rounded-full bg-teal-600 transition-all dark:bg-teal-400"
                  style={{ width: `${Math.min(100, report.collectionRate)}%` }}
                />
              </div>
              <div className="font-mono-num text-[11px] text-teal-700 dark:text-teal-300">
                {report.collectionRate}% recaudado del total
              </div>
            </div>
          </div>

          {/* Por Cobrar */}
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-800 dark:text-amber-300">
              <span>Saldo por cobrar</span>
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="mt-2 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
              {formatCompactCurrency(report.totalPending)}
            </div>
            <div className="mt-1.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
              {report.totalPending > 0
                ? 'Pendiente entre señas y ventas'
                : 'Todo el período está saldado'}
            </div>
          </div>

          {/* Compras / Egresos */}
          <div className="rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
            <div className="flex items-center justify-between text-xs font-semibold text-rose-800 dark:text-rose-300">
              <span>Compras / Egresos</span>
              <CreditCard className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="mt-2 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
              {formatCompactCurrency(report.totalPurchases)}
            </div>
            <div className="mt-1.5 font-mono-num text-[11px] text-slate-600 dark:text-slate-400">
              {report.pFiltered.length}{' '}
              {report.pFiltered.length === 1 ? 'compra a proveedor' : 'compras a proveedores'}
            </div>
          </div>

          {/* Resultado Neto */}
          <div
            className={`rounded-2xl border p-4 ${
              report.netResult >= 0
                ? 'border-emerald-300/80 bg-white dark:border-emerald-800/70 dark:bg-slate-900'
                : 'border-rose-300/80 bg-white dark:border-rose-800/70 dark:bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
              <span>Resultado neto</span>
              <span
                className={`font-mono-num text-[11px] font-bold ${
                  report.netResult >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                Margen {report.marginPct}%
              </span>
            </div>
            <div
              className={`mt-2 font-mono-num text-2xl font-bold ${
                report.netResult >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {formatCompactCurrency(report.netResult)}
            </div>
            <div className="mt-1.5">{renderDeltaText(report.netDelta)}</div>
          </div>
        </div>
      </section>

      {/* Block 2: Operación del Taller + Clientes y Stock */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section aria-label="Operación del taller" className="space-y-2.5 lg:col-span-7">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0072BB] dark:text-sky-400">
            <Wrench className="h-3.5 w-3.5" />
            <span>Operación del taller</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-2xl border border-sky-200/80 bg-sky-50/40 p-3.5 dark:border-sky-900/50 dark:bg-sky-950/20">
              <div className="text-[11px] font-semibold text-sky-800 dark:text-sky-300">
                Órdenes
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {report.total}
              </div>
              <div className="mt-1">{renderDeltaText(report.ordersDelta)}</div>
            </div>

            <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/40 p-3.5 dark:border-indigo-900/50 dark:bg-indigo-950/20">
              <div className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">
                En curso
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {report.active}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">En banco</div>
            </div>

            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-3.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                Listas
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {report.ready}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Para retirar</div>
            </div>

            <div className="rounded-2xl border border-teal-200/80 bg-teal-50/40 p-3.5 dark:border-teal-900/50 dark:bg-teal-950/20">
              <div className="text-[11px] font-semibold text-teal-800 dark:text-teal-300">
                Entregadas
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {report.delivered}
              </div>
              <div className="mt-1 font-mono-num text-[11px] text-teal-700 dark:text-teal-300">
                {report.completionRate}% listas/ent.
              </div>
            </div>

            <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-3.5 sm:col-span-1 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Ticket prom.
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {formatCompactCurrency(report.avgTicket)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Por orden</div>
            </div>
          </div>
        </section>

        <section aria-label="Clientes y stock" className="space-y-2.5 lg:col-span-5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400">
            <Users className="h-3.5 w-3.5" />
            <span>Clientes y capital en stock</span>
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-violet-200/80 bg-violet-50/40 p-3.5 dark:border-violet-900/50 dark:bg-violet-950/20">
              <div className="flex items-center justify-between text-[11px] font-semibold text-violet-800 dark:text-violet-300">
                <span>Clientes</span>
                <UserCheck className="h-3.5 w-3.5" />
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {report.activeClientsCount}
              </div>
              <div className="mt-1 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                de {clients.length} totales
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-200/80 bg-cyan-50/40 p-3.5 dark:border-cyan-900/50 dark:bg-cyan-950/20">
              <div className="flex items-center justify-between text-[11px] font-semibold text-cyan-800 dark:text-cyan-300">
                <span>Capital stock</span>
                <Boxes className="h-3.5 w-3.5" />
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {formatCompactCurrency(report.stockRetailValue)}
              </div>
              <div className="mt-1 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                Costo {formatCompactCurrency(report.stockCostValue)}
              </div>
            </div>

            <div className="rounded-2xl border border-rose-200/80 bg-rose-50/40 p-3.5 dark:border-rose-900/50 dark:bg-rose-950/20">
              <div className="flex items-center justify-between text-[11px] font-semibold text-rose-800 dark:text-rose-300">
                <span>Alertas</span>
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {report.criticalStock.length}
              </div>
              <div className="mt-1 font-mono-num text-[11px] text-rose-700 dark:text-rose-300">
                {report.outOfStockCount} sin stock · {report.lowStockOnlyCount} bajo
              </div>
            </div>
          </div>
        </section>
      </div>

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
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-xs ${item.dotClass}`} />
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {item.label}
                        </span>
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
