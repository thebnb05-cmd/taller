import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RepairRecord, SaleRecord } from '../types/workshop';
import { formatCompactCurrency, formatCurrency } from '../utils/formatters';
import { useI18n } from '../utils/i18n';

interface RevenueTrendChartProps {
  repairs: RepairRecord[];
  sales: SaleRecord[];
}

interface DailyRevenuePoint {
  dateKey: string;
  label: string;
  fullDate: string;
  repairsRevenue: number;
  salesRevenue: number;
  totalRevenue: number;
  repairsCumulative: number;
  salesCumulative: number;
  totalCumulative: number;
  operationsCount: number;
}

function getLocalDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const RevenueTrendChart: React.FC<RevenueTrendChartProps> = ({ repairs, sales }) => {
  const { locale, tr } = useI18n();
  const [viewMode, setViewMode] = useState<'daily' | 'cumulative'>('daily');
  const [showRepairs, setShowRepairs] = useState(true);
  const [showSales, setShowSales] = useState(true);

  const { points, totalRepairs30d, totalSales30d, total30d, growthPct } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const windowStartMs = todayStart.getTime() - 29 * 24 * 60 * 60 * 1000;
    const prevWindowStartMs = windowStartMs - 30 * 24 * 60 * 60 * 1000;

    const bucketMap = new Map<string, DailyRevenuePoint>();
    const orderedPoints: DailyRevenuePoint[] = [];

    for (let offset = 29; offset >= 0; offset -= 1) {
      const dayDate = new Date(todayStart);
      dayDate.setDate(todayStart.getDate() - offset);
      const dateKey = getLocalDayKey(dayDate.getTime());
      const label = `${dayDate.getDate()}/${dayDate.getMonth() + 1}`;
      const fullDate = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      }).format(dayDate);

      const point: DailyRevenuePoint = {
        dateKey,
        label,
        fullDate,
        repairsRevenue: 0,
        salesRevenue: 0,
        totalRevenue: 0,
        repairsCumulative: 0,
        salesCumulative: 0,
        totalCumulative: 0,
        operationsCount: 0,
      };
      bucketMap.set(dateKey, point);
      orderedPoints.push(point);
    }

    let prevTotal30d = 0;

    repairs.forEach((r) => {
      const ts = Number(r.createdAt || 0);
      const amount = Number(r.price || 0);
      if (ts >= prevWindowStartMs && ts < windowStartMs) {
        prevTotal30d += amount;
        return;
      }
      if (ts < windowStartMs) return;
      const point = bucketMap.get(getLocalDayKey(ts));
      if (!point) return;
      point.repairsRevenue += amount;
      point.totalRevenue += amount;
      point.operationsCount += 1;
    });

    sales.forEach((s) => {
      const ts = Number(s.createdAt || 0);
      const amount = Number(s.amount || 0);
      if (ts >= prevWindowStartMs && ts < windowStartMs) {
        prevTotal30d += amount;
        return;
      }
      if (ts < windowStartMs) return;
      const point = bucketMap.get(getLocalDayKey(ts));
      if (!point) return;
      point.salesRevenue += amount;
      point.totalRevenue += amount;
      point.operationsCount += 1;
    });

    let runningRepairs = 0;
    let runningSales = 0;
    orderedPoints.forEach((pt) => {
      runningRepairs += pt.repairsRevenue;
      runningSales += pt.salesRevenue;
      pt.repairsCumulative = runningRepairs;
      pt.salesCumulative = runningSales;
      pt.totalCumulative = runningRepairs + runningSales;
    });

    const sum30d = runningRepairs + runningSales;
    const computedGrowth =
      prevTotal30d > 0
        ? Math.round(((sum30d - prevTotal30d) / prevTotal30d) * 100)
        : sum30d > 0
          ? 100
          : null;

    return {
      points: orderedPoints,
      totalRepairs30d: runningRepairs,
      totalSales30d: runningSales,
      total30d: sum30d,
      growthPct: computedGrowth,
    };
  }, [locale, repairs, sales]);

  const repairsKey = viewMode === 'daily' ? 'repairsRevenue' : 'repairsCumulative';
  const salesKey = viewMode === 'daily' ? 'salesRevenue' : 'salesCumulative';

  return (
    <section
      aria-label={tr(
        'Tendencia de ingresos de los últimos 30 días',
        '30-day revenue trend',
        'Tendência de receitas dos últimos 30 dias'
      )}
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white font-display">
              <TrendingUp className="h-4 w-4 shrink-0 text-[#0072BB] dark:text-sky-400" />
              <span>
                {tr(
                  'Tendencia de ingresos (últimos 30 días)',
                  'Revenue trend (last 30 days)',
                  'Tendência de receitas (últimos 30 dias)'
                )}
              </span>
            </h2>
            {growthPct !== null && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-lg px-2 py-0.5 font-mono-num text-[11px] font-bold ${
                  growthPct >= 0
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                }`}
              >
                {growthPct >= 0 ? (
                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 shrink-0" />
                )}
                <span>
                  {growthPct >= 0 ? `+${growthPct}%` : `${growthPct}%`}{' '}
                  {tr('vs. 30d ant.', 'vs. prev 30d', 'vs. 30d ant.')}
                </span>
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'Comparativa diaria y acumulada de ingresos generados por reparaciones y ventas.',
              'Daily and cumulative comparison of revenue generated by repairs and sales.',
              'Comparativo diário e acumulado de receitas geradas por reparos e vendas.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (showRepairs && !showSales) return;
              setShowRepairs((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
              showRepairs
                ? 'border-sky-200 bg-sky-50/70 text-[#0072BB] dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300'
                : 'border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500'
            }`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-[#0072BB] dark:bg-sky-400" />
            <span>{tr('Reparaciones', 'Repairs', 'Reparos')}</span>
            <span className="font-mono-num font-bold">
              {formatCompactCurrency(totalRepairs30d)}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (showSales && !showRepairs) return;
              setShowSales((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
              showSales
                ? 'border-violet-200 bg-violet-50/70 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/40 dark:text-violet-300'
                : 'border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500'
            }`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-violet-500 dark:bg-violet-400" />
            <span>{tr('Ventas', 'Sales', 'Vendas')}</span>
            <span className="font-mono-num font-bold">
              {formatCompactCurrency(totalSales30d)}
            </span>
          </button>

          <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('daily')}
              className={`rounded-lg px-2.5 py-1 transition ${
                viewMode === 'daily'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tr('Diario', 'Daily', 'Diário')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cumulative')}
              className={`rounded-lg px-2.5 py-1 transition ${
                viewMode === 'cumulative'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tr('Acumulado', 'Cumulative', 'Acumulado')}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4">
        {total30d === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center dark:border-slate-800 dark:bg-slate-950/30">
            <TrendingUp className="mb-2 h-6 w-6 text-slate-300 dark:text-slate-600" />
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr(
                'Sin ingresos por ventas o reparaciones en los últimos 30 días',
                'No sales or repair revenue recorded in the last 30 days',
                'Sem receitas de vendas ou reparos nos últimos 30 dias'
              )}
            </p>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              {tr(
                'A medida que cargues órdenes o ventas, la curva de crecimiento se dibujará acá.',
                'As you add orders or sales, the growth curve will appear here.',
                'Conforme você registrar ordens ou vendas, a curva de crescimento aparecerá aqui.'
              )}
            </p>
          </div>
        ) : (
          <div className="h-64 w-full min-w-0 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="repairsRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0072BB" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0072BB" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="salesRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#94a3b8"
                  strokeOpacity={0.2}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  minTickGap={20}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={56}
                  tickFormatter={(value) => formatCompactCurrency(Number(value || 0))}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const pt = payload[0]?.payload as DailyRevenuePoint | undefined;
                    if (!pt) return null;
                    const repairsVal =
                      viewMode === 'daily' ? pt.repairsRevenue : pt.repairsCumulative;
                    const salesVal =
                      viewMode === 'daily' ? pt.salesRevenue : pt.salesCumulative;
                    const combinedVal =
                      (showRepairs ? repairsVal : 0) + (showSales ? salesVal : 0);

                    return (
                      <div className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5 dark:border-slate-700">
                          <span className="font-semibold capitalize text-slate-800 dark:text-slate-100">
                            {pt.fullDate}
                          </span>
                          <span className="font-mono-num text-[10px] text-slate-400">
                            {pt.operationsCount} {tr('op.', 'ops', 'op.')}
                          </span>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {showRepairs && (
                            <div className="flex items-center justify-between gap-4">
                              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                                <span className="h-2 w-2 rounded-full bg-[#0072BB] dark:bg-sky-400" />
                                {tr('Reparaciones', 'Repairs', 'Reparos')}
                              </span>
                              <span className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                                {formatCurrency(repairsVal)}
                              </span>
                            </div>
                          )}
                          {showSales && (
                            <div className="flex items-center justify-between gap-4">
                              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                                <span className="h-2 w-2 rounded-full bg-violet-500 dark:bg-violet-400" />
                                {tr('Ventas', 'Sales', 'Vendas')}
                              </span>
                              <span className="font-mono-num font-bold text-violet-600 dark:text-violet-400">
                                {formatCurrency(salesVal)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-1 dark:border-slate-700">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {viewMode === 'daily'
                                ? tr('Total del día', 'Day total', 'Total do dia')
                                : tr('Acumulado 30d', '30d cumulative', 'Acumulado 30d')}
                            </span>
                            <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                              {formatCurrency(combinedVal)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                {showRepairs && (
                  <Area
                    type="monotone"
                    dataKey={repairsKey}
                    name={tr('Reparaciones', 'Repairs', 'Reparos')}
                    stroke="#0072BB"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#repairsRevenueGrad)"
                    activeDot={{ r: 5, fill: '#0072BB', stroke: '#ffffff', strokeWidth: 2 }}
                  />
                )}
                {showSales && (
                  <Area
                    type="monotone"
                    dataKey={salesKey}
                    name={tr('Ventas', 'Sales', 'Vendas')}
                    stroke="#8b5cf6"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#salesRevenueGrad)"
                    activeDot={{ r: 5, fill: '#8b5cf6', stroke: '#ffffff', strokeWidth: 2 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>
          {tr('Total últimos 30 días:', 'Last 30 days total:', 'Total últimos 30 dias:')}{' '}
          <strong className="font-mono-num text-slate-900 dark:text-white">
            {formatCurrency(total30d)}
          </strong>
        </span>
        <span>
          {tr(
            'Hacé clic en Reparaciones o Ventas arriba para aislar una serie.',
            'Click Repairs or Sales above to isolate a series.',
            'Clique em Reparos ou Vendas acima para isolar uma série.'
          )}
        </span>
      </div>
    </section>
  );
};
