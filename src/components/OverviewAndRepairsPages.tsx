import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  Package,
  Plus,
  Search,
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
  RepairRecord,
  SaleRecord,
} from '../types/workshop';
import { extractBatchRef } from '../utils/batchRef';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDateShort,
  getStatusMeta,
  isActiveRepairStatus,
} from '../utils/formatters';

interface HomePageProps {
  repairs: RepairRecord[];
  clients: ClientRecord[];
  products?: ProductRecord[];
  sales: SaleRecord[];
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
  onNavigate,
  onNewRepair,
  onNewClient,
  onNewProduct,
  onSelectRepair,
  onSelectClient,
}) => {
  const stats = useMemo(() => {
    const active = repairs.filter((r) => isActiveRepairStatus(r.status));
    const ready = repairs.filter((r) => r.status === 'listo');
    const delivered = repairs.filter((r) => r.status === 'entregado');
    const totalCount = repairs.length || 1;
    const closedCount = ready.length + delivered.length;
    const closureRate = repairs.length > 0 ? Math.round((closedCount / totalCount) * 100) : 0;

    const repairRevenue = repairs.reduce((sum, r) => sum + Number(r.price || 0), 0);
    const salesRevenue = sales.reduce((sum, s) => sum + Number(s.amount || 0), 0);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const isCurrentMonth = (timestamp: number, dateStr?: string) => {
      if (dateStr) {
        const parsed = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.getFullYear() === currentYear && parsed.getMonth() === currentMonth;
        }
      }
      const d = new Date(timestamp || 0);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    };

    const monthlyRepairs = repairs.filter((r) => isCurrentMonth(r.createdAt, r.dateIn));
    const monthlySales = sales.filter((s) => isCurrentMonth(s.createdAt));
    const monthlyEstimatedIncome =
      monthlyRepairs.reduce((sum, r) => sum + Number(r.price || 0), 0) +
      monthlySales.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const monthlyOpsCount = monthlyRepairs.length + monthlySales.length;

    const openRepairsCount = repairs.filter((r) => r.status !== 'entregado').length;

    const inventoryValue = products.reduce(
      (sum, p) => sum + Number(p.price || 0) * (p.trackStock ? Number(p.stock || 0) : 1),
      0
    );
    const lowStockCount = products.filter((p) => p.trackStock && p.stock <= p.minStock).length;

    // Weekly breakdown (Lun - Sáb) based on repair createdAt
    const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
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
      const shortWeekday = new Intl.DateTimeFormat('es-AR', {
        weekday: 'short',
        day: 'numeric',
      })
        .format(d)
        .replace('.', '');
      last7Days.push({
        dateKey,
        label: offset === 0 ? 'Hoy' : shortWeekday,
        fullDate: formatDateShort(dateKey),
        count: countByDateKey.get(dateKey) || 0,
      });
    }
    const last7DaysTotal = last7Days.reduce((sum, item) => sum + item.count, 0);

    return {
      activeList: active,
      activeCount: active.length,
      openRepairsCount,
      readyCount: ready.length,
      deliveredCount: delivered.length,
      closureRate,
      totalRevenue: repairRevenue + salesRevenue,
      monthlyEstimatedIncome,
      monthlyOpsCount,
      inventoryValue,
      lowStockCount,
      dayLabels,
      dayCounts,
      maxDay,
      last7Days,
      last7DaysTotal,
    };
  }, [products, repairs, sales]);

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
              Reparaciones abiertas
            </div>
            <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-[#0072BB] sm:text-3xl dark:text-sky-400">
              {stats.openRepairsCount}
            </div>
            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {stats.activeCount} en taller · {stats.readyCount} listas
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
              Ingreso mensual estimado
            </div>
            <div className="mt-1.5 truncate font-mono-num text-2xl font-extrabold text-emerald-600 sm:text-3xl dark:text-emerald-400">
              {formatCompactCurrency(stats.monthlyEstimatedIncome)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {stats.monthlyOpsCount} operaciones este mes
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
              Valor total del inventario
            </div>
            <div className="mt-1.5 truncate font-mono-num text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-white">
              {formatCompactCurrency(stats.inventoryValue)}
            </div>
            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {products.length} artículos
              {stats.lowStockCount > 0 ? ` · ${stats.lowStockCount} bajo stock` : ''}
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
            <div className="text-sm font-bold">Nueva reparación</div>
            <div className="text-xs text-sky-100">Ingresar equipo al taller</div>
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
            <div className="text-sm font-bold text-slate-900 dark:text-white">Nuevo cliente</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Guardar contacto</div>
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
            <div className="text-sm font-bold text-slate-900 dark:text-white">Nuevo producto</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Agregar repuesto o stock</div>
          </div>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Operación</div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                Panel del taller
              </h2>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">Facturación estimada</div>
              <div className="font-mono-num text-xl font-extrabold text-slate-900 dark:text-white">
                {formatCompactCurrency(stats.totalRevenue)}
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-y border-slate-100 py-4 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Tasa de cierre</div>
              <div className="mt-0.5 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
                {stats.closureRate}%
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Total órdenes</div>
              <div className="mt-0.5 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
                {repairs.length}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {[
              {
                label: 'Activas en taller',
                count: stats.activeCount,
                color: 'bg-[#0072BB] dark:bg-sky-500',
              },
              {
                label: 'Listas para entregar',
                count: stats.readyCount,
                color: 'bg-emerald-600',
              },
              {
                label: 'Entregadas',
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
              Flujo semanal
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">Ingresos</span>
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
              Reparaciones recibidas (últimos 7 días)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evolución diaria de ingresos al taller
            </p>
          </div>
          <div className="rounded-xl bg-sky-50 px-3 py-1.5 font-mono-num text-xs font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
            {stats.last7DaysTotal} {stats.last7DaysTotal === 1 ? 'equipo' : 'equipos'}
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
                        {point.count} {point.count === 1 ? 'reparación' : 'reparaciones'}
                      </div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                name="Recibidas"
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
              Reparaciones activas
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('repairs')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
            >
              Ver todas <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {stats.activeList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No hay reparaciones activas en este momento.
              </p>
              <button
                type="button"
                onClick={onNewRepair}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Plus className="h-3.5 w-3.5" />
                Ingresar primer equipo
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
              Clientes recientes y actividad
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('clients')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
            >
              Ver todos <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recentClients.length === 0 && recentActivity.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-slate-800">
              <Users className="mx-auto h-6 w-6 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Los clientes y movimientos aparecerán acá.
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
                        {c.phone || c.email || 'Sin contacto'}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">Ver ficha</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface RepairsPageProps {
  repairs: RepairRecord[];
  onNewRepair: () => void;
  onSelectRepair: (repair: RepairRecord) => void;
}

export const RepairsPage: React.FC<RepairsPageProps> = ({
  repairs,
  onNewRepair,
  onSelectRepair,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'activas' | 'listas' | 'entregadas'>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...repairs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((r) => {
        if (filter === 'activas' && !isActiveRepairStatus(r.status)) return false;
        if (filter === 'listas' && r.status !== 'listo') return false;
        if (filter === 'entregadas' && r.status !== 'entregado') return false;
        if (!q) return true;
        return (
          r.code.toLowerCase().includes(q) ||
          r.clientName.toLowerCase().includes(q) ||
          r.brand.toLowerCase().includes(q) ||
          r.model.toLowerCase().includes(q) ||
          (r.imei || '').toLowerCase().includes(q) ||
          (r.notes || '').toLowerCase().includes(q) ||
          r.problem.toLowerCase().includes(q)
        );
      });
  }, [filter, repairs, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Reparaciones
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {repairs.length} órdenes registradas en el taller
          </p>
        </div>
        <button
          type="button"
          onClick={onNewRepair}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nueva reparación
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por orden, cliente, marca, modelo o IMEI..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'activas', label: 'Activas' },
            { id: 'listas', label: 'Listas' },
            { id: 'entregadas', label: 'Entregadas' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`h-9 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Wrench className="mx-auto h-7 w-7 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
            No se encontraron reparaciones
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Probá con otro filtro o ingresá un nuevo equipo.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => {
            const meta = getStatusMeta(r.status);
            const balance = Math.max(0, Number(r.price || 0) - Number(r.deposit || 0));
            const batchRef = extractBatchRef(r.notes);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRepair(r)}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                        {r.code}
                      </span>
                      {batchRef && (
                        <span className="rounded bg-sky-50 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                          {batchRef}
                        </span>
                      )}
                      <span>·</span>
                      <span>{formatDateShort(r.dateIn)}</span>
                      <span>·</span>
                      <span className="capitalize">Prioridad {r.priority}</span>
                    </div>
                    <h3 className="mt-1 truncate text-base font-bold text-slate-900 dark:text-white">
                      {r.deviceIcon || '📱'} {r.brand} {r.model}
                    </h3>
                    <p className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                      {r.clientName}
                      {r.clientPhone ? ` · ${r.clientPhone}` : ''}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                </div>

                <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                  {r.problem}
                </p>

                <div className="space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      Progreso <strong className="font-mono-num">{r.progress}%</strong>
                    </span>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatCurrency(r.price)}
                      {balance > 0 && (
                        <span className="ml-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          (Resta {formatCurrency(balance)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${meta.barClass}`}
                      style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface ClientsPageProps {
  clients: ClientRecord[];
  repairs: RepairRecord[];
  sales: SaleRecord[];
  onNewClient: () => void;
  onSelectClient: (client: ClientRecord) => void;
}

export const ClientsPage: React.FC<ClientsPageProps> = ({
  clients,
  repairs,
  sales,
  onNewClient,
  onSelectClient,
}) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.dni || '').toLowerCase().includes(q)
        );
      });
  }, [clients, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Clientes
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {clients.length} clientes en base de datos
          </p>
        </div>
        <button
          type="button"
          onClick={onNewClient}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nuevo cliente
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono, DNI o email..."
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Users className="mx-auto h-7 w-7 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
            Sin clientes para mostrar
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const cRepairs = repairs.filter(
              (r) =>
                r.clientId === c.id ||
                r.clientName.trim().toLowerCase() === c.name.trim().toLowerCase()
            );
            const cSales = sales.filter(
              (s) =>
                s.clientId === c.id ||
                s.clientName.trim().toLowerCase() === c.name.trim().toLowerCase()
            );
            const total =
              cRepairs.reduce((s, r) => s + Number(r.price || 0), 0) +
              cSales.reduce((s, x) => s + Number(x.amount || 0), 0);

            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectClient(c)}
                className="flex items-start gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {c.name}
                  </div>
                  <div className="mt-0.5 truncate font-mono-num text-xs text-slate-500 dark:text-slate-400">
                    {c.phone || c.email || 'Sin teléfono'}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono-num">{cRepairs.length} órd.</span>
                    <span>·</span>
                    <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(total)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
