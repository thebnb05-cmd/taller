import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  GripVertical,
  LayoutGrid,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { STATUS_META } from '../data/catalog';
import { fetchSingleById, stripUndefined, updateRow } from '../lib/db';
import type { RepairRecord, RepairStatus, WorkshopProfile } from '../types/workshop';
import { extractBatchRef } from '../utils/batchRef';
import { convertFromBaseCurrency } from '../utils/currency';
import {
  formatCurrency,
  formatDateShort,
  getStatusMeta,
  isActiveRepairStatus,
} from '../utils/formatters';
import { parsePaymentInfo } from '../utils/payment';
import {
  appendTimelineEntry,
  computeWarrantyInfo,
  mergeWorkDetailPublicMeta,
  parseRepairPublicMeta,
} from '../utils/repairMeta';
import { buildTrackingUrl } from '../utils/tracking';
import { sanitizeDbErrorMessage } from '../utils/validation';
import { buildRepairWhatsAppMessage } from '../utils/whatsappTemplates';
import { parseWorkshopMeta } from '../utils/workshopMeta';

interface RepairsPageProps {
  repairs: RepairRecord[];
  profile?: WorkshopProfile | null;
  onNewRepair: () => void;
  onSelectRepair: (repair: RepairRecord) => void;
}

interface KanbanColumnDef {
  status: RepairStatus;
  title: string;
  accentBorder: string;
  headerBg: string;
  dropRing: string;
  dotClass: string;
}

const KANBAN_COLUMNS: KanbanColumnDef[] = [
  {
    status: 'recibido',
    title: 'Recibido',
    accentBorder: 'border-t-slate-400',
    headerBg: 'bg-slate-50 dark:bg-slate-800/70',
    dropRing: 'ring-2 ring-slate-400/60 bg-slate-50/80 dark:bg-slate-800/50',
    dotClass: 'bg-slate-400',
  },
  {
    status: 'diagnostico',
    title: 'Diagnóstico',
    accentBorder: 'border-t-sky-500',
    headerBg: 'bg-sky-50/70 dark:bg-sky-950/40',
    dropRing: 'ring-2 ring-sky-500/60 bg-sky-50/70 dark:bg-sky-950/40',
    dotClass: 'bg-sky-500',
  },
  {
    status: 'espera_repuesto',
    title: 'Esperando repuestos',
    accentBorder: 'border-t-amber-500',
    headerBg: 'bg-amber-50/70 dark:bg-amber-950/40',
    dropRing: 'ring-2 ring-amber-500/60 bg-amber-50/70 dark:bg-amber-950/40',
    dotClass: 'bg-amber-500',
  },
  {
    status: 'en_progreso',
    title: 'En reparación',
    accentBorder: 'border-t-[#0072BB]',
    headerBg: 'bg-blue-50/70 dark:bg-blue-950/40',
    dropRing: 'ring-2 ring-[#0072BB]/60 bg-blue-50/70 dark:bg-blue-950/40',
    dotClass: 'bg-[#0072BB] dark:bg-sky-400',
  },
  {
    status: 'listo',
    title: 'Terminado',
    accentBorder: 'border-t-emerald-500',
    headerBg: 'bg-emerald-50/70 dark:bg-emerald-950/40',
    dropRing: 'ring-2 ring-emerald-500/60 bg-emerald-50/70 dark:bg-emerald-950/40',
    dotClass: 'bg-emerald-500',
  },
  {
    status: 'entregado',
    title: 'Entregado',
    accentBorder: 'border-t-teal-500',
    headerBg: 'bg-teal-50/70 dark:bg-teal-950/40',
    dropRing: 'ring-2 ring-teal-500/60 bg-teal-50/70 dark:bg-teal-950/40',
    dotClass: 'bg-teal-500',
  },
];

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  alta: {
    label: 'Alta',
    className: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  },
  media: {
    label: 'Media',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  },
  baja: {
    label: 'Baja',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
};

