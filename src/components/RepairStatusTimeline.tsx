import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Inbox,
  Package,
  PackageCheck,
  Search,
  Wrench,
} from 'lucide-react';
import type { RepairRecord, RepairStatus } from '../types/workshop';
import { getIntlLocale, getTranslatedStatusLabel, tr as translate, useI18n, type LanguageCode } from '../utils/i18n';
import type { RepairTimelineEntry } from '../utils/repairMeta';

interface RepairStatusTimelineProps {
  repair: RepairRecord;
  timeline: RepairTimelineEntry[];
}

interface OrderedStageConfig {
  key: RepairStatus;
  shortEs: string;
  shortEn: string;
  shortPt: string;
  icon: React.ComponentType<{ className?: string }>;
  activeNodeClass: string;
  visitedNodeClass: string;
  eventNodeClass: string;
  connectorClass: string;
}

const ORDERED_STAGES: readonly OrderedStageConfig[] = [
  {
    key: 'recibido',
    shortEs: 'Recibido',
    shortEn: 'Received',
    shortPt: 'Recebido',
    icon: Inbox,
    activeNodeClass: 'bg-slate-700 text-white ring-4 ring-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-700/60',
    visitedNodeClass: 'border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    eventNodeClass: 'border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    connectorClass: 'bg-slate-400 dark:bg-slate-500',
  },
  {
    key: 'diagnostico',
    shortEs: 'Diagnóstico',
    shortEn: 'Diagnosis',
    shortPt: 'Diagnóstico',
    icon: Search,
    activeNodeClass: 'bg-sky-600 text-white ring-4 ring-sky-100 dark:bg-sky-500 dark:ring-sky-900/60',
    visitedNodeClass: 'border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
    eventNodeClass: 'border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
    connectorClass: 'bg-sky-500 dark:bg-sky-400',
  },
  {
    key: 'espera_repuesto',
    shortEs: 'Repuesto',
    shortEn: 'Parts',
    shortPt: 'Peça',
    icon: Package,
    activeNodeClass: 'bg-amber-500 text-white ring-4 ring-amber-100 dark:bg-amber-500 dark:ring-amber-900/60',
    visitedNodeClass: 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
    eventNodeClass: 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    connectorClass: 'bg-amber-500 dark:bg-amber-400',
  },
  {
    key: 'en_progreso',
    shortEs: 'En progreso',
    shortEn: 'In progress',
    shortPt: 'Andamento',
    icon: Wrench,
    activeNodeClass: 'bg-[#0072BB] text-white ring-4 ring-sky-100 dark:bg-sky-500 dark:ring-sky-900/60',
    visitedNodeClass: 'border border-blue-200 bg-blue-50 text-[#0072BB] dark:border-blue-800 dark:bg-blue-950 dark:text-sky-300',
    eventNodeClass: 'border border-blue-200 bg-blue-50 text-[#0072BB] dark:border-blue-800 dark:bg-blue-950/60 dark:text-sky-300',
    connectorClass: 'bg-[#0072BB] dark:bg-sky-500',
  },
  {
    key: 'listo',
    shortEs: 'Listo',
    shortEn: 'Ready',
    shortPt: 'Pronto',
    icon: CheckCircle2,
    activeNodeClass: 'bg-emerald-600 text-white ring-4 ring-emerald-100 dark:bg-emerald-500 dark:ring-emerald-900/60',
    visitedNodeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    eventNodeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    connectorClass: 'bg-emerald-500 dark:bg-emerald-400',
  },
  {
    key: 'entregado',
    shortEs: 'Entregado',
    shortEn: 'Delivered',
    shortPt: 'Entregue',
    icon: PackageCheck,
    activeNodeClass: 'bg-teal-600 text-white ring-4 ring-teal-100 dark:bg-teal-500 dark:ring-teal-900/60',
    visitedNodeClass: 'border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300',
    eventNodeClass: 'border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
    connectorClass: 'bg-teal-500 dark:bg-teal-400',
  },
];

const STAGE_MAP = new Map<string, OrderedStageConfig>(ORDERED_STAGES.map((s) => [s.key, s]));

function parseTimestampMs(raw?: string): number | null {
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : `${raw}T12:00:00`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function formatDayMonthShort(raw: string, locale: string): string {
  const ms = parseTimestampMs(raw);
  if (ms === null) return raw;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
  }).format(new Date(ms));
}

