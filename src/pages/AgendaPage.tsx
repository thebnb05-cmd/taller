import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  List,
  Plus,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { deleteRow, updateRow } from '../lib/db';
import type { RepairRecord, TaskRecord } from '../types/workshop';
import {
  formatCurrency,
  formatDateShort,
  getStatusMeta,
  isActiveRepairStatus,
  todayISO,
} from '../utils/formatters';

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