export const RepairsPage: React.FC<RepairsPageProps> = ({
  repairs,
  profile,
  onNewRepair,
  onSelectRepair,
}) => {
  const { notify } = useToast();
  const [viewMode, setViewMode] = useState<'grid' | 'kanban'>('grid');
  const [showDeliveredInKanban, setShowDeliveredInKanban] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'activas' | 'listas' | 'entregadas'>('all');
  const [techFilter, setTechFilter] = useState<string>('all');

  const [draggedRepairId, setDraggedRepairId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<RepairStatus | null>(null);
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, RepairStatus>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [whatsappPrompt, setWhatsappPrompt] = useState<{
    code: string;
    clientName: string;
    statusLabel: string;
    href: string;
  } | null>(null);
  const justDraggedRef = useRef(false);

  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency = workshopMeta.currency;

  // Clear optimistic overrides once backend snapshot catches up
  useEffect(() => {
    setOptimisticStatuses((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      let changed = false;
      const next: Record<string, RepairStatus> = {};
      for (const [id, st] of entries) {
        const live = repairs.find((r) => r.id === id);
        if (live && live.status !== st) {
          next[id] = st;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [repairs]);

  const effectiveRepairs = useMemo(
    () =>
      repairs.map((r) => {
        const override = optimisticStatuses[r.id];
        if (!override || override === r.status) return r;
        const defaultProg = STATUS_META[override]?.defaultProgress ?? r.progress;
        return { ...r, status: override, progress: defaultProg };
      }),
    [repairs, optimisticStatuses]
  );

  const availableTechnicians = useMemo(() => {
    const set = new Set<string>();
    if (workshopMeta.techniciansEnabled) {
      workshopMeta.technicians.forEach((t) => set.add(t));
    }
    effectiveRepairs.forEach((r) => {
      const t = parsePaymentInfo(r).technician;
      if (t) set.add(t);
    });
    return Array.from(set);
  }, [workshopMeta.techniciansEnabled, workshopMeta.technicians, effectiveRepairs]);

  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...effectiveRepairs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((r) => {
        const tech = parsePaymentInfo(r).technician || '';
        if (techFilter === '__unassigned__' && tech) return false;
        if (
          techFilter !== 'all' &&
          techFilter !== '__unassigned__' &&
          tech.toLowerCase() !== techFilter.toLowerCase()
        ) {
          return false;
        }
        if (!q) return true;
        return (
          r.code.toLowerCase().includes(q) ||
          (r.trackingCode || '').toLowerCase().includes(q) ||
          r.clientName.toLowerCase().includes(q) ||
          (r.clientPhone || '').toLowerCase().includes(q) ||
          r.brand.toLowerCase().includes(q) ||
          r.model.toLowerCase().includes(q) ||
          (r.imei || '').toLowerCase().includes(q) ||
          (r.notes || '').toLowerCase().includes(q) ||
          tech.toLowerCase().includes(q) ||
          r.problem.toLowerCase().includes(q)
        );
      });
  }, [techFilter, effectiveRepairs, search]);

  const filtered = useMemo(() => {
    return baseFiltered.filter((r) => {
      if (filter === 'activas' && !isActiveRepairStatus(r.status)) return false;
      if (filter === 'listas' && r.status !== 'listo') return false;
      if (filter === 'entregadas' && r.status !== 'entregado') return false;
      return true;
    });
  }, [baseFiltered, filter]);

  const visibleKanbanColumns = useMemo(
    () =>
      showDeliveredInKanban
        ? KANBAN_COLUMNS
        : KANBAN_COLUMNS.filter((c) => c.status !== 'entregado'),
    [showDeliveredInKanban]
  );

  const deliveredCount = useMemo(
    () => baseFiltered.filter((r) => r.status === 'entregado').length,
    [baseFiltered]
  );

  const moveRepairToStatus = async (repair: RepairRecord, nextStatus: RepairStatus) => {
    if (repair.status === nextStatus) return;
    const prevStatus = (repair.status as RepairStatus) || 'recibido';
    const nextProgress = STATUS_META[nextStatus]?.defaultProgress ?? repair.progress;
    const nowIso = new Date().toISOString();

    setOptimisticStatuses((prev) => ({ ...prev, [repair.id]: nextStatus }));
    setSavingIds((prev) => ({ ...prev, [repair.id]: true }));

    const nextWorkDetail = mergeWorkDetailPublicMeta(repair.workDetail, (prev) => {
      const withEntry = appendTimelineEntry(prev, nextStatus, undefined, nowIso);
      if (nextStatus === 'entregado' && !withEntry.deliveredAt) {
        return { ...withEntry, deliveredAt: nowIso };
      }
      return withEntry;
    });

    try {
      await updateRow(
        'repairs',
        repair.id,
        stripUndefined({
          status: nextStatus,
          progress: nextProgress,
          workDetail: nextWorkDetail,
          updatedAt: nowIso,
        })
      );

      if (repair.trackingCode) {
        const ticket = await fetchSingleById<{ id: string }>(
          'public_tickets',
          repair.trackingCode
        );
        if (ticket) {
          await updateRow(
            'public_tickets',
            repair.trackingCode,
            stripUndefined({
              status: nextStatus,
              progress: nextProgress,
              workDetail: nextWorkDetail,
              updatedAt: nowIso,
            })
          );
        }
      }

      const colTitle =
        KANBAN_COLUMNS.find((c) => c.status === nextStatus)?.title ||
        getStatusMeta(nextStatus).label;
      notify(`${repair.code} movida a "${colTitle}".`);

      if (nextStatus === 'listo' || nextStatus === 'entregado') {
        const trackingUrl = repair.trackingCode
          ? buildTrackingUrl(repair.trackingCode, profile?.trackingBaseUrl, baseCurrency)
          : undefined;
        const msg = buildRepairWhatsAppMessage({
          templateId: nextStatus === 'listo' ? 'ready' : 'delivered',
          repair: { ...repair, status: nextStatus, workDetail: nextWorkDetail },
          profile: profile ?? null,
          trackingUrl,
        });
        const cleanPhone = (repair.clientPhone || '').replace(/[^\d]/g, '');
        const href = cleanPhone
          ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
          : `https://wa.me/?text=${encodeURIComponent(msg)}`;
        setWhatsappPrompt({
          code: repair.code,
          clientName: repair.clientName,
          statusLabel: colTitle,
          href,
        });
      }
    } catch (err) {
      setOptimisticStatuses((prev) => {
        const copy = { ...prev };
        if (copy[repair.id] === nextStatus) {
          if (prevStatus) delete copy[repair.id];
        }
        return copy;
      });
      notify(
        sanitizeDbErrorMessage(err, 'No se pudo actualizar el estado de la reparación.'),
        'error'
      );
    } finally {
      setSavingIds((prev) => {
        const copy = { ...prev };
        delete copy[repair.id];
        return copy;
      });
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, repairId: string) => {
    setDraggedRepairId(repairId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', repairId);
  };

  const handleDragEnd = () => {
    setDraggedRepairId(null);
    setDragOverStatus(null);
    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 120);
  };

  const handleColumnDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    colStatus: RepairStatus
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStatus !== colStatus) {
      setDragOverStatus(colStatus);
    }
  };

  const handleColumnDrop = (
    e: React.DragEvent<HTMLDivElement>,
    targetStatus: RepairStatus
  ) => {
    e.preventDefault();
    const repairId = draggedRepairId || e.dataTransfer.getData('text/plain');
    setDragOverStatus(null);
    setDraggedRepairId(null);
    if (!repairId) return;
    const repair = effectiveRepairs.find((r) => r.id === repairId);
    if (!repair || repair.status === targetStatus) return;
    void moveRepairToStatus(repair, targetStatus);
  };

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

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                viewMode === 'grid'
                  ? 'bg-white text-[#0072BB] shadow-xs dark:bg-slate-800 dark:text-sky-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Tarjetas
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                viewMode === 'kanban'
                  ? 'bg-white text-[#0072BB] shadow-xs dark:bg-slate-800 dark:text-sky-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              Kanban
            </button>
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
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por orden, cliente, marca, modelo o IMEI..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        {availableTechnicians.length > 0 && (
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            aria-label="Filtrar por técnico"
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">Todos los técnicos</option>
            <option value="__unassigned__">Sin asignar</option>
            {availableTechnicians.map((techName) => (
              <option key={techName} value={techName}>
                Técnico: {techName}
              </option>
            ))}
          </select>
        )}

        {viewMode === 'grid' ? (
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
        ) : (
          <button
            type="button"
            onClick={() => setShowDeliveredInKanban((prev) => !prev)}
            className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
              showDeliveredInKanban
                ? 'border-teal-500 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <span>Entregados ({deliveredCount})</span>
            <span className="text-[10px] opacity-75">
              {showDeliveredInKanban ? 'Ocultar' : 'Mostrar'}
            </span>
          </button>
        )}
      </div>

      {whatsappPrompt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="text-emerald-950 dark:text-emerald-200">
            <strong>{whatsappPrompt.code}</strong> pasó a <strong>{whatsappPrompt.statusLabel}</strong> · ¿Querés avisarle a{' '}
            <strong>{whatsappPrompt.clientName}</strong>?
          </div>
          <div className="flex items-center gap-2">
            <a
              href={whatsappPrompt.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setWhatsappPrompt(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Avisar por WhatsApp
            </a>
            <button
              type="button"
              onClick={() => setWhatsappPrompt(null)}
              aria-label="Cerrar aviso"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {viewMode === 'kanban' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              Arrastrá cualquier tarjeta entre columnas para cambiar su estado o usá las flechas rápidas en cada tarjeta.
            </span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-3">
            {visibleKanbanColumns.map((col, colIdx) => {
              const colRepairs = baseFiltered.filter((r) => r.status === col.status);
              const isDropActive = dragOverStatus === col.status;
              const prevCol = colIdx > 0 ? visibleKanbanColumns[colIdx - 1] : null;
              const nextCol =
                colIdx < visibleKanbanColumns.length - 1
                  ? visibleKanbanColumns[colIdx + 1]
                  : null;

              return (
                <div
                  key={col.status}
                  onDragOver={(e) => handleColumnDragOver(e, col.status)}
                  onDragLeave={(e) => {
                    if (
                      e.currentTarget === e.target ||
                      !e.currentTarget.contains(e.relatedTarget as Node)
                    ) {
                      setDragOverStatus((prev) => (prev === col.status ? null : prev));
                    }
                  }}
                  onDrop={(e) => handleColumnDrop(e, col.status)}
                  className={`flex min-h-[420px] w-[272px] shrink-0 flex-col rounded-2xl border border-t-4 border-slate-200 bg-slate-50/70 transition lg:min-w-[235px] lg:flex-1 dark:border-slate-800 dark:bg-slate-900/50 ${
                    col.accentBorder
                  } ${isDropActive ? col.dropRing : ''}`}
                >
                  <div
                    className={`flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-200/80 px-3.5 py-2.5 dark:border-slate-800 ${col.headerBg}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${col.dotClass}`} />
                      <h2 className="truncate text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                        {col.title}
                      </h2>
                    </div>
                    <span className="rounded-lg bg-white/90 px-2 py-0.5 font-mono-num text-[11px] font-bold text-slate-700 shadow-2xs dark:bg-slate-900 dark:text-slate-200">
                      {colRepairs.length}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-2.5 p-2.5">
                    {colRepairs.length === 0 ? (
                      <div
                        className={`flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed px-3 py-8 text-center text-xs transition ${
                          isDropActive
                            ? 'border-[#0072BB] bg-sky-50/50 font-semibold text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/30 dark:text-sky-300'
                            : 'border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500'
                        }`}
                      >
                        {isDropActive ? 'Soltar aquí' : 'Sin equipos en esta etapa'}
                      </div>
                    ) : (
                      colRepairs.map((r) => {
                        const meta = getStatusMeta(r.status);
                        const balance =
                          Math.round(
                            Math.max(0, Number(r.price || 0) - Number(r.deposit || 0)) * 100
                          ) / 100;
                        const paymentInfo = parsePaymentInfo(r);
                        const hasForeignCurrency = Boolean(
                          paymentInfo.currency &&
                            paymentInfo.currency !== baseCurrency &&
                            paymentInfo.rate &&
                            paymentInfo.rate > 0
                        );
                        const foreignPrice =
                          hasForeignCurrency && paymentInfo.rate
                            ? convertFromBaseCurrency(Number(r.price || 0), paymentInfo.rate)
                            : 0;
                        const batchRef = extractBatchRef(r.notes);
                        const rmeta = parseRepairPublicMeta(r.workDetail);
                        const warranty = computeWarrantyInfo(r);
                        const priorityBadge =
                          PRIORITY_BADGE[r.priority] || PRIORITY_BADGE.media;
                        const isDragging = draggedRepairId === r.id;
                        const isSaving = Boolean(savingIds[r.id]);

                        return (
                          <div
                            key={r.id}
                            draggable={!isSaving}
                            onDragStart={(e) => handleDragStart(e, r.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => {
                              if (justDraggedRef.current) return;
                              onSelectRepair(r);
                            }}
                            className={`group cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-left shadow-2xs transition hover:border-[#0072BB]/50 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40 ${
                              isDragging ? 'scale-[0.98] opacity-50 ring-2 ring-[#0072BB]' : ''
                            } ${isSaving ? 'opacity-70' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400" />
                                <span className="font-mono-num text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                  {r.code}
                                </span>
                                {batchRef && (
                                  <span className="rounded bg-sky-50 px-1 py-0.5 font-mono-num text-[9px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                                    {batchRef}
                                  </span>
                                )}
                              </div>
                              <span
                                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${priorityBadge.className}`}
                              >
                                {priorityBadge.label}
                              </span>
                            </div>

                            <div className="mt-1.5 truncate text-xs font-bold text-slate-900 dark:text-white">
                              {r.deviceIcon || '📱'} {r.brand} {r.model}
                            </div>
                            <div className="truncate text-[11px] font-medium text-slate-600 dark:text-slate-300">
                              {r.clientName}
                            </div>

                            <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                              {r.problem}
                            </p>

                            {(paymentInfo.technician ||
                              rmeta.quote.status !== 'none' ||
                              rmeta.parentRepairCode ||
                              warranty.isActive) && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                {paymentInfo.technician && (
                                  <div className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    <User className="h-2.5 w-2.5 text-[#0072BB] dark:text-sky-400" />
                                    {paymentInfo.technician}
                                  </div>
                                )}
                                {rmeta.quote.status === 'pending' && (
                                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                    Presup. enviado
                                  </span>
                                )}
                                {rmeta.quote.status === 'approved' && (
                                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                    Presup. aprobado
                                  </span>
                                )}
                                {rmeta.quote.status === 'rejected' && (
                                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                                    Presup. rechazado
                                  </span>
                                )}
                                {rmeta.parentRepairCode ? (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#0072BB] dark:bg-sky-950/50 dark:text-sky-300">
                                    <ShieldCheck className="h-2.5 w-2.5" />
                                    Gtía {rmeta.parentRepairCode}
                                  </span>
                                ) : warranty.isActive ? (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                    <ShieldCheck className="h-2.5 w-2.5" />
                                    {warranty.daysLeft}d
                                  </span>
                                ) : null}
                              </div>
                            )}

                            <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                                  {formatCurrency(r.price, baseCurrency)}
                                  {hasForeignCurrency && paymentInfo.currency && (
                                    <span className="ml-1 rounded bg-sky-50 px-1 py-0.5 text-[9px] font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                                      {formatCurrency(foreignPrice, paymentInfo.currency)}
                                    </span>
                                  )}
                                  {balance > 0 && (
                                    <span className="ml-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                      (Resta {formatCurrency(balance, baseCurrency)})
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono-num text-[10px] font-semibold text-slate-400">
                                  {r.progress}%
                                </span>
                              </div>

                              <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                  className={`h-full rounded-full transition-all ${meta.barClass}`}
                                  style={{
                                    width: `${Math.min(100, Math.max(0, r.progress))}%`,
                                  }}
                                />
                              </div>

                              {/* Touch / Keyboard quick stage mover */}
                              <div
                                className="flex items-center justify-between gap-1 pt-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  disabled={!prevCol || isSaving}
                                  onClick={() =>
                                    prevCol && void moveRepairToStatus(r, prevCol.status)
                                  }
                                  title={prevCol ? `Mover a ${prevCol.title}` : undefined}
                                  aria-label={
                                    prevCol ? `Mover a ${prevCol.title}` : 'Sin etapa anterior'
                                  }
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <ChevronLeft className="h-3.5 w-3.5" />
                                </button>

                                <select
                                  value={r.status}
                                  disabled={isSaving}
                                  onChange={(e) =>
                                    void moveRepairToStatus(r, e.target.value as RepairStatus)
                                  }
                                  aria-label={`Cambiar estado de ${r.code}`}
                                  className="h-7 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-semibold text-slate-700 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                >
                                  {KANBAN_COLUMNS.map((opt) => (
                                    <option key={opt.status} value={opt.status}>
                                      {opt.title}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  disabled={!nextCol || isSaving}
                                  onClick={() =>
                                    nextCol && void moveRepairToStatus(r, nextCol.status)
                                  }
                                  title={nextCol ? `Mover a ${nextCol.title}` : undefined}
                                  aria-label={
                                    nextCol ? `Mover a ${nextCol.title}` : 'Sin etapa siguiente'
                                  }
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : filtered.length === 0 ? (
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
            const balance =
              Math.round(Math.max(0, Number(r.price || 0) - Number(r.deposit || 0)) * 100) / 100;
            const batchRef = extractBatchRef(r.notes);
            const paymentInfo = parsePaymentInfo(r);
            const rmeta = parseRepairPublicMeta(r.workDetail);
            const warranty = computeWarrantyInfo(r);
            const hasForeignCurrency = Boolean(
              paymentInfo.currency &&
                paymentInfo.currency !== baseCurrency &&
                paymentInfo.rate &&
                paymentInfo.rate > 0
            );
            const foreignPrice =
              hasForeignCurrency && paymentInfo.rate
                ? convertFromBaseCurrency(Number(r.price || 0), paymentInfo.rate)
                : 0;

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
                      {paymentInfo.technician && (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          <User className="h-2.5 w-2.5 text-[#0072BB] dark:text-sky-400" />
                          {paymentInfo.technician}
                        </span>
                      )}
                      {rmeta.quote.status === 'pending' && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                          Presup. pendiente
                        </span>
                      )}
                      {rmeta.quote.status === 'approved' && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          Presup. aprobado
                        </span>
                      )}
                      {rmeta.quote.status === 'rejected' && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                          Presup. rechazado
                        </span>
                      )}
                      {rmeta.parentRepairCode ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#0072BB] dark:bg-sky-950/50 dark:text-sky-300">
                          <ShieldCheck className="h-2.5 w-2.5" />
                          Garantía {rmeta.parentRepairCode}
                        </span>
                      ) : warranty.isActive ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          <ShieldCheck className="h-2.5 w-2.5" />
                          Gtía {warranty.daysLeft}d
                        </span>
                      ) : null}
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
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500">
                      Progreso <strong className="font-mono-num">{r.progress}%</strong>
                    </span>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatCurrency(r.price, baseCurrency)}
                      {hasForeignCurrency && paymentInfo.currency && (
                        <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                          {formatCurrency(foreignPrice, paymentInfo.currency)}
                        </span>
                      )}
                      {balance > 0 && (
                        <span className="ml-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          (Resta {formatCurrency(balance, baseCurrency)})
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