function formatDateTimeCompact(raw: string, locale: string): string {
  const hasTime = raw.includes('T');
  const ms = parseTimestampMs(raw);
  if (ms === null) return raw;
  if (!hasTime) {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(ms));
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

function formatDurationCompact(ms: number, lang: LanguageCode): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return '< 1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  if (lang === 'en') {
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

interface NormalizedEvent {
  id: string;
  status: string;
  label: string;
  at: string;
  ms: number | null;
  note?: string;
  prevDifferentStatus?: string;
  durationInStageMs?: number;
  isCurrentStage: boolean;
}

const DEFAULT_VISIBLE_EVENTS = 4;

export const RepairStatusTimeline: React.FC<RepairStatusTimelineProps> = ({ repair, timeline }) => {
  const { lang, tr } = useI18n();
  const locale = getIntlLocale(lang);
  const [expanded, setExpanded] = useState(false);

  const { chronologicalEvents, reversedEvents, totalTransitions, totalElapsedText } = useMemo(() => {
    const checkInIso =
      repair.createdAt && Number.isFinite(repair.createdAt)
        ? new Date(repair.createdAt).toISOString()
        : repair.dateIn
          ? `${repair.dateIn}T09:00:00`
          : new Date().toISOString();

    const updatedIso =
      repair.updatedAt && Number.isFinite(repair.updatedAt)
        ? new Date(repair.updatedAt).toISOString()
        : checkInIso;

    let baseEntries: RepairTimelineEntry[] = [];

    if (timeline.length > 0) {
      baseEntries = [...timeline].sort((a, b) => {
        const msA = parseTimestampMs(a.at) ?? 0;
        const msB = parseTimestampMs(b.at) ?? 0;
        return msA - msB;
      });
      const latest = baseEntries[baseEntries.length - 1];
      if (latest && latest.status !== repair.status) {
        baseEntries.push({
          id: 'sync-current-status',
          status: repair.status,
          label: getTranslatedStatusLabel(repair.status) || repair.status,
          at: updatedIso,
        });
      }
    } else {
      baseEntries.push({
        id: 'legacy-checkin',
        status: 'recibido',
        label: getTranslatedStatusLabel('recibido') || 'Recibido',
        at: checkInIso,
        note: translate(
          'Ingreso registrado en el taller',
          'Check-in recorded at workshop',
          'Entrada registrada na oficina',
          lang
        ),
      });
      if (repair.status !== 'recibido') {
        baseEntries.push({
          id: 'legacy-current',
          status: repair.status,
          label: getTranslatedStatusLabel(repair.status) || repair.status,
          at: updatedIso,
        });
      }
    }

    const nowMs = Date.now();
    const normalized: NormalizedEvent[] = baseEntries.map((entry, idx) => {
      const ms = parseTimestampMs(entry.at);
      const next = baseEntries[idx + 1];
      const nextMs = next ? parseTimestampMs(next.at) : null;
      const isLast = idx === baseEntries.length - 1;

      let prevDifferentStatus: string | undefined;
      for (let j = idx - 1; j >= 0; j--) {
        if (baseEntries[j].status !== entry.status) {
          prevDifferentStatus = baseEntries[j].status;
          break;
        }
      }

      let durationInStageMs: number | undefined;
      if (ms !== null) {
        if (nextMs !== null && nextMs >= ms) {
          durationInStageMs = nextMs - ms;
        } else if (isLast && repair.status !== 'entregado' && nowMs >= ms) {
          durationInStageMs = nowMs - ms;
        }
      }

      return {
        id: entry.id,
        status: entry.status,
        label: getTranslatedStatusLabel(entry.status) || entry.label,
        at: entry.at,
        ms,
        note: entry.note,
        prevDifferentStatus: idx > 0 && baseEntries[idx - 1].status !== entry.status ? prevDifferentStatus : undefined,
        durationInStageMs,
        isCurrentStage: isLast,
      };
    });

    const firstMs = normalized[0]?.ms ?? parseTimestampMs(checkInIso);
    const lastMs =
      repair.status === 'entregado'
        ? normalized[normalized.length - 1]?.ms ?? parseTimestampMs(updatedIso)
        : nowMs;
    const elapsedText =
      firstMs !== null && lastMs !== null && lastMs >= firstMs
        ? formatDurationCompact(lastMs - firstMs, lang)
        : '';

    const uniqueTransitions = normalized.filter(
      (ev, idx) => idx === 0 || ev.status !== normalized[idx - 1].status
    ).length;

    return {
      chronologicalEvents: normalized,
      reversedEvents: [...normalized].reverse(),
      totalTransitions: uniqueTransitions,
      totalElapsedText: elapsedText,
    };
  }, [repair.createdAt, repair.dateIn, repair.status, repair.updatedAt, timeline, lang]);

  const currentStageIndex = useMemo(() => {
    const idx = ORDERED_STAGES.findIndex((s) => s.key === repair.status);
    return idx >= 0 ? idx : 0;
  }, [repair.status]);

  const stageSnapshots = useMemo(() => {
    return ORDERED_STAGES.map((stage, idx) => {
      const matched = chronologicalEvents.find((ev) => ev.status === stage.key);
      const isCurrent = repair.status === stage.key;
      const isOptionalParts = stage.key === 'espera_repuesto';
      const isPassed =
        !isCurrent &&
        (Boolean(matched) || (idx < currentStageIndex && !isOptionalParts));
      const isSkipped =
        !isCurrent && !matched && idx < currentStageIndex && isOptionalParts;

      return {
        stage,
        matched,
        isCurrent,
        isPassed,
        isSkipped,
        shortLabel: lang === 'en' ? stage.shortEn : lang === 'pt' ? stage.shortPt : stage.shortEs,
      };
    });
  }, [chronologicalEvents, currentStageIndex, lang, repair.status]);

  const visibleEvents = expanded
    ? reversedEvents
    : reversedEvents.slice(0, DEFAULT_VISIBLE_EVENTS);
  const hiddenCount = Math.max(0, reversedEvents.length - DEFAULT_VISIBLE_EVENTS);

  return (
    <section
      aria-label={tr('Línea de tiempo de estados', 'Status timeline', 'Linha do tempo de status')}
      className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/50"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
          <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {tr('Línea de tiempo de estados', 'Status history timeline', 'Linha do tempo de status')}
          </h4>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-mono-num tabular-nums">
            {totalTransitions}{' '}
            {totalTransitions === 1
              ? tr('etapa', 'stage', 'etapa')
              : tr('etapas', 'stages', 'etapas')}
          </span>
          {totalElapsedText && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num tabular-nums">
                {repair.status === 'entregado'
                  ? tr(`Completado en ${totalElapsedText}`, `Completed in ${totalElapsedText}`, `Concluído em ${totalElapsedText}`)
                  : tr(`${totalElapsedText} en taller`, `${totalElapsedText} in shop`, `${totalElapsedText} na oficina`)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Horizontal at-a-glance workflow stepper */}
      <div className="relative grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6 sm:gap-x-1">
        {stageSnapshots.map(({ stage, matched, isCurrent, isPassed, isSkipped, shortLabel }, idx) => {
          const Icon = stage.icon;
          const prevPassed = idx > 0 && (stageSnapshots[idx - 1].isPassed || stageSnapshots[idx - 1].isCurrent);
          const lineFilled = isCurrent || isPassed;

          return (
            <div key={stage.key} className="relative flex flex-col items-center text-center">
              {/* Desktop horizontal connector */}
              {idx > 0 && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-4 right-1/2 hidden h-0.5 w-full -translate-y-1/2 sm:block ${
                    lineFilled || prevPassed
                      ? lineFilled
                        ? stage.connectorClass
                        : 'bg-slate-200 dark:bg-slate-700'
                      : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                />
              )}

              <div
                title={getTranslatedStatusLabel(stage.key)}
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
                  isCurrent
                    ? stage.activeNodeClass
                    : isPassed
                      ? stage.visitedNodeClass
                      : isSkipped
                        ? 'border border-dashed border-slate-200 bg-slate-50 text-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-600'
                        : 'border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-500'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>

              <span
                className={`mt-1.5 max-w-full truncate text-[11px] leading-tight ${
                  isCurrent
                    ? 'font-bold text-slate-900 dark:text-white'
                    : isPassed
                      ? 'font-semibold text-slate-700 dark:text-slate-200'
                      : isSkipped
                        ? 'font-medium text-slate-400 line-through dark:text-slate-600'
                        : 'font-medium text-slate-400 dark:text-slate-500'
                }`}
              >
                {shortLabel}
              </span>

              <span className="mt-0.5 font-mono-num text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                {matched
                  ? formatDayMonthShort(matched.at, locale)
                  : isCurrent
                    ? tr('Actual', 'Current', 'Atual')
                    : isSkipped
                      ? tr('Omitido', 'Skipped', 'Pulado')
                      : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Chronological change history */}
      <div className="mt-4 border-t border-slate-100 pt-3.5 dark:border-slate-800">
        <ol className="space-y-0">
          {visibleEvents.map((ev, idx) => {
            const stageCfg = STAGE_MAP.get(ev.status);
            const Icon = stageCfg?.icon || History;
            const isLastRendered = idx === visibleEvents.length - 1;
            const durationText =
              ev.durationInStageMs !== undefined
                ? formatDurationCompact(ev.durationInStageMs, lang)
                : '';

            return (
              <li key={ev.id} className="relative flex gap-3 pb-3.5 last:pb-0">
                {!isLastRendered && (
                  <span
                    aria-hidden="true"
                    className="absolute top-7 bottom-0 left-3.5 w-px -translate-x-1/2 bg-slate-200 dark:bg-slate-700/80"
                  />
                )}

                <div
                  className={`relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    ev.isCurrentStage && stageCfg
                      ? stageCfg.activeNodeClass
                      : stageCfg?.eventNodeClass ||
                        'border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>

                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {ev.label}
                      </span>
                      {ev.prevDifferentStatus && (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          ← {getTranslatedStatusLabel(ev.prevDifferentStatus)}
                        </span>
                      )}
                      {ev.isCurrentStage && (
                        <span className="text-[11px] font-semibold text-[#0072BB] dark:text-sky-400">
                          · {tr('Estado actual', 'Current status', 'Status atual')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 font-mono-num text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      <span>{formatDateTimeCompact(ev.at, locale)}</span>
                      {durationText && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-400 dark:text-slate-500">
                            {durationText}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {ev.note && (
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {ev.note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {hiddenCount > 0 && (
          <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#0072BB] transition-colors hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-[#0072BB] dark:text-sky-400 dark:hover:bg-sky-950/40"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  {tr('Mostrar menos', 'Show less', 'Mostrar menos')}
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  {tr(
                    `Ver historial completo (${hiddenCount} más)`,
                    `View full history (${hiddenCount} more)`,
                    `Ver histórico completo (mais ${hiddenCount})`
                  )}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
