import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  Package,
  Plus,
  Scale,
  ShoppingBag,
  TrendingUp,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ClientRecord,
  PageId,
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
} from '../types/workshop';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDateShort,
  getStatusMeta,
  isActiveRepairStatus,
} from '../utils/formatters';
import { useI18n } from '../utils/i18n';

interface HomePageProps {
  repairs: RepairRecord[];
  clients: ClientRecord[];
  products?: ProductRecord[];
  sales: SaleRecord[];
  purchases?: PurchaseRecord[];
  onNavigate: (page: PageId) => void;
  onNewRepair: () => void;
  onNewClient: () => void;
  onNewProduct: () => void;
  onSelectRepair: (repair: RepairRecord) => void;
  onSelectClient: (client: ClientRecord) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  repairs,
  clients,
  products = [],
  sales,
  purchases = [],
  onNavigate,
  onNewRepair,
  onNewClient,
  onNewProduct,
  onSelectRepair,
  onSelectClient,
}) => {
  const { lang, locale, tr } = useI18n();
  const [selectedSalesWeek, setSelectedSalesWeek] = useState<number | null>(null);
  const [selectedRepairStage, setSelectedRepairStage] = useState<string | null>(null);
  const [balanceScope, setBalanceScope] = useState<'total' | 'month'>('total');
  const [selectedBalanceBar, setSelectedBalanceBar] = useState<'income' | 'expense' | null>(null);

  const stats = useMemo(() => {
    const active = repairs.filter((r) => isActiveRepairStatus(r.status));
    const ready = repairs.filter((r) => r.status === 'listo');
    const delivered = repairs.filter((r) => r.status === 'entregado');
    const totalCount = repairs.length || 1;
    const closedCount = ready.length + delivered.length;
    const closureRate = repairs.length > 0 ? Math.round((closedCount / totalCount) * 100) : 0;

    const repairRevenue = repairs.reduce((sum, r) => sum + Number(r.price || 0), 0);
    const salesRevenue = sales.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const totalExpenses = purchases.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const prevYear = prevMonthDate.getFullYear();
    const prevMonth = prevMonthDate.getMonth();

    const currentMonthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(now);
    const currentMonthLabel =
      currentMonthName.charAt(0).toUpperCase() + currentMonthName.slice(1);

    const resolveDate = (timestamp: number, dateStr?: string) => {
      if (dateStr) {
        const parsed = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
      return new Date(timestamp || 0);
    };

    const isCurrentMonth = (timestamp: number, dateStr?: string) => {
      const d = resolveDate(timestamp, dateStr);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    };

    const isPrevMonth = (timestamp: number, dateStr?: string) => {
      const d = resolveDate(timestamp, dateStr);
      return d.getFullYear() === prevYear && d.getMonth() === prevMonth;
    };

    const monthlyRepairs = repairs.filter((r) => isCurrentMonth(r.createdAt, r.dateIn));
    const monthlySales = sales.filter((s) => isCurrentMonth(s.createdAt, s.dueDate));
    const prevMonthSales = sales.filter((s) => isPrevMonth(s.createdAt, s.dueDate));
    const monthlyPurchases = purchases.filter((p) => isCurrentMonth(p.createdAt, p.dueDate));

    const monthlyRepairIncome = monthlyRepairs.reduce((sum, r) => sum + Number(r.price || 0), 0);
    const monthlySalesTotal = monthlySales.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const prevMonthSalesTotal = prevMonthSales.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const monthlyExpenses = monthlyPurchases.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const monthlyEstimatedIncome = monthlyRepairIncome + monthlySalesTotal;
    const monthlyOpsCount = monthlyRepairs.length + monthlySales.length;

    const salesDeltaPct =
      prevMonthSalesTotal > 0
        ? Math.round(((monthlySalesTotal - prevMonthSalesTotal) / prevMonthSalesTotal) * 100)
        : null;

    const salesWeeklyBuckets = [
      { key: 0, label: tr('Sem 1', 'Wk 1', 'Sem 1'), rangeLabel: tr('Días 1–7', 'Days 1–7', 'Dias 1–7'), amount: 0, count: 0 },
      { key: 1, label: tr('Sem 2', 'Wk 2', 'Sem 2'), rangeLabel: tr('Días 8–14', 'Days 8–14', 'Dias 8–14'), amount: 0, count: 0 },
      { key: 2, label: tr('Sem 3', 'Wk 3', 'Sem 3'), rangeLabel: tr('Días 15–21', 'Days 15–21', 'Dias 15–21'), amount: 0, count: 0 },
      { key: 3, label: tr('Sem 4', 'Wk 4', 'Sem 4'), rangeLabel: tr('Días 22–31', 'Days 22–31', 'Dias 22–31'), amount: 0, count: 0 },
    ];
    monthlySales.forEach((s) => {
      const d = resolveDate(s.createdAt, s.dueDate);
      const dom = d.getDate();
      const idx = dom <= 7 ? 0 : dom <= 14 ? 1 : dom <= 21 ? 2 : 3;
      salesWeeklyBuckets[idx].amount += Number(s.amount || 0);
      salesWeeklyBuckets[idx].count += 1;
    });
    const maxSalesWeekAmount = Math.max(1, ...salesWeeklyBuckets.map((b) => b.amount));

    const activeRepairStages = [
      {
        key: 'recibido',
        label: tr('Recib.', 'Recv.', 'Receb.'),
        fullLabel: tr('Recibido', 'Received', 'Recebido'),
        barClass: 'bg-sky-500 dark:bg-sky-400',
        activeRing: 'ring-sky-500/40',
        count: 0,
        value: 0,
      },
      {
        key: 'diagnostico',
        label: tr('Diagn.', 'Diag.', 'Diagn.'),
        fullLabel: tr('Diagnóstico', 'Diagnostics', 'Diagnóstico'),
        barClass: 'bg-amber-500 dark:bg-amber-400',
        activeRing: 'ring-amber-500/40',
        count: 0,
        value: 0,
      },
      {
        key: 'espera_repuesto',
        label: tr('Rep.', 'Parts', 'Peça'),
        fullLabel: tr('Espera repuesto', 'Waiting for parts', 'Aguardando peça'),
        barClass: 'bg-orange-500 dark:bg-orange-400',
        activeRing: 'ring-orange-500/40',
        count: 0,
        value: 0,
      },
      {
        key: 'en_progreso',
        label: tr('Taller', 'Bench', 'Oficina'),
        fullLabel: tr('En progreso', 'In progress', 'Em andamento'),
        barClass: 'bg-[#0072BB] dark:bg-blue-500',
        activeRing: 'ring-[#0072BB]/40',
        count: 0,
        value: 0,
      },
    ];
    active.forEach((r) => {
      const stage = activeRepairStages.find((s) => s.key === r.status);
      if (stage) {
        stage.count += 1;
        stage.value += Number(r.price || 0);
      }
    });
    const maxActiveStageCount = Math.max(1, ...activeRepairStages.map((s) => s.count));

    const openRepairsCount = repairs.filter((r) => r.status !== 'entregado').length;

    const inventoryValue = products.reduce(
      (sum, p) => sum + Number(p.price || 0) * (p.trackStock ? Number(p.stock || 0) : 1),
      0
    );
    const lowStockCount = products.filter((p) => p.trackStock && p.stock <= p.minStock).length;

    // Weekly breakdown (Lun - Sáb) based on repair createdAt
    const dayLabels = [
      tr('Lun', 'Mon', 'Seg'),
      tr('Mar', 'Tue', 'Ter'),
      tr('Mié', 'Wed', 'Qua'),
      tr('Jue', 'Thu', 'Qui'),
      tr('Vie', 'Fri', 'Sex'),
      tr('Sáb', 'Sat', 'Sáb'),
    ];
    const dayCounts = [0, 0, 0, 0, 0, 0];
    repairs.forEach((r) => {
      const d = new Date(r.createdAt || Date.now());
      const jsDay = d.getDay(); // 0 Sun .. 6 Sat
      const idx = jsDay === 0 ? 5 : jsDay - 1;
      if (idx >= 0 && idx < 6) dayCounts[idx] += 1;
    });
    const maxDay = Math.max(1, ...dayCounts);

    // Last 7 calendar days received repairs
    const toLocalDateKey = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const countByDateKey = new Map<string, number>();
    repairs.forEach((r) => {
      let key = '';
      if (r.dateIn && /^\d{4}-\d{2}-\d{2}/.test(r.dateIn)) {
        key = r.dateIn.slice(0, 10);
      } else {
        key = toLocalDateKey(new Date(r.createdAt || Date.now()));
      }
      countByDateKey.set(key, (countByDateKey.get(key) || 0) + 1);
    });

    const last7Days: Array<{ dateKey: string; label: string; fullDate: string; count: number }> = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const dateKey = toLocalDateKey(d);
      const shortWeekday = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
      })
        .format(d)
        .replace('.', '');
      last7Days.push({
        dateKey,
        label: offset === 0 ? tr('Hoy', 'Today', 'Hoje') : shortWeekday,
        fullDate: formatDateShort(dateKey),
        count: countByDateKey.get(dateKey) || 0,
      });
    }
    const last7DaysTotal = last7Days.reduce((sum, item) => sum + item.count, 0);

    const totalRevenue = repairRevenue + salesRevenue;

    return {
      activeList: active,
      activeCount: active.length,
      activeRepairStages,
      maxActiveStageCount,
      openRepairsCount,
      readyCount: ready.length,
      deliveredCount: delivered.length,
      closureRate,
      repairRevenue,
      salesRevenue,
      totalRevenue,
      totalExpenses,
      totalPurchasesCount: purchases.length,
      totalBalance: totalRevenue - totalExpenses,
      monthlyRepairIncome,
      monthlySalesTotal,
      monthlySalesCount: monthlySales.length,
      salesDeltaPct,
      salesWeeklyBuckets,
      maxSalesWeekAmount,
      monthlyExpenses,
      monthlyPurchasesCount: monthlyPurchases.length,
      monthlyBalance: monthlyEstimatedIncome - monthlyExpenses,
      monthlyEstimatedIncome,
      monthlyOpsCount,
      currentMonthLabel,
      inventoryValue,
      lowStockCount,
      dayLabels,
      dayCounts,
      maxDay,
      last7Days,
      last7DaysTotal,
    };
  }, [products, purchases, repairs, sales, lang, locale]);

  const recentActivity = useMemo(() => {
    return [...repairs]
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, 4);
  }, [repairs]);

  const recentClients = useMemo(() => {
    return [...clients].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  }, [clients]);

  return (
    <div className="space-y-6">
      {/* KPI Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <button
          type="button"
          onClick={() => onNavigate('repairs')}
          className="group flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40"
        >
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {tr('Reparaciones abiertas', 'Open repairs', 'Reparos em aberto')}
            </div>
            <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-[#0072BB] sm:text-3xl dark:text-sky-400">
              {stats.openRepairsCount}
            </div>
            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {stats.activeCount} {tr('en taller', 'in workshop', 'na oficina')} · {stats.readyCount}{' '}
              {tr('listas', 'ready', 'prontos')}
            </div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-400">
            <Wrench className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('reports')}
          title={formatCurrency(stats.monthlyEstimatedIncome)}
          className="group flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-500/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500/40"
        >
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {tr('Ingreso mensual estimado', 'Estimated monthly income', 'Receita mensal estimada')}
            </div>
            <div className="mt-1.5 truncate font-mono-num text-2xl font-extrabold text-emerald-600 sm:text-3xl dark:text-emerald-400">
              {formatCompactCurrency(stats.monthlyEstimatedIncome)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {stats.monthlyOpsCount} {tr('operaciones este mes', 'operations this month', 'operações este mês')}
            </div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <TrendingUp className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          title={formatCurrency(stats.inventoryValue)}
          className="group flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {tr('Valor total del inventario', 'Total inventory value', 'Valor total do estoque')}
            </div>
            <div className="mt-1.5 truncate font-mono-num text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-white">
              {formatCompactCurrency(stats.inventoryValue)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {products.length} {tr('artículos', 'items', 'itens')}
              {stats.lowStockCount > 0
                ? ` · ${stats.lowStockCount} ${tr('bajo stock', 'low stock', 'estoque baixo')}`
                : ''}
            </div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Boxes className="h-5 w-5" />
          </span>
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <button
          type="button"
          onClick={onNewRepair}
          className="flex min-h-[68px] items-center gap-3.5 rounded-2xl bg-[#0072BB] px-4 py-3.5 text-left text-white transition hover:bg-[#005f9c]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Wrench className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold">{tr('Nueva reparación', 'New repair', 'Novo reparo')}</div>
            <div className="text-xs text-sky-100">
              {tr('Ingresar equipo al taller', 'Check in device', 'Dar entrada no aparelho')}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onNewClient}
          className="flex min-h-[68px] items-center gap-3.5 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <UserPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {tr('Nuevo cliente', 'New client', 'Novo cliente')}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {tr('Guardar contacto', 'Save contact', 'Salvar contato')}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onNewProduct}
          className="flex min-h-[68px] items-center gap-3.5 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Package className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {tr('Nuevo producto', 'New product', 'Novo produto')}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {tr('Agregar repuesto o stock', 'Add spare part or stock', 'Adicionar peça ou estoque')}
            </div>
          </div>
        </button>
      </div>

      {/* Interactive Visual Metric Cards (Tailwind Bar Charts) */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Card 1: Ventas del mes actual */}
        {(() => {
          const activeBucket =
            selectedSalesWeek !== null
              ? stats.salesWeeklyBuckets.find((b) => b.key === selectedSalesWeek) || null
              : null;
          return (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-[#0072BB]/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <span>
                        {tr('Ventas de', 'Sales for', 'Vendas de')} {stats.currentMonthLabel}
                      </span>
                      {stats.salesDeltaPct !== null && (
                        <span
                          className={`rounded-md px-1.5 py-0.5 font-mono-num text-[10px] font-bold ${
                            stats.salesDeltaPct >= 0
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {stats.salesDeltaPct >= 0 ? `+${stats.salesDeltaPct}%` : `${stats.salesDeltaPct}%`}
                        </span>
                      )}
                    </div>
                    <div
                      title={formatCurrency(stats.monthlySalesTotal)}
                      className="mt-1 truncate font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white"
                    >
                      {formatCurrency(stats.monthlySalesTotal)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('sales')}
                    aria-label={tr('Ir a Ventas', 'Go to Sales', 'Ir para Vendas')}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] transition hover:bg-[#0072BB] hover:text-white dark:bg-sky-950/60 dark:text-sky-400 dark:hover:bg-sky-500 dark:hover:text-white"
                  >
                    <ShoppingBag className="h-5 w-5" />
                  </button>
                </div>

                {/* Interactive detail strip */}
                <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-[11px] dark:bg-slate-800/60">
                  {activeBucket ? (
                    <>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {activeBucket.label} ({activeBucket.rangeLabel})
                      </span>
                      <span className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                        {formatCurrency(activeBucket.amount)} · {activeBucket.count}{' '}
                        {activeBucket.count === 1
                          ? tr('venta', 'sale', 'venda')
                          : tr('ventas', 'sales', 'vendas')}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-500 dark:text-slate-400">
                        {tr('Tocá una semana para ver detalle', 'Tap a week for details', 'Toque em uma semana para detalhes')}
                      </span>
                      <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                        {stats.monthlySalesCount}{' '}
                        {stats.monthlySalesCount === 1
                          ? tr('venta', 'sale', 'venda')
                          : tr('ventas', 'sales', 'vendas')}
                      </span>
                    </>
                  )}
                </div>

                {/* Tailwind Bar Chart */}
                <div className="mt-4 flex h-28 items-end justify-between gap-2.5 px-1">
                  {stats.salesWeeklyBuckets.map((bucket) => {
                    const heightPct =
                      bucket.amount > 0
                        ? Math.max(16, Math.round((bucket.amount / stats.maxSalesWeekAmount) * 100))
                        : 8;
                    const isSelected = selectedSalesWeek === bucket.key;
                    return (
                      <button
                        key={bucket.key}
                        type="button"
                        onMouseEnter={() => setSelectedSalesWeek(bucket.key)}
                        onMouseLeave={() => setSelectedSalesWeek(null)}
                        onClick={() =>
                          setSelectedSalesWeek((prev) => (prev === bucket.key ? null : bucket.key))
                        }
                        className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 focus:outline-none"
                      >
                        <span
                          className={`font-mono-num text-[10px] font-bold transition ${
                            isSelected
                              ? 'text-[#0072BB] dark:text-sky-300'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {bucket.amount > 0 ? formatCompactCurrency(bucket.amount) : '$0'}
                        </span>
                        <div className="flex h-16 w-full items-end justify-center">
                          <div
                            className={`w-full max-w-[34px] rounded-t-lg transition-all duration-300 ${
                              bucket.amount > 0
                                ? isSelected
                                  ? 'bg-[#005f9c] ring-2 ring-[#0072BB]/30 dark:bg-sky-400'
                                  : 'bg-[#0072BB] group-hover:bg-[#005f9c] dark:bg-sky-500 dark:group-hover:bg-sky-400'
                                : 'bg-slate-100 dark:bg-slate-800'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                        <span
                          className={`text-[10px] font-semibold transition ${
                            isSelected
                              ? 'text-[#0072BB] dark:text-sky-300'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {bucket.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">
                  {tr('Distribución semanal del mes', 'Weekly breakdown', 'Distribuição semanal')}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('sales')}
                  className="inline-flex items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                >
                  {tr('Ver ventas', 'View sales', 'Ver vendas')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })()}

        {/* Card 2: Reparaciones en curso */}
        {(() => {
          const activeStage =
            selectedRepairStage !== null
              ? stats.activeRepairStages.find((s) => s.key === selectedRepairStage) || null
              : null;
          return (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-amber-500/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-amber-500/40">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {tr('Reparaciones en curso', 'Repairs in progress', 'Reparos em andamento')}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono-num text-2xl font-extrabold text-[#0072BB] dark:text-sky-400">
                        {stats.activeCount}
                      </span>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {stats.activeCount === 1
                          ? tr('equipo activo', 'active device', 'aparelho ativo')
                          : tr('equipos activos', 'active devices', 'aparelhos ativos')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('repairs')}
                    aria-label={tr('Ir a Reparaciones', 'Go to Repairs', 'Ir para Reparos')}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition hover:bg-amber-500 hover:text-white dark:bg-amber-950/60 dark:text-amber-400 dark:hover:bg-amber-500 dark:hover:text-white"
                  >
                    <Wrench className="h-5 w-5" />
                  </button>
                </div>

                {/* Interactive stage detail strip */}
                <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-[11px] dark:bg-slate-800/60">
                  {activeStage ? (
                    <>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {activeStage.fullLabel}
                      </span>
                      <span className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                        {activeStage.count} ({stats.activeCount > 0 ? Math.round((activeStage.count / stats.activeCount) * 100) : 0}%) · {formatCompactCurrency(activeStage.value)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-500 dark:text-slate-400">
                        {tr('Tocá una etapa para inspeccionar', 'Tap a stage to inspect', 'Toque em uma etapa para ver')}
                      </span>
                      <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                        {stats.readyCount} {tr('listas', 'ready', 'prontos')}
                      </span>
                    </>
                  )}
                </div>

                {/* Tailwind Bar Chart by stage */}
                <div className="mt-4 flex h-28 items-end justify-between gap-2.5 px-1">
                  {stats.activeRepairStages.map((stage) => {
                    const heightPct =
                      stage.count > 0
                        ? Math.max(18, Math.round((stage.count / stats.maxActiveStageCount) * 100))
                        : 8;
                    const isSelected = selectedRepairStage === stage.key;
                    return (
                      <button
                        key={stage.key}
                        type="button"
                        onMouseEnter={() => setSelectedRepairStage(stage.key)}
                        onMouseLeave={() => setSelectedRepairStage(null)}
                        onClick={() =>
                          setSelectedRepairStage((prev) =>
                            prev === stage.key ? null : stage.key
                          )
                        }
                        className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 focus:outline-none"
                      >
                        <span
                          className={`font-mono-num text-[11px] font-bold transition ${
                            isSelected
                              ? 'text-slate-900 dark:text-white'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {stage.count}
                        </span>
                        <div className="flex h-16 w-full items-end justify-center">
                          <div
                            className={`w-full max-w-[34px] rounded-t-lg transition-all duration-300 ${
                              stage.count > 0
                                ? `${stage.barClass} ${isSelected ? `ring-2 ${stage.activeRing} brightness-95` : 'group-hover:brightness-95'}`
                                : 'bg-slate-100 dark:bg-slate-800'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                        <span
                          className={`truncate text-[10px] font-semibold transition ${
                            isSelected
                              ? 'text-slate-900 dark:text-white'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {stage.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">
                  {stats.openRepairsCount} {tr('órdenes abiertas en total', 'total open orders', 'ordens em aberto no total')}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('repairs')}
                  className="inline-flex items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                >
                  {tr('Ver taller', 'View workshop', 'Ver oficina')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })()}

        {/* Card 3: Balance total (Ingresos vs. Gastos) */}
        {(() => {
          const isMonthly = balanceScope === 'month';
          const incomeVal = isMonthly ? stats.monthlyEstimatedIncome : stats.totalRevenue;
          const repairPart = isMonthly ? stats.monthlyRepairIncome : stats.repairRevenue;
          const salesPart = isMonthly ? stats.monthlySalesTotal : stats.salesRevenue;
          const expenseVal = isMonthly ? stats.monthlyExpenses : stats.totalExpenses;
          const purchasesCount = isMonthly
            ? stats.monthlyPurchasesCount
            : stats.totalPurchasesCount;
          const netVal = isMonthly ? stats.monthlyBalance : stats.totalBalance;
          const maxBarVal = Math.max(1, incomeVal, expenseVal);
          const incomePct = incomeVal > 0 ? Math.max(12, Math.round((incomeVal / maxBarVal) * 100)) : 4;
          const expensePct =
            expenseVal > 0 ? Math.max(12, Math.round((expenseVal / maxBarVal) * 100)) : 4;
          const marginPct =
            incomeVal > 0 ? Math.round((netVal / incomeVal) * 100) : expenseVal > 0 ? -100 : 0;

          return (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-emerald-500/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500/40">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {isMonthly
                          ? tr('Balance del mes', 'Monthly balance', 'Saldo do mês')
                          : tr('Balance total', 'Total balance', 'Saldo total')}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono-num text-[10px] font-bold ${
                          netVal >= 0
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                        }`}
                      >
                        {marginPct >= 0
                          ? `${marginPct}% ${tr('margen', 'margin', 'margem')}`
                          : tr('Déficit', 'Deficit', 'Déficit')}
                      </span>
                    </div>
                    <div
                      title={formatCurrency(netVal)}
                      className={`mt-1 truncate font-mono-num text-2xl font-extrabold ${
                        netVal >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {netVal > 0 ? `+${formatCurrency(netVal)}` : formatCurrency(netVal)}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[10px] font-semibold dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setBalanceScope('total')}
                        className={`rounded-md px-2 py-1 transition ${
                          !isMonthly
                            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        Total
                      </button>
                      <button
                        type="button"
                        onClick={() => setBalanceScope('month')}
                        className={`rounded-md px-2 py-1 transition ${
                          isMonthly
                            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {tr('Mes', 'Month', 'Mês')}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('reports')}
                      aria-label={tr('Ir a Reportes', 'Go to Reports', 'Ir para Relatórios')}
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 transition hover:bg-emerald-600 hover:text-white dark:bg-emerald-950/60 dark:text-emerald-400 dark:hover:bg-emerald-500 dark:hover:text-white"
                    >
                      <Scale className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Interactive breakdown strip */}
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] dark:bg-slate-800/60">
                  {selectedBalanceBar === 'income' ? (
                    <>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                        {tr('Rep:', 'Rep:', 'Rep:')} {formatCompactCurrency(repairPart)}
                      </span>
                      <span className="font-semibold text-[#0072BB] dark:text-sky-300">
                        {tr('Ventas:', 'Sales:', 'Vendas:')} {formatCompactCurrency(salesPart)}
                      </span>
                    </>
                  ) : selectedBalanceBar === 'expense' ? (
                    <>
                      <span className="font-semibold text-rose-700 dark:text-rose-300">
                        {tr('Gastos en compras', 'Purchase expenses', 'Gastos em compras')}
                      </span>
                      <span className="font-mono-num font-bold text-rose-700 dark:text-rose-300">
                        {purchasesCount}{' '}
                        {purchasesCount === 1
                          ? tr('compra', 'purchase', 'compra')
                          : tr('compras', 'purchases', 'compras')}{' '}
                        · {formatCurrency(expenseVal)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-500 dark:text-slate-400">
                        {tr(
                          'Tocá una barra para desglosar',
                          'Tap a bar for breakdown',
                          'Toque em uma barra para detalhar'
                        )}
                      </span>
                      <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                        {tr('Ing. vs. Gas.', 'Inc. vs. Exp.', 'Rec. vs. Desp.')}
                      </span>
                    </>
                  )}
                </div>

                {/* Horizontal Tailwind Comparison Bars */}
                <div className="mt-4 space-y-3">
                  <button
                    type="button"
                    onMouseEnter={() => setSelectedBalanceBar('income')}
                    onMouseLeave={() => setSelectedBalanceBar(null)}
                    onClick={() =>
                      setSelectedBalanceBar((prev) => (prev === 'income' ? null : 'income'))
                    }
                    className={`block w-full rounded-xl p-1.5 text-left transition ${
                      selectedBalanceBar === 'income'
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {tr('Ingresos', 'Income', 'Receitas')}
                      </span>
                      <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(incomeVal)}
                      </span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300 dark:bg-emerald-400"
                        style={{ width: `${incomePct}%` }}
                      />
                    </div>
                  </button>

                  <button
                    type="button"
                    onMouseEnter={() => setSelectedBalanceBar('expense')}
                    onMouseLeave={() => setSelectedBalanceBar(null)}
                    onClick={() =>
                      setSelectedBalanceBar((prev) => (prev === 'expense' ? null : 'expense'))
                    }
                    className={`block w-full rounded-xl p-1.5 text-left transition ${
                      selectedBalanceBar === 'expense'
                        ? 'bg-rose-50/70 dark:bg-rose-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {tr('Gastos (compras)', 'Expenses (purchases)', 'Despesas (compras)')}
                      </span>
                      <span className="font-mono-num font-bold text-rose-600 dark:text-rose-400">
                        {formatCurrency(expenseVal)}
                      </span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-rose-500 transition-all duration-300 dark:bg-rose-400"
                        style={{ width: `${expensePct}%` }}
                      />
                    </div>
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">
                  {tr(
                    'Ingresos vs. compras registradas',
                    'Income vs. recorded purchases',
                    'Receitas vs. compras registradas'
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="inline-flex items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                >
                  {tr('Ver reportes', 'View reports', 'Ver relatórios')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {tr('Operación', 'Operations', 'Operação')}
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                {tr('Panel del taller', 'Workshop overview', 'Painel da oficina')}
              </h2>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {tr('Facturación estimada', 'Estimated revenue', 'Faturamento estimado')}
              </div>
              <div className="font-mono-num text-xl font-extrabold text-slate-900 dark:text-white">
                {formatCompactCurrency(stats.totalRevenue)}
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-y border-slate-100 py-4 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {tr('Tasa de cierre', 'Completion rate', 'Taxa de conclusão')}
              </div>
              <div className="mt-0.5 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
                {stats.closureRate}%
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {tr('Total órdenes', 'Total orders', 'Total de ordens')}
              </div>
              <div className="mt-0.5 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
                {repairs.length}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {[
              {
                label: tr('Activas en taller', 'Active in workshop', 'Ativas na oficina'),
                count: stats.activeCount,
                color: 'bg-[#0072BB] dark:bg-sky-500',
              },
              {
                label: tr('Listas para entregar', 'Ready for pickup', 'Prontas para entrega'),
                count: stats.readyCount,
                color: 'bg-emerald-600',
              },
              {
                label: tr('Entregadas', 'Delivered', 'Entregues'),
                count: stats.deliveredCount,
                color: 'bg-slate-500',
              },
            ].map((row) => {
              const pct =
                repairs.length > 0 ? Math.round((row.count / repairs.length) * 100) : 0;
              return (
                <div key={row.label} className="flex items-center gap-3 text-xs">
                  <span className="w-32 shrink-0 text-slate-600 dark:text-slate-300">
                    {row.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${row.color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono-num font-bold text-slate-900 dark:text-white">
                    {row.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              {tr('Flujo semanal', 'Weekly flow', 'Fluxo semanal')}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {tr('Ingresos', 'Intake', 'Entradas')}
            </span>
          </div>
          <div className="flex h-40 items-end justify-between gap-2 pt-4">
            {stats.dayLabels.map((label, idx) => {
              const count = stats.dayCounts[idx];
              const heightPct = count > 0 ? Math.max(14, Math.round((count / stats.maxDay) * 100)) : 8;
              return (
                <div key={label} className="flex flex-1 flex-col items-center gap-2">
                  <span className="font-mono-num text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {count}
                  </span>
                  <div className="flex h-24 w-full items-end justify-center">
                    <div
                      className={`w-full max-w-[28px] rounded-t-lg transition-all ${
                        count > 0
                          ? 'bg-[#0072BB] dark:bg-sky-500'
                          : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Last 7 days received repairs line chart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              {tr(
                'Reparaciones recibidas (últimos 7 días)',
                'Received repairs (last 7 days)',
                'Reparos recebidos (últimos 7 dias)'
              )}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {tr(
                'Evolución diaria de ingresos al taller',
                'Daily workshop intake trend',
                'Evolução diária de entradas na oficina'
              )}
            </p>
          </div>
          <div className="rounded-xl bg-sky-50 px-3 py-1.5 font-mono-num text-xs font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
            {stats.last7DaysTotal}{' '}
            {stats.last7DaysTotal === 1
              ? tr('equipo', 'device', 'aparelho')
              : tr('equipos', 'devices', 'aparelhos')}
          </div>
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats.last7Days} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#94a3b8"
                strokeOpacity={0.22}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const point = payload[0]?.payload as {
                    fullDate: string;
                    count: number;
                  };
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                      <div className="font-semibold text-slate-700 dark:text-slate-200">
                        {point.fullDate}
                      </div>
                      <div className="mt-0.5 font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                        {point.count}{' '}
                        {point.count === 1
                          ? tr('reparación', 'repair', 'reparo')
                          : tr('reparaciones', 'repairs', 'reparos')}
                      </div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                name={tr('Recibidas', 'Received', 'Recebidas')}
                stroke="#0072BB"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#0072BB', stroke: '#ffffff', strokeWidth: 2 }}
                activeDot={{ r: 6, fill: '#0072BB', stroke: '#e0f2fe', strokeWidth: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              {tr('Reparaciones activas', 'Active repairs', 'Reparos ativos')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('repairs')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
            >
              {tr('Ver todas', 'View all', 'Ver todos')} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {stats.activeList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {tr(
                  'No hay reparaciones activas en este momento.',
                  'No active repairs at the moment.',
                  'Não há reparos ativos no momento.'
                )}
              </p>
              <button
                type="button"
                onClick={onNewRepair}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr('Ingresar primer equipo', 'Check in first device', 'Registrar primeiro aparelho')}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {stats.activeList.slice(0, 5).map((r) => {
                const meta = getStatusMeta(r.status);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRepair(r)}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                          {r.code}
                        </span>
                        <span>·</span>
                        <span className="truncate">{r.clientName}</span>
                      </div>
                      <div className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {r.deviceIcon || '📱'} {r.brand} {r.model}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              {tr('Clientes recientes y actividad', 'Recent clients & activity', 'Clientes recentes e atividade')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('clients')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
            >
              {tr('Ver todos', 'View all', 'Ver todos')} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recentClients.length === 0 && recentActivity.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-slate-800">
              <Users className="mx-auto h-6 w-6 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {tr(
                  'Los clientes y movimientos aparecerán acá.',
                  'Clients and recent movements will appear here.',
                  'Os clientes e movimentações aparecerão aqui.'
                )}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentClients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectClient(c)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {c.name}
                      </div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {c.phone || c.email || tr('Sin contacto', 'No contact', 'Sem contato')}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {tr('Ver ficha', 'View profile', 'Ver ficha')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
