import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Edit3,
  FileDown,
  FileSpreadsheet,
  List,
  Minus,
  Package,
  Plus,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  Wrench,
} from 'lucide-react';
import { deleteRow, updateRow } from '../lib/db';
import type {
  ClientRecord,
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
  SupplierRecord,
  TaskRecord,
  WorkshopProfile,
} from '../types/workshop';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDateShort,
  getStatusMeta,
  isActiveRepairStatus,
  todayISO,
} from '../utils/formatters';
import {
  downloadInventorySummaryPdf,
  downloadSalesSummaryPdf,
} from '../utils/pdfReport';
import { parseSalePaymentInfo, serializeSaleStatus } from '../utils/saleMeta';
import { useToast } from './ToastProvider';

interface ProductsPageProps {
  products: ProductRecord[];
  onNewProduct: () => void;
  onImportProducts: () => void;
  onSelectProduct: (product: ProductRecord) => void;
}

export const ProductsPage: React.FC<ProductsPageProps> = ({
  products,
  onNewProduct,
  onImportProducts,
  onSelectProduct,
}) => {
  const [search, setSearch] = useState('');

  const lowStockCount = useMemo(
    () => products.filter((p) => p.trackStock && p.stock <= p.minStock).length,
    [products]
  );

  const inventoryValue = useMemo(
    () =>
      products.reduce(
        (sum, p) => sum + Number(p.price || 0) * (p.trackStock ? Number(p.stock || 0) : 1),
        0
      ),
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...products]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      });
  }, [products, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Productos y repuestos
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Catálogo general de repuestos, accesorios y servicios
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onImportProducts}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Importar Excel
          </button>
          <button
            type="button"
            onClick={onNewProduct}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Agregar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {products.length}
          </div>
          <div className="text-xs text-slate-500">Productos</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-amber-600 dark:text-amber-400">
            {lowStockCount}
          </div>
          <div className="text-xs text-slate-500">Stock bajo</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-[#0072BB] dark:text-sky-400">
            {formatCompactCurrency(inventoryValue)}
          </div>
          <div className="text-xs text-slate-500">Valorizado</div>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, SKU, código de barras o marca..."
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Package className="mx-auto h-7 w-7 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
            No hay productos cargados
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const low = p.trackStock && p.stock <= p.minStock;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProduct(p)}
                className="flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40"
              >
                {p.imageDataUrl ? (
                  <img
                    src={p.imageDataUrl}
                    alt={p.name}
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
                    <Package className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {p.name}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {p.category}
                    {p.brand ? ` · ${p.brand}` : ''}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                      {formatCurrency(p.price)}
                    </span>
                    {p.trackStock && (
                      <span
                        className={`font-mono-num font-semibold ${
                          low ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {p.stock} u.{low ? ' · Bajo' : ''}
                      </span>
                    )}
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

interface InventoryPageProps {
  products: ProductRecord[];
  initialFilter?: 'all' | 'repuestos' | 'accesorios' | 'bajo_stock';
  onNewProduct: () => void;
  onSelectProduct: (product: ProductRecord) => void;
}

export const InventoryPage: React.FC<InventoryPageProps> = ({
  products,
  initialFilter = 'all',
  onNewProduct,
  onSelectProduct,
}) => {
  const { notify } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'repuestos' | 'accesorios' | 'bajo_stock'>(
    initialFilter
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === 'repuestos' && p.category !== 'Repuesto') return false;
      if (filter === 'accesorios' && p.category !== 'Accesorio') return false;
      if (filter === 'bajo_stock' && !(p.trackStock && p.stock <= p.minStock)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.location || '').toLowerCase().includes(q)
      );
    });
  }, [filter, products, search]);

  const adjustStock = async (p: ProductRecord, delta: number) => {
    const next = Math.max(0, Number(p.stock || 0) + delta);
    try {
      await updateRow('products', p.id, { stock: next });
    } catch (err) {
      console.error(err);
      notify('No se pudo actualizar el stock.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Inventario
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Control rápido de existencias y reposición
          </p>
        </div>
        <button
          type="button"
          onClick={onNewProduct}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
        >
          <Plus className="h-4 w-4" />
          Agregar
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto o ubicación..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          {[
            { id: 'all', label: 'Todo' },
            { id: 'repuestos', label: 'Repuestos' },
            { id: 'accesorios', label: 'Accesorios' },
            { id: 'bajo_stock', label: 'Bajo stock' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`h-9 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No hay artículos en esta vista.
          </div>
        ) : (
          filtered.map((p) => {
            const low = p.trackStock && p.stock <= p.minStock;
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              >
                <button
                  type="button"
                  onClick={() => onSelectProduct(p)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {p.name}
                    </span>
                    {low && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                        <AlertTriangle className="h-3 w-3" />
                        Reponer
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {p.category}
                    {p.location ? ` · Ubicación: ${p.location}` : ''}
                    {p.sku ? ` · SKU: ${p.sku}` : ''}
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustStock(p, -1)}
                    aria-label="Restar 1"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {p.stock}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjustStock(p, 1)}
                    aria-label="Sumar 1"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" />
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

interface AgendaPageProps {
  tasks: TaskRecord[];
  repairs?: RepairRecord[];
  onNewTask: () => void;
  onSelectRepair?: (repair: RepairRecord) => void;
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function dateToISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeISODate(raw: string | undefined): string {
  if (!raw) return '';
  const match = /^\d{4}-\d{2}-\d{2}/.exec(raw.trim());
  return match ? match[0] : '';
}

function formatLongDateES(iso: string): string {
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export const AgendaPage: React.FC<AgendaPageProps> = ({
  tasks,
  repairs = [],
  onNewTask,
  onSelectRepair,
}) => {
  const { notify } = useToast();
  const today = todayISO();

  const [viewMode, setViewMode] = useState<'calendar' | 'tasks'>('calendar');
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [hideDelivered, setHideDelivered] = useState(false);

  const counts = useMemo(() => {
    const pending = tasks.filter((t) => t.status !== 'completado');
    const dueToday = pending.filter((t) => t.status === 'hoy' || t.dueDate === today);
    const urgent = pending.filter((t) => t.priority === 'alta');
    return {
      pending: pending.length,
      today: dueToday.length,
      urgent: urgent.length,
    };
  }, [tasks, today]);

  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.status === 'completado' && b.status !== 'completado') return 1;
        if (a.status !== 'completado' && b.status === 'completado') return -1;
        return b.createdAt - a.createdAt;
      }),
    [tasks]
  );

  const repairsByDate = useMemo(() => {
    const map = new Map<string, RepairRecord[]>();
    for (const r of repairs) {
      if (hideDelivered && r.status === 'entregado') continue;
      const iso = normalizeISODate(r.dateEst);
      if (!iso) continue;
      const list = map.get(iso);
      if (list) list.push(r);
      else map.set(iso, [r]);
    }
    return map;
  }, [repairs, hideDelivered]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskRecord[]>();
    for (const t of tasks) {
      const iso = normalizeISODate(t.dueDate);
      if (!iso) continue;
      const list = map.get(iso);
      if (list) list.push(t);
      else map.set(iso, [t]);
    }
    return map;
  }, [tasks]);

  const calendarCells = useMemo(() => {
    const { year, month } = monthCursor;
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const cells: Array<{ iso: string; day: number; inMonth: boolean }> = [];
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(year, month, 1 - startOffset + i);
      cells.push({
        iso: dateToISO(d),
        day: d.getDate(),
        inMonth: d.getMonth() === month && d.getFullYear() === year,
      });
    }
    return cells;
  }, [monthCursor]);

  const monthTitle = useMemo(() => {
    const label = new Intl.DateTimeFormat('es-AR', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(monthCursor.year, monthCursor.month, 1));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [monthCursor]);

  const monthPrefix = useMemo(() => {
    const m = String(monthCursor.month + 1).padStart(2, '0');
    return `${monthCursor.year}-${m}-`;
  }, [monthCursor]);

  const deliveryStats = useMemo(() => {
    let thisMonth = 0;
    let dueTodayCount = 0;
    let overdueCount = 0;
    let withoutDateCount = 0;

    for (const r of repairs) {
      const iso = normalizeISODate(r.dateEst);
      if (!iso) {
        if (r.status !== 'entregado') withoutDateCount++;
        continue;
      }
      if (iso.startsWith(monthPrefix) && (!hideDelivered || r.status !== 'entregado')) {
        thisMonth++;
      }
      if (iso === today && r.status !== 'entregado') {
        dueTodayCount++;
      }
      if (iso < today && isActiveRepairStatus(r.status)) {
        overdueCount++;
      }
    }
    return { thisMonth, dueTodayCount, overdueCount, withoutDateCount };
  }, [repairs, monthPrefix, today, hideDelivered]);

  const selectedDayRepairs = useMemo(
    () => repairsByDate.get(selectedDate) ?? [],
    [repairsByDate, selectedDate]
  );

  const selectedDayTasks = useMemo(
    () => tasksByDate.get(selectedDate) ?? [],
    [tasksByDate, selectedDate]
  );

  const overdueRepairs = useMemo(
    () =>
      repairs
        .filter((r) => {
          const iso = normalizeISODate(r.dateEst);
          return Boolean(iso && iso < today && isActiveRepairStatus(r.status));
        })
        .sort((a, b) => (a.dateEst || '').localeCompare(b.dateEst || '')),
    [repairs, today]
  );

  const shiftMonth = (delta: number) => {
    setMonthCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const jumpToDate = (iso: string) => {
    const clean = normalizeISODate(iso);
    if (!clean) return;
    const [y, m] = clean.split('-').map(Number);
    if (Number.isFinite(y) && Number.isFinite(m)) {
      setMonthCursor({ year: y, month: m - 1 });
    }
    setSelectedDate(clean);
  };

  const toggleTask = async (t: TaskRecord) => {
    const nextStatus = t.status === 'completado' ? 'pendiente' : 'completado';
    try {
      await updateRow('tasks', t.id, { status: nextStatus });
    } catch (err) {
      console.error(err);
      notify('No se pudo actualizar la tarea.', 'error');
    }
  };

  const deleteTask = async (t: TaskRecord) => {
    try {
      await deleteRow('tasks', t.id);
      notify('Tarea eliminada.');
    } catch (err) {
      console.error(err);
      notify('No se pudo eliminar la tarea.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">Agenda</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Calendario de entregas estimadas, seguimientos y recordatorios
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-white text-[#0072BB] shadow-xs dark:bg-slate-800 dark:text-sky-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendario
            </button>
            <button
              type="button"
              onClick={() => setViewMode('tasks')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                viewMode === 'tasks'
                  ? 'bg-white text-[#0072BB] shadow-xs dark:bg-slate-800 dark:text-sky-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              Tareas
              {counts.pending > 0 && (
                <span className="rounded-md bg-slate-200 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {counts.pending}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onNewTask}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
          >
            <Plus className="h-4 w-4" />
            Nueva tarea
          </button>
        </div>
      </div>

      {viewMode === 'calendar' ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {deliveryStats.thisMonth}
              </div>
              <div className="text-xs text-slate-500">Entregas del mes</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono-num text-xl font-bold text-[#0072BB] dark:text-sky-400">
                {deliveryStats.dueTodayCount}
              </div>
              <div className="text-xs text-slate-500">Entregas para hoy</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono-num text-xl font-bold text-red-600 dark:text-red-400">
                {deliveryStats.overdueCount}
              </div>
              <div className="text-xs text-slate-500">Entregas atrasadas</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono-num text-xl font-bold text-slate-600 dark:text-slate-300">
                {deliveryStats.withoutDateCount}
              </div>
              <div className="text-xs text-slate-500">Activas sin fecha est.</div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Mes anterior"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <h2 className="min-w-[155px] text-center text-sm font-bold text-slate-900 dark:text-white font-display">
                    {monthTitle}
                  </h2>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    aria-label="Mes siguiente"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToDate(today)}
                    className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Hoy
                  </button>
                </div>

                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={hideDelivered}
                    onChange={(e) => setHideDelivered(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0072BB] focus:ring-[#0072BB]"
                  />
                  Ocultar entregados
                </label>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKDAY_LABELS.map((day) => (
                  <div key={day} className="py-1.5">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell) => {
                  const dayRepairs = repairsByDate.get(cell.iso) ?? [];
                  const dayTasks = tasksByDate.get(cell.iso) ?? [];
                  const isToday = cell.iso === today;
                  const isSelected = cell.iso === selectedDate;
                  const hasOverdue = dayRepairs.some(
                    (r) => cell.iso < today && isActiveRepairStatus(r.status)
                  );
                  const hasReady = dayRepairs.some((r) => r.status === 'listo');

                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedDate(cell.iso)}
                      className={`group flex min-h-[60px] flex-col items-start justify-between rounded-xl border p-1.5 text-left transition-colors sm:min-h-[96px] sm:p-2 ${
                        isSelected
                          ? 'border-[#0072BB] bg-sky-50/70 ring-1 ring-[#0072BB]/30 dark:border-sky-500 dark:bg-sky-950/40'
                          : cell.inMonth
                          ? 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/50'
                          : 'border-transparent bg-slate-50/60 text-slate-400 hover:bg-slate-100/60 dark:bg-slate-950/40 dark:text-slate-600'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-lg font-mono-num text-xs font-semibold ${
                            isToday
                              ? 'bg-[#0072BB] text-white'
                              : cell.inMonth
                              ? 'text-slate-800 dark:text-slate-100'
                              : 'text-slate-400 dark:text-slate-600'
                          }`}
                        >
                          {cell.day}
                        </span>

                        {dayRepairs.length > 0 && (
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono-num text-[10px] font-bold ${
                              hasOverdue
                                ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                : hasReady
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-sky-100 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300'
                            }`}
                          >
                            {dayRepairs.length}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 hidden w-full space-y-1 sm:block">
                        {dayRepairs.slice(0, 2).map((r) => {
                          const overdue = cell.iso < today && isActiveRepairStatus(r.status);
                          const ready = r.status === 'listo';
                          const delivered = r.status === 'entregado';
                          return (
                            <div
                              key={r.id}
                              className={`truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                                overdue
                                  ? 'bg-red-100/90 text-red-800 dark:bg-red-950/70 dark:text-red-200'
                                  : ready
                                  ? 'bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200'
                                  : delivered
                                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                  : 'bg-sky-100/90 text-sky-900 dark:bg-sky-950/70 dark:text-sky-200'
                              }`}
                              title={`${r.code} · ${r.brand} ${r.model} (${r.clientName})`}
                            >
                              <span className="font-mono-num font-semibold">{r.code}</span>{' '}
                              {r.brand} {r.model}
                            </div>
                          );
                        })}
                        {dayRepairs.length > 2 && (
                          <div className="px-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            +{dayRepairs.length - 2} más
                          </div>
                        )}
                      </div>

                      {dayTasks.length > 0 && (
                        <div className="mt-1 flex w-full items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          <span className="hidden truncate sm:inline">
                            {dayTasks.length} {dayTasks.length === 1 ? 'tarea' : 'tareas'}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />
                  Entrega programada
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                  Lista para entregar
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                  Entrega atrasada
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  Tarea con vencimiento
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#0072BB] dark:text-sky-400">
                      {selectedDate === today ? 'Entregas de hoy' : 'Detalle del día'}
                    </div>
                    <h3 className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                      {formatLongDateES(selectedDate)}
                    </h3>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 font-mono-num text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {selectedDayRepairs.length}
                  </span>
                </div>

                {selectedDayRepairs.length === 0 ? (
                  <div className="py-8 text-center">
                    <Wrench className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-700" />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      No hay entregas estimadas para esta fecha.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    {selectedDayRepairs.map((r) => {
                      const meta = getStatusMeta(r.status);
                      const isOverdue =
                        normalizeISODate(r.dateEst) < today && isActiveRepairStatus(r.status);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => onSelectRepair?.(r)}
                          className="w-full rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-[#0072BB]/50 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:border-sky-500/40 dark:hover:bg-slate-800/60"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono-num text-xs font-bold text-[#0072BB] dark:text-sky-400">
                                  {r.code}
                                </span>
                                {isOverdue && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/70 dark:text-red-300">
                                    <Clock className="h-2.5 w-2.5" />
                                    Atrasada
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">
                                {r.deviceIcon ? `${r.deviceIcon} ` : ''}
                                {r.brand} {r.model}
                              </div>
                              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {r.clientName}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                          {(r.problem || r.price > 0) && (
                            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                              <span className="truncate">{r.problem || 'Sin detalle de falla'}</span>
                              {r.price > 0 && (
                                <span className="shrink-0 font-mono-num font-semibold text-slate-700 dark:text-slate-200">
                                  {formatCurrency(r.price)}
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedDayTasks.length > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Tareas para este día
                    </div>
                    <div className="space-y-1.5">
                      {selectedDayTasks.map((t) => {
                        const done = t.status === 'completado';
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => toggleTask(t)}
                            className="flex w-full items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-left text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                          >
                            {done ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            ) : (
                              <Circle className="h-4 w-4 shrink-0 text-slate-400" />
                            )}
                            <span
                              className={`truncate font-medium ${
                                done
                                  ? 'text-slate-400 line-through'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {t.title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {overdueRepairs.length > 0 && (
                <div className="rounded-2xl border border-red-200/80 bg-red-50/40 p-4 dark:border-red-900/50 dark:bg-red-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-300">
                      <AlertTriangle className="h-4 w-4" />
                      Entregas atrasadas ({overdueRepairs.length})
                    </div>
                  </div>
                  <div className="mt-2.5 space-y-1.5">
                    {overdueRepairs.slice(0, 4).map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-white/80 px-2.5 py-2 text-xs dark:bg-slate-900/80"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectRepair?.(r)}
                          className="min-w-0 flex-1 text-left hover:underline"
                        >
                          <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                            <span className="font-mono-num text-[#0072BB] dark:text-sky-400">
                              {r.code}
                            </span>{' '}
                            · {r.brand} {r.model}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {r.clientName} · Est. {formatDateShort(r.dateEst)}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => jumpToDate(r.dateEst ?? '')}
                          className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Ver día
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
                {counts.pending}
              </div>
              <div className="text-xs text-slate-500">Pendientes</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono-num text-2xl font-bold text-[#0072BB] dark:text-sky-400">
                {counts.today}
              </div>
              <div className="text-xs text-slate-500">Para hoy</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono-num text-2xl font-bold text-red-600 dark:text-red-400">
                {counts.urgent}
              </div>
              <div className="text-xs text-slate-500">Urgentes</div>
            </div>
          </div>

          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {sorted.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No tenés tareas registradas.
              </div>
            ) : (
              sorted.map((t) => {
                const done = t.status === 'completado';
                return (
                  <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => toggleTask(t)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      {done ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                      )}
                      <div className="min-w-0">
                        <div
                          className={`text-sm font-semibold ${
                            done
                              ? 'text-slate-400 line-through'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {t.title}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {t.taskType} · Prioridad {t.priority}
                          {t.assignee ? ` · ${t.assignee}` : ''}
                          {t.dueDate ? ` · ${formatDateShort(t.dueDate)}` : ''}
                        </div>
                        {t.notes && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.notes}</p>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTask(t)}
                      aria-label="Eliminar tarea"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};

interface SuppliersPageProps {
  suppliers: SupplierRecord[];
  onNewSupplier: () => void;
  onEditSupplier: (supplier: SupplierRecord) => void;
}

export const SuppliersPage: React.FC<SuppliersPageProps> = ({
  suppliers,
  onNewSupplier,
  onEditSupplier,
}) => {
  const { notify } = useToast();
  const totalDebt = suppliers.reduce((s, x) => s + Number(x.balance || 0), 0);

  const handleDelete = async (s: SupplierRecord) => {
    try {
      await deleteRow('suppliers', s.id);
      notify('Proveedor eliminado.');
    } catch (err) {
      console.error(err);
      notify('No se pudo eliminar.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Proveedores
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Agenda de distribuidores, plazos y cuentas corrientes
          </p>
        </div>
        <button
          type="button"
          onClick={onNewSupplier}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
        >
          <Plus className="h-4 w-4" />
          Agregar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {suppliers.length}
          </div>
          <div className="text-xs text-slate-500">Proveedores</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-amber-600 dark:text-amber-400">
            {formatCurrency(totalDebt)}
          </div>
          <div className="text-xs text-slate-500">Saldo pendiente</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {suppliers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500 md:col-span-2 dark:border-slate-800 dark:bg-slate-900">
            No hay proveedores registrados.
          </div>
        ) : (
          suppliers.map((s) => (
            <div
              key={s.id}
              className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-slate-900 dark:text-white">{s.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {s.category}
                    {s.leadTime ? ` · Plazo: ${s.leadTime}` : ''}
                  </div>
                  {(s.contact || s.phone || s.email) && (
                    <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">
                      {[s.contact, s.phone, s.email].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-500">Saldo</div>
                  <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {formatCurrency(s.balance)}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onEditSupplier(s)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(s)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

interface SalesPageProps {
  sales: SaleRecord[];
  onNewSale: () => void;
  onPrintSale?: (sale: SaleRecord) => void;
}

export const SalesPage: React.FC<SalesPageProps> = ({
  sales,
  onNewSale,
  onPrintSale,
}) => {
  const { notify } = useToast();
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
    });
    try {
      await updateRow('sales', s.id, { status: next });
    } catch (err) {
      console.error(err);
      notify('No se pudo actualizar la venta.', 'error');
    }
  };

  const deleteSale = async (s: SaleRecord) => {
    try {
      await deleteRow('sales', s.id);
      notify('Venta eliminada.');
    } catch (err) {
      console.error(err);
      notify('No se pudo eliminar.', 'error');
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

interface PurchasesPageProps {
  purchases: PurchaseRecord[];
  onNewPurchase: () => void;
}

export const PurchasesPage: React.FC<PurchasesPageProps> = ({ purchases, onNewPurchase }) => {
  const { notify } = useToast();
  const total = purchases.reduce((s, x) => s + Number(x.amount || 0), 0);
  const paid = purchases
    .filter((x) => x.status === 'pagado')
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const pending = Math.max(0, total - paid);

  const toggleStatus = async (p: PurchaseRecord) => {
    const next = p.status === 'pagado' ? 'pendiente' : 'pagado';
    try {
      await updateRow('purchases', p.id, { status: next });
    } catch (err) {
      console.error(err);
      notify('No se pudo actualizar la compra.', 'error');
    }
  };

  const deletePurchase = async (p: PurchaseRecord) => {
    try {
      await deleteRow('purchases', p.id);
      notify('Compra eliminada.');
    } catch (err) {
      console.error(err);
      notify('No se pudo eliminar.', 'error');
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
            .map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              >
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                      {p.invoice}
                    </span>
                    <span>·</span>
                    <span>{formatDateShort(p.dueDate)}</span>
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
                      p.status === 'pagado'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}
                  >
                    {p.status === 'pagado' ? 'Pagado' : 'Pendiente'}
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
            ))
        )}
      </div>
    </div>
  );
};

interface ReportsPageProps {
  profile?: WorkshopProfile | null;
  repairs: RepairRecord[];
  clients: ClientRecord[];
  products: ProductRecord[];
  sales: SaleRecord[];
  purchases: PurchaseRecord[];
  onSelectProduct: (p: ProductRecord) => void;
}

const RANGE_OPTIONS: Array<{ id: '7' | '30' | '90' | 'all'; label: string; pdfLabel: string }> = [
  { id: '7', label: '7 días', pdfLabel: 'Últimos 7 días' },
  { id: '30', label: '30 días', pdfLabel: 'Últimos 30 días' },
  { id: '90', label: '90 días', pdfLabel: 'Últimos 90 días' },
  { id: 'all', label: 'Total', pdfLabel: 'Histórico total' },
];

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
  const [range, setRange] = useState<'7' | '30' | '90' | 'all'>('all');
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

  const report = useMemo(() => {
    const cutoff =
      range === 'all' ? 0 : Date.now() - Number(range) * 24 * 60 * 60 * 1000;

    const rFiltered = repairs.filter((r) => r.createdAt >= cutoff);
    const sFiltered = sales.filter((s) => s.createdAt >= cutoff);
    const pFiltered = purchases.filter((p) => p.createdAt >= cutoff);

    const active = rFiltered.filter((r) => isActiveRepairStatus(r.status)).length;
    const ready = rFiltered.filter((r) => r.status === 'listo').length;
    const delivered = rFiltered.filter((r) => r.status === 'entregado').length;

    const repairIncome = rFiltered.reduce((s, r) => s + Number(r.price || 0), 0);
    const repairPaid = rFiltered.reduce((s, r) => s + Number(r.deposit || 0), 0);
    const salesIncome = sFiltered.reduce((s, x) => s + Number(x.amount || 0), 0);
    const salesPaid = sFiltered.reduce(
      (s, x) => s + parseSalePaymentInfo(x).deposit,
      0
    );

    const totalRevenue = repairIncome + salesIncome;
    const totalPending = Math.max(0, totalRevenue - (repairPaid + salesPaid));
    const totalPurchases = pFiltered.reduce((s, p) => s + Number(p.amount || 0), 0);
    const netResult = totalRevenue - totalPurchases;
    const avgTicket = rFiltered.length > 0 ? repairIncome / rFiltered.length : 0;

    // Top clients
    const byClient = new Map<string, { name: string; total: number; count: number }>();
    rFiltered.forEach((r) => {
      const key = r.clientName.trim().toLowerCase();
      const prev = byClient.get(key) || { name: r.clientName, total: 0, count: 0 };
      prev.total += Number(r.price || 0);
      prev.count += 1;
      byClient.set(key, prev);
    });
    sFiltered.forEach((s) => {
      const key = s.clientName.trim().toLowerCase();
      const prev = byClient.get(key) || { name: s.clientName, total: 0, count: 0 };
      prev.total += Number(s.amount || 0);
      prev.count += 1;
      byClient.set(key, prev);
    });
    const topClients = Array.from(byClient.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const lowStock = products.filter((p) => p.trackStock && p.stock <= p.minStock);

    return {
      rFiltered,
      sFiltered,
      pFiltered,
      total: rFiltered.length,
      active,
      ready,
      delivered,
      totalRevenue,
      totalPending,
      avgTicket,
      totalPurchases,
      netResult,
      topClients,
      lowStock,
    };
  }, [products, purchases, range, repairs, sales]);

  const handleExportSalesPdf = () => {
    setPdfMenuOpen(false);
    try {
      const rangeMeta = RANGE_OPTIONS.find((o) => o.id === range);
      downloadSalesSummaryPdf({
        profile,
        rangeLabel: rangeMeta?.pdfLabel || 'Histórico total',
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Reportes
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Rendimiento financiero, ticket promedio y stock crítico
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
            {RANGE_OPTIONS.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setRange(btn.id)}
                className={`h-9 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  range === btn.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {btn.label}
              </button>
            ))}
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
              <span>Exportar PDF</span>
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
                      Resumen de ventas (PDF)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Ingresos, órdenes y ventas del período
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Órdenes', value: String(report.total) },
          { label: 'Activas', value: String(report.active) },
          { label: 'Listas', value: String(report.ready) },
          { label: 'Entregadas', value: String(report.delivered) },
          { label: 'Ticket prom.', value: formatCompactCurrency(report.avgTicket) },
          { label: 'Ingreso bruto', value: formatCompactCurrency(report.totalRevenue) },
          { label: 'Por cobrar', value: formatCompactCurrency(report.totalPending) },
          { label: 'Compras', value: formatCompactCurrency(report.totalPurchases) },
          { label: 'Resultado neto', value: formatCompactCurrency(report.netResult) },
          { label: 'Clientes totales', value: String(clients.length) },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="font-mono-num text-xl font-bold text-slate-900 dark:text-white">
              {kpi.value}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white font-display">
            Top clientes
          </h2>
          {report.topClients.length === 0 ? (
            <p className="text-xs text-slate-500">Sin datos en el período seleccionado.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.topClients.map((c) => (
                <div key={c.name} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                    <div className="text-slate-500">{c.count} operaciones</div>
                  </div>
                  <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                    {formatCurrency(c.total)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white font-display">
            Productos con stock bajo
          </h2>
          {report.lowStock.length === 0 ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Todo el inventario está por encima del mínimo.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.lowStock.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProduct(p)}
                  className="flex w-full items-center justify-between py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span className="font-semibold text-slate-900 dark:text-white">{p.name}</span>
                  <span className="font-mono-num font-bold text-red-600 dark:text-red-400">
                    {p.stock} / mín {p.minStock}
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
